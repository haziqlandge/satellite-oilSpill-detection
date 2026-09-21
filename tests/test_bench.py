"""Tests for the pipeline benchmark, the CPU cap and the pre-resize.

None of these train anything. The properties pinned here are the ones whose
failure would be **silent**: a cap that reports success without applying, a
benchmark that quotes a warmup epoch as steady state, or a pre-resize that
changes what the model sees while claiming not to.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

from ml.bench.monitor import ResourceMonitor, Summary, _percentile, read_gpu
from ml.bench.pipeline import BenchResult, EpochTiming, render
from ml.train.train import (
    CPU_CEILING_FRACTION,
    MAIN_PROCESS_THREADS,
    WORKER_CV2_THREADS,
    cap_cpu,
    cap_worker_threads,
    capped_seed_worker,
)

# --------------------------------------------------------------------------
# The CPU cap
# --------------------------------------------------------------------------


def test_the_cpu_cap_is_the_agreed_eighty_percent() -> None:
    assert CPU_CEILING_FRACTION == 0.80


def test_affinity_is_the_hard_ceiling_and_is_actually_applied() -> None:
    """The guarantee, not a heuristic: N of M cores cannot exceed N/M.

    `HANDOFF.md` recorded "affinity alone does not cap CPU". It does cap the
    machine-wide figure -- what failed was applying it from outside, after the
    dataloader workers had already spawned.
    """
    psutil = pytest.importorskip("psutil")

    applied = cap_cpu()
    total = os.cpu_count() or 1

    assert applied["cores_allowed"] <= max(1, int(total * CPU_CEILING_FRACTION))
    assert applied["cores_allowed"] < total, "a cap that allows every core is not a cap"
    if applied["affinity"]:
        assert len(psutil.Process().cpu_affinity()) == applied["cores_allowed"]


def test_the_cap_avoids_the_performance_cores() -> None:
    """Placement matters for temperature, not just the utilisation percentage.

    The user reported the CPU at 92 C against an 85 C limit while measured
    utilisation was only ~21%. A `range(19)` cap on this part lands on **6 of
    the 8 P-cores** -- the hottest, highest-power silicon -- because Intel
    hybrid parts interleave the core types (P at 0,1,10-13,22,23 here) rather
    than listing the P-cores first. A count-based cap cannot express that.
    """
    from ml.train.train import logical_cores_by_efficiency

    by_class = logical_cores_by_efficiency()
    if len(by_class) < 2:
        pytest.skip("not a hybrid CPU")

    applied = cap_cpu()

    assert applied["p_cores_used"] == 0
    assert applied["p_cores_total"] > 0
    assert applied["cores_allowed"] > 0


def test_the_topology_is_read_not_assumed() -> None:
    """P-cores are not simply the first N ids, and assuming so inverts the fix."""
    from ml.train.train import logical_cores_by_efficiency

    by_class = logical_cores_by_efficiency()
    if len(by_class) < 2:
        pytest.skip("not a hybrid CPU")

    performance = by_class[max(by_class)]
    efficiency = by_class[min(by_class)]

    assert performance and efficiency
    assert not set(performance) & set(efficiency), "a core cannot be both"
    assert max(performance) > min(efficiency), (
        "P-core ids are interleaved with E-core ids on this part; a layout "
        "assumption that puts all P-cores first would be wrong here"
    )


def test_the_cap_reports_zero_affinity_rather_than_claiming_an_unset_one() -> None:
    """A cap that cannot be applied must say so, not report success.

    Affinity is unavailable on some platforms and inside some containers. The
    dangerous outcome is a run that believes it is bounded and is not.
    """
    import ml.train.train as module

    psutil = pytest.importorskip("psutil")
    original = psutil.Process.cpu_affinity

    def _refuse(self: object, *args: object) -> None:
        raise OSError("affinity unavailable")

    psutil.Process.cpu_affinity = _refuse  # type: ignore[assignment]
    try:
        applied = module.cap_cpu()
    finally:
        psutil.Process.cpu_affinity = original  # type: ignore[assignment]

    assert applied["affinity"] == 0
    assert applied["threads"] == MAIN_PROCESS_THREADS  # the other levers still applied


def test_opencv_is_capped_because_omp_does_not_cover_it() -> None:
    """OpenCV keeps its own pool and was the actual source of 100% CPU.

    It is not governed by `OMP_NUM_THREADS`, so a run capped only through the
    OMP variables leaves the decode/resize/mosaic work uncapped in every worker.
    """
    cv2 = pytest.importorskip("cv2")

    applied = cap_cpu(workers=4)
    assert applied["cv2_threads"] == WORKER_CV2_THREADS
    assert cv2.getNumThreads() == WORKER_CV2_THREADS

    applied = cap_cpu(workers=0)
    assert applied["cv2_threads"] == MAIN_PROCESS_THREADS, (
        "with no workers the main process does the image work and needs the threads"
    )


def test_the_worker_init_hook_is_picklable() -> None:
    """Windows spawns workers and pickles `worker_init_fn` by qualified name.

    A closure raises `Can't get local object` and takes the dataloader down
    before the first batch. Measured 2026-09-01: the closure version looked
    correct and could never have run, so this asserts the property that
    distinguishes them rather than the behaviour they share.
    """
    import pickle

    pytest.importorskip("ultralytics")
    restored = pickle.loads(pickle.dumps(capped_seed_worker))
    assert restored is capped_seed_worker


def test_patching_the_worker_hook_preserves_the_original_seeding() -> None:
    """Seeding is what makes a run reproducible; the cap must not cost it."""
    pytest.importorskip("ultralytics")
    from ultralytics.data import build as build_module

    cap_worker_threads()

    assert build_module.seed_worker is capped_seed_worker
    assert getattr(build_module, "_seed_worker_uncapped", None) is not None
    assert cap_worker_threads() is False, "patching twice must not nest the wrapper"


def test_the_worker_hook_caps_threads_when_it_runs() -> None:
    cv2 = pytest.importorskip("cv2")
    pytest.importorskip("ultralytics")

    cv2.setNumThreads(8)
    cap_worker_threads()
    capped_seed_worker(0)

    assert cv2.getNumThreads() == WORKER_CV2_THREADS


# --------------------------------------------------------------------------
# The monitor
# --------------------------------------------------------------------------


def test_a_missing_gpu_reading_is_none_and_never_zero() -> None:
    """0% utilisation and "the driver did not answer" must not look alike.

    They are the same number for opposite reasons: one is a starving dataloader,
    which is the condition this module exists to detect, and the other is no
    measurement at all.
    """
    reading = read_gpu()
    assert reading is None or (len(reading) == 4 and all(isinstance(v, float) for v in reading))


def test_an_empty_monitor_summarises_without_raising() -> None:
    assert ResourceMonitor().summary() == Summary()


def test_percentiles_bracket_the_data() -> None:
    values = [float(v) for v in range(101)]
    assert _percentile(values, 0.0) == 0.0
    assert _percentile(values, 0.5) == 50.0
    assert _percentile(values, 1.0) == 100.0
    assert _percentile([7.0], 0.95) == 7.0


def test_the_monitor_samples_on_its_own_thread() -> None:
    import time

    with ResourceMonitor(interval_s=0.05) as monitor:
        time.sleep(0.4)
    summary = monitor.summary()

    assert summary.samples >= 2
    assert summary.ram_max_gb > 0


# --------------------------------------------------------------------------
# The benchmark result
# --------------------------------------------------------------------------


def _result(epochs: list[EpochTiming]) -> BenchResult:
    return BenchResult(
        label="t", workers=4, cache="disk", batch=8, imgsz=1024, accumulate=4, epochs=epochs
    )


def test_the_quoted_epoch_is_the_last_not_the_first() -> None:
    """The first epoch pays warmup, the AMP check and any cache building.

    Quoting it would understate every configuration, and by *different* amounts,
    since a cold cache costs a cold-cache configuration more -- which would
    reverse a comparison rather than merely blur it.
    """
    result = _result(
        [
            EpochTiming(index=1, train_s=200.0, total_s=220.0, batches=576),
            EpochTiming(index=2, train_s=80.0, total_s=90.0, batches=576),
        ]
    )

    assert result.steady is not None
    assert result.steady.index == 2
    assert result.minutes_per_epoch == pytest.approx(1.5)
    assert result.screening_hours(60) == pytest.approx(1.5)


def test_a_result_with_no_epochs_reports_zero_rather_than_dividing_by_zero() -> None:
    empty = _result([])

    assert empty.steady is None
    assert empty.minutes_per_epoch == 0.0
    assert empty.images_per_s == 0.0
    assert "t" in render([empty])


def test_throughput_counts_images_not_batches() -> None:
    result = _result([EpochTiming(index=1, train_s=100.0, total_s=110.0, batches=500)])

    assert result.steady is not None
    assert result.steady.iterations_per_s == pytest.approx(5.0)
    assert result.images_per_s == pytest.approx(40.0)  # 5 it/s x batch 8


# --------------------------------------------------------------------------
# The pre-resize
# --------------------------------------------------------------------------


def test_the_presize_target_matches_ultralytics_load_image() -> None:
    """Downscale, upscale and the no-op, against `load_image`'s own arithmetic."""
    from scripts.presize_cache import target_shape

    assert target_shape(2048, 2048, 1024) == (1024, 1024)  # the case worth doing
    assert target_shape(256, 256, 1024) == (1024, 1024)  # an upscale
    assert target_shape(1024, 1024, 1024) == (1024, 1024)  # already there, no resize
    assert target_shape(2048, 1024, 1024) == (512, 1024)  # long side to imgsz


