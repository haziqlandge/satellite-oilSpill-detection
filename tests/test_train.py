"""PHASE-02 training configuration.

These tests do not train anything. They defend the two properties that make a
trained model trustworthy rather than merely produced:

* **Geometry-breaking augmentation stays off.** A rotation invalidates the
  pixel-to-geo mapping every downstream stage reads geometry from, and the
  failure is invisible -- the model trains fine and the coordinates are wrong.
* **The physical batch is recorded.** The ablation is only comparable to Zhao
  et al. Table 1 because `nbs=32` holds the effective batch constant; an
  unreported physical batch silently invalidates that comparison.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ml.train.train import (
    AUTO_BATCH_FRACTION,
    DEFAULT_TRAINING_CHUNK_MINUTES,
    DEFAULT_WORKERS,
    GEOMETRY_PRESERVING_AUGMENTATION,
    GPU_COMPUTE_FRACTION,
    GPU_MEMORY_FRACTION,
    MAX_TRAINING_SESSION_MINUTES,
    PAPER_EPOCHS,
    PAPER_IMGSZ,
    PAPER_LR0,
    PAPER_WORKERS,
    RAM_CEILING_GB,
    RAM_RESERVE_GB,
    SCREENING_EPOCHS,
    TRAINER_BASE_GB,
    GpuDutyCycleLimiter,
    RunConfig,
    TrainingChunkCompleteError,
    TrainingError,
    TrainingTimeBudget,
    cap_gpu_memory,
    install_gpu_usage_limit,
    run_config,
    train,
    train_kwargs,
    workers_for_available_ram,
    write_run_record,
)


def _config(**overrides: object) -> RunConfig:
    base = {
        "name": "t",
        "data": Path("data.yaml"),
        "model": "yolo11n-seg.pt",
        "epochs": 100,
        "imgsz": 1024,
        "batch": 8,
        "nbs": 32,
        "accumulate": 4,
        "device": "cuda",
        "gpu": "test",
        "vram_gb": 11.9,
        "amp": True,
    }
    base.update(overrides)
    return RunConfig(**base)  # type: ignore[arg-type]


# --- the geometry constraint ----------------------------------------------


def test_rotation_shear_and_perspective_are_zero() -> None:
    """CONSTRAINTS.md: rotation invalidates the pixel-to-geo mapping.

    These are ultralytics defaults today. They are pinned because a release
    changing one would corrupt geometry silently -- the model would train
    perfectly well and every coordinate downstream would be wrong.
    """

    for knob in ("degrees", "shear", "perspective"):
        assert GEOMETRY_PRESERVING_AUGMENTATION[knob] == 0.0


def test_mirroring_is_enabled() -> None:
    """The one augmentation P004 used, and the only geometry-safe one."""

    assert GEOMETRY_PRESERVING_AUGMENTATION["fliplr"] > 0
    assert GEOMETRY_PRESERVING_AUGMENTATION["flipud"] > 0


def test_the_augmentation_reaches_the_trainer() -> None:
    """Defining the constants is not enough; they must be passed through."""

    kwargs = train_kwargs(_config(), project=Path("runs"))

    for knob, value in GEOMETRY_PRESERVING_AUGMENTATION.items():
        assert kwargs[knob] == value


# --- the paper's hyperparameters -------------------------------------------


def test_paper_hyperparameters_are_passed_unchanged() -> None:
    kwargs = train_kwargs(_config(), project=Path("runs"))

    assert kwargs["lr0"] == PAPER_LR0
    assert kwargs["imgsz"] == PAPER_IMGSZ
    assert kwargs["epochs"] == 100


def test_the_paper_constants_are_what_the_paper_says() -> None:
    assert (PAPER_EPOCHS, PAPER_IMGSZ, PAPER_LR0, PAPER_WORKERS) == (100, 1024, 0.01, 8)


def test_the_screening_depth_is_the_agreed_one() -> None:
    """Decided with the user 2026-08-31 and recorded in HANDOFF."""

    assert SCREENING_EPOCHS == 60
    assert SCREENING_EPOCHS < PAPER_EPOCHS


# --- batch and accumulation -------------------------------------------------


def test_accumulation_matches_what_ultralytics_actually_computes(tmp_path: Path) -> None:
    """`accumulate = max(round(nbs / batch), 1)` -- rounded, not floored.

    Flooring reports 2 for a batch of 12 where the trainer really uses 3. That
    number is the one the ablation's comparability to Zhao et al. rests on, so
    reporting it wrong is worse than not reporting it.
    """

    for batch in (8, 12, 32):
        config = run_config(tmp_path / "data.yaml", name="t", batch=batch)
        assert config.accumulate == max(round(32 / batch), 1)


def test_the_effective_batch_lands_at_about_thirty_two(tmp_path: Path) -> None:
    """What makes a grid split across two GPUs comparable at all."""

    for batch in (8, 12, 32):
        config = run_config(tmp_path / "data.yaml", name="t", batch=batch)
        effective = config.batch * config.accumulate
        assert abs(effective - config.nbs) <= 4, f"batch {batch} -> effective {effective}"


def test_an_explicit_batch_overrides_detection(tmp_path: Path) -> None:
    config = run_config(tmp_path / "data.yaml", name="t", batch=4)

    assert config.batch == 4
    assert config.accumulate == 8  # 32 / 4


def test_a_zero_batch_is_refused(tmp_path: Path) -> None:
    with pytest.raises(TrainingError, match="not trainable"):
        run_config(tmp_path / "data.yaml", name="t", batch=0)


def test_nbs_reaches_the_trainer() -> None:
    """Dropping `nbs` would leave the effective batch at the physical one."""

    assert train_kwargs(_config(), project=Path("runs"))["nbs"] == 32


# --- the run record ---------------------------------------------------------


def test_the_physical_batch_is_in_the_record(tmp_path: Path) -> None:
    """An unreported batch change silently invalidates the comparison."""

    path = write_run_record(tmp_path / "run.json", _config(batch=8))
    payload = json.loads(path.read_text())

    assert payload["config"]["batch"] == 8
    assert payload["config"]["nbs"] == 32
    assert payload["config"]["accumulate"] == 4
    assert payload["config"]["gpu"] == "test"
    assert payload["config"]["vram_gb"] == 11.9


def test_a_record_is_written_before_results_exist(tmp_path: Path) -> None:
    """A run that dies part-way must still say what it was attempting."""

    payload = json.loads(write_run_record(tmp_path / "run.json", _config()).read_text())

    assert "config" in payload
    assert "results" not in payload


def test_results_are_added_when_supplied(tmp_path: Path) -> None:
    path = write_run_record(tmp_path / "run.json", _config(), {"map50": 0.5})

    assert json.loads(path.read_text())["results"]["map50"] == 0.5


# --- guardrails -------------------------------------------------------------


def test_training_without_a_dataset_is_refused(tmp_path: Path) -> None:
    with pytest.raises(TrainingError, match="no dataset descriptor"):
        train(tmp_path / "missing.yaml", name="t")


def test_cpu_disables_amp(tmp_path: Path) -> None:
    kwargs = train_kwargs(_config(device="cpu", amp=False), project=Path("runs"))

    assert kwargs["device"] == "cpu"
    assert kwargs["amp"] is False


def test_a_run_is_seeded_and_deterministic() -> None:
    kwargs = train_kwargs(_config(), project=Path("runs"), seed=7)

    assert kwargs["seed"] == 7
    assert kwargs["deterministic"] is True


def test_an_override_cannot_reintroduce_rotation() -> None:
    """The one mistake this module exists to prevent.

    A caller passing `degrees=10` -- for a smoke run, an experiment, a copied
    recipe -- must not be able to silently invalidate the geocoding.
    """

    kwargs = train_kwargs(
        _config(),
        project=Path("runs"),
        overrides={"degrees": 10.0, "shear": 5.0, "fraction": 0.01},
    )

    assert kwargs["degrees"] == 0.0
    assert kwargs["shear"] == 0.0
    assert kwargs["fraction"] == 0.01  # a harmless override still applies


# --- resource caps ---------------------------------------------------------


def test_gpu_limits_are_the_requested_eighty_percent() -> None:
    assert GPU_COMPUTE_FRACTION == 0.80
    assert GPU_MEMORY_FRACTION == 0.80
    assert AUTO_BATCH_FRACTION <= GPU_MEMORY_FRACTION


def test_gpu_duty_cycle_adds_one_part_rest_for_four_parts_work() -> None:
    times = iter((10.0, 14.0))
    sleeps: list[float] = []
    limiter = GpuDutyCycleLimiter(clock=lambda: next(times), sleeper=sleeps.append)

    limiter.on_batch_start(None)
    limiter.on_batch_end(None)

    assert sleeps == pytest.approx([1.0])
    assert limiter.total_work_s == pytest.approx(4.0)
    assert limiter.total_sleep_s == pytest.approx(1.0)


def test_gpu_duty_cycle_is_installed_only_on_the_model() -> None:
    callbacks: dict[str, object] = {}

    class _Model:
        def add_callback(self, name: str, callback: object) -> None:
            callbacks[name] = callback

    install_gpu_usage_limit(_Model())

    assert set(callbacks) == {
        "on_train_batch_start",
        "on_train_batch_end",
        "on_val_batch_start",
        "on_val_batch_end",
    }


def test_an_impossible_gpu_compute_fraction_is_refused() -> None:
    with pytest.raises(TrainingError, match="compute fraction"):
        GpuDutyCycleLimiter(1.5)


def test_training_tasks_default_to_less_than_one_hour() -> None:
    assert 0 < DEFAULT_TRAINING_CHUNK_MINUTES < 60


def test_training_time_budget_stops_at_an_epoch_boundary() -> None:
    times = iter((100.0, 100.0 + DEFAULT_TRAINING_CHUNK_MINUTES * 60))
    budget = TrainingTimeBudget(clock=lambda: next(times))

    trainer = object()
    budget.on_train_start(trainer)
    with pytest.raises(TrainingChunkCompleteError, match="45-minute boundary"):
        budget.on_fit_epoch_end(trainer)

    assert budget.reached is True


def test_training_time_budget_accepts_an_explicit_four_hour_session() -> None:
    assert TrainingTimeBudget(240).seconds == 4 * 60 * 60


def test_training_time_budget_refuses_more_than_four_hours() -> None:
    with pytest.raises(TrainingError, match="no more than 240"):
        TrainingTimeBudget(MAX_TRAINING_SESSION_MINUTES + 1)


def test_an_impossible_gpu_fraction_is_refused() -> None:
    import torch

    if not torch.cuda.is_available():
        pytest.skip("no CUDA device")
    with pytest.raises(TrainingError, match="fraction must be"):
        cap_gpu_memory(1.5)


def test_capping_without_cuda_reports_false_rather_than_raising() -> None:
    """Called unconditionally on the training path, including on CPU."""

    import torch

    if torch.cuda.is_available():
        assert cap_gpu_memory(GPU_MEMORY_FRACTION) is True
    else:
        assert cap_gpu_memory(GPU_MEMORY_FRACTION) is False


def test_workers_deviates_from_the_paper_and_says_so() -> None:
    """The one deliberate deviation from P004 section 2.7, and it must be recorded.

    `workers` governs host-side prefetching, not the model, the optimiser or the
    arithmetic -- so results are unaffected and only wall-clock moves. That is
    why it is safe to change here where batch, lr or epochs would not be. At
    `workers=8` the run reached 98% of a 31 GB machine.

    The run record carries both numbers so a reader comparing wall-clock to the
    paper can see the difference rather than having to guess at it.
    """

    assert DEFAULT_WORKERS < PAPER_WORKERS

    record = _config(workers=DEFAULT_WORKERS).as_dict()
    assert record["workers"] == DEFAULT_WORKERS
    assert record["workers_paper"] == PAPER_WORKERS


def test_the_configured_workers_reach_the_trainer() -> None:
    assert train_kwargs(_config(workers=2), project=Path("runs"))["workers"] == 2


def test_workers_are_derived_from_free_ram_not_total() -> None:
    """SNAP's JVM holds 7+ GB while it runs, and the user's apps hold more.

    A count computed against *total* RAM is right on an idle machine and wrong
    on a busy one, which is exactly the case that made the machine unusable.
    """

    derived = workers_for_available_ram()

    assert 0 <= derived <= PAPER_WORKERS


def test_a_full_machine_yields_zero_workers_rather_than_raising() -> None:
    """0 is a valid ultralytics setting -- the main process loads its own data.

    Refusing to train at all would be a worse answer than training slowly.
    """

    assert workers_for_available_ram(base_gb=10_000.0) == 0


def test_more_free_ram_permits_more_workers() -> None:
    lean = workers_for_available_ram(per_worker_gb=8.0)
    generous = workers_for_available_ram(per_worker_gb=0.1)

    assert generous >= lean


def test_the_ram_ceiling_is_an_absolute_twenty_four_gigabytes() -> None:
    """Set by the user; a **number of gigabytes**, not a share of the machine.

    It was `0.80` until 2026-09-01, which is a different quantity: on this
    31.4 GB laptop the fraction licensed 25.1 GB, and on a 64 GB machine it
    would have licensed 51 GB without anyone deciding to.
    """

    assert RAM_CEILING_GB == 24.0
    assert isinstance(RAM_CEILING_GB, float)


def test_the_ram_budget_reports_the_baseline_beside_it() -> None:
    """A worker count with no baseline next to it cannot be interpreted.

    0 workers on a machine already holding 21 GB and 0 workers on an idle one
    are the same number for opposite reasons, and only the baseline separates
    them.
    """

    from ml.train.train import ram_budget_gb

    baseline_gb, budget_gb = ram_budget_gb()

    assert baseline_gb > 0
    assert budget_gb == pytest.approx(
        RAM_CEILING_GB - baseline_gb - TRAINER_BASE_GB - RAM_RESERVE_GB
    )


def test_a_bigger_machine_does_not_raise_the_ceiling() -> None:
    """The regression the fraction would have allowed, pinned directly.

    Under a fraction, the same baseline on a larger machine permits more
    workers. Under an absolute ceiling it must not: the ceiling does not know
    how much RAM the machine has.
    """

    import ml.train.train as module

    calls: list[float] = []

    class _Memory:
        total = 64 * 1024**3
        available = 44 * 1024**3

    def _fake() -> _Memory:
        calls.append(1.0)
        return _Memory()

    import psutil

    original = psutil.virtual_memory
    psutil.virtual_memory = _fake  # type: ignore[assignment]
    try:
        # 64 GB machine, 20 GB in use. A 0.80 *fraction* would budget
        # 51.2 - 20 = 31.2 GB; the absolute ceiling budgets 24 - 20 = 4 GB.
        baseline_gb, budget_gb = module.ram_budget_gb()
    finally:
        psutil.virtual_memory = original  # type: ignore[assignment]

    assert baseline_gb == pytest.approx(20.0, abs=0.01)
    assert budget_gb == pytest.approx(
        24.0 - 20.0 - module.TRAINER_BASE_GB - module.RAM_RESERVE_GB, abs=0.01
    )
    assert budget_gb < 0  # 20 GB baseline leaves no room at all, and says so


def test_images_are_cached_to_disk_to_keep_the_gpu_fed() -> None:
    """Measured mid-run: GPU 58%, CPU 28% -- the card was waiting on decoding.

    Caching to disk moves per-epoch decode and resize off the CPU entirely, and
    the cache is shared by all twelve ablation cells rather than rebuilt per
    run. 'ram' is deliberately not used: the RAM ceiling is already binding.
    """

    from ml.train.train import DEFAULT_CACHE

    assert DEFAULT_CACHE == "disk"
    assert train_kwargs(_config(), project=Path("runs"))["cache"] == "disk"


def test_final_epoch_finishes_validation_instead_of_timing_out():
    from types import SimpleNamespace

    budget = TrainingTimeBudget(clock=lambda: 999999.0)
    budget.started_at = 0.0
    budget.on_fit_epoch_end(SimpleNamespace(epoch=99, epochs=100))
    assert not budget.reached