def test_a_resized_cache_entry_is_what_load_image_would_have_produced() -> None:
    """The claim the whole optimisation rests on: identical tensors.

    Not "close" -- identical. The pre-resize applies the same `cv2.resize` call
    with the same interpolation, so a difference here would mean the two cells
    already finished are no longer comparable with the ten still to run.
    """
    cv2 = pytest.importorskip("cv2")
    from scripts.presize_cache import resize_to_imgsz

    rng = np.random.default_rng(0)
    source = rng.integers(0, 256, size=(2048, 2048, 3), dtype=np.uint8)

    ours = resize_to_imgsz(source, 1024)
    theirs = cv2.resize(source, (1024, 1024), interpolation=cv2.INTER_LINEAR)

    assert isinstance(ours, np.ndarray)
    assert np.array_equal(ours, theirs)


def test_the_plan_skips_upscales_because_they_cost_disk_rather_than_saving_it(
    tmp_path: Path,
) -> None:
    """Pre-resizing everything is the obvious implementation and a net loss.

    Materialising the 256->1024 upscale turns a 0.20 MB entry into 3.15 MB, so
    the 3,291 of them would add ~9.6 GB of cache *and* 9.6 GB of read per epoch
    to save a 0.5 ms resize that is cheaper than the extra read.
    """
    from scripts.presize_cache import plan

    np.save(tmp_path / "big.npy", np.zeros((2048, 2048, 3), dtype=np.uint8))
    np.save(tmp_path / "small.npy", np.zeros((256, 256, 3), dtype=np.uint8))
    np.save(tmp_path / "exact.npy", np.zeros((1024, 1024, 3), dtype=np.uint8))

    oversized, total, saved = plan(tmp_path, 1024)

    assert total == 3
    assert [p.name for p in oversized] == ["big.npy"]
    assert saved == (2048 * 2048 - 1024 * 1024) * 3


def test_rewriting_leaves_no_partial_file_behind(tmp_path: Path) -> None:
    """A truncated .npy is preferred over the .png and fails inside a worker.

    That is the least legible place for it to fail, which is why the rewrite
    goes through a temporary name and renames only once the write completed.
    """
    pytest.importorskip("cv2")
    from scripts.presize_cache import plan, rewrite

    path = tmp_path / "img.npy"
    np.save(path, np.zeros((2048, 2048, 3), dtype=np.uint8))

    oversized, _, _ = plan(tmp_path, 1024)
    assert rewrite(oversized, 1024) == 1

    assert np.load(path).shape == (1024, 1024, 3)
    assert list(tmp_path.glob("*.partial*")) == []
    assert sorted(p.name for p in tmp_path.iterdir()) == ["img.npy"]


# --------------------------------------------------------------------------
# The worker choice, which is a measurement rather than a preference
# --------------------------------------------------------------------------


def test_the_default_worker_count_is_the_measured_optimum() -> None:
    """2, from a 0/2/4 sweep on the real split -- not a round number picked by feel.

    It is the configuration that maximised **GPU** utilisation (70.4%, against
    67.6% at 4 workers and 37.5% at 0) while keeping machine-wide RAM at the
    ceiling rather than 5.5 GB past it. Worth pinning because the intuitive move
    is the wrong one twice over: more workers past this point cost RAM *and*
    lower GPU utilisation, and fewer workers to "spare the CPU" halve it.
    """
    from ml.train.train import DEFAULT_WORKERS, PAPER_WORKERS

    assert DEFAULT_WORKERS == 2
    assert DEFAULT_WORKERS < PAPER_WORKERS, "still a deviation, still must be reported"


def test_the_per_worker_cost_is_machine_wide_not_summed_rss() -> None:
    """Summed per-process memory cannot answer a machine-wide question.

    Working set undercounts shared pages; summed RSS over-counts pages shared
    between workers. Both earlier constants came from per-process figures and
    both were wrong. The value here is a difference of machine-wide readings
    across a sweep, so it must be near the measured 2.7-3.2 GB rather than the
    1.3 GB that reading made workers look cheap enough to overcommit.
    """
    from ml.train.train import PER_WORKER_GB

    assert 2.5 <= PER_WORKER_GB <= 3.3
