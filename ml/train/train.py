"""PHASE-02 training entry point.

Trains a YOLO-seg model on the dataset `scripts/build_dataset.py` assembles.
Hyperparameters follow P004 section 2.7 -- `epochs=100, imgsz=1024, lr0=0.01,
workers=8`, official defaults otherwise -- because the paper deliberately did
not tune, so the architecture is what the ablation measures.

Two things here are project constraints rather than preferences, and both are
set explicitly instead of being left to whatever ultralytics defaults to this
release:

**Rotation, shear and perspective are pinned to zero.** `CONSTRAINTS.md`: a
rotation invalidates the pixel-to-geo mapping on geocoded imagery, and every
downstream stage -- proximity scoring, drift seeding, the AIS gate -- reads
geometry out of that mapping. Mirroring is the augmentation P004 used and the
only one that survives geocoding. These are ultralytics defaults *today*; a
future release changing one would silently corrupt the geometry, so they are
stated.

**The physical batch is detected, then recorded.** `backend/device.py` derives
it from real VRAM so the repository moves between machines unedited, and
`nbs=32` holds the *effective* batch at 32 everywhere via gradient accumulation.
That is what keeps a grid split across two GPUs comparable to Zhao et al.
Table 1 -- but only if the physical batch is reported alongside the numbers.
`run_config` returns exactly what should be pasted into `ml/ablation/results.md`.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from backend.device import NOMINAL_BATCH, resolve_device, suggest_batch_size

# P004 section 2.7. Changing one of these makes our ablation incomparable to
# theirs, which is the whole reason the numbers are worth producing.
PAPER_EPOCHS = 100
PAPER_IMGSZ = 1024
PAPER_LR0 = 0.01
PAPER_WORKERS = 8

# Dataloader workers actually used. **A deliberate deviation from P004 §2.7's
# `workers=8`, agreed with the user 2026-08-31**, and the only one in this file.
#
# It is safe to deviate here in a way it would not be for batch, lr or epochs:
# `workers` governs how many host processes prefetch batches, not the model, the
# optimiser or the arithmetic. Results are unchanged; only throughput moves.
#
# Why it was needed: at `workers=8` each worker buffers 1024x1024x3 batches and
# the run reached **98% of machine-wide RAM**, which made the machine unusable
# for anything else. Record this alongside any result, because a reader
# comparing wall-clock to the paper needs to know.
#
# Measured 2026-09-01 across a 0/2/4 sweep on the real split: 2 gives the
# **highest GPU utilisation of any configuration tried** (70.4%, against 67.6%
# at 4 and 37.5% at 0) while holding machine-wide RAM at 24.18 GB against the
# 24 GB ceiling, where 4 workers reached 29.63 GB. More workers past this point
# buy 6% wall-clock for 5.5 GB of RAM and *lower* GPU utilisation.
DEFAULT_WORKERS = 2

# Ceiling on machine-wide RAM. **An absolute figure, not a fraction** -- set by
# the user 2026-08-31 and tightened here on 2026-09-01 from the 0.80 fraction
# that preceded it. On this 31.4 GB machine the fraction worked out to 25.1 GB;
# 24 GB is what the user actually asked for, and expressing it as a constant
# means moving to a larger machine cannot silently raise it.
RAM_CEILING_GB = 24.0

# Machine-wide CPU ceiling from `CONSTRAINTS.md`, expressed as the share of
# logical cores this process tree may be scheduled on.
#
# **Affinity applied in-process is the actual guarantee, and it is inherited.**
# A tree pinned to 19 of 24 cores cannot exceed 19/24 = 79% machine-wide however
# many threads it spawns -- that is arithmetic, not a heuristic. Two corrections
# to what `HANDOFF.md` recorded on 2026-08-31, both measured 2026-09-01:
#
#   * "affinity alone does not cap CPU" was the wrong diagnosis. It does cap the
#     machine-wide figure. What failed was the *delivery*: `scripts/cap_cpu.ps1`
#     only touches processes that are alive when it runs, and dataloader workers
#     spawn afterwards, so the workers -- the processes doing the image work --
#     were never capped. Setting affinity here, before they spawn, fixes it,
#     because Windows children inherit the parent's mask.
#   * OpenCV was never capped at all and is not covered by `OMP_NUM_THREADS`. It
#     keeps its own pool, which defaulted to all 24 threads in every worker --
#     the actual source of the 100% CPU the user saw on 2026-09-01. It sizes
#     that pool from the affinity mask, so pinning fixes it too (measured: 24
#     threads before, 19 after), and it is set explicitly as well.
CPU_CEILING_FRACTION = 0.80

# Compute threads for the **main** process. The heavy arithmetic is on the GPU;
# six threads avoid contention with the dataloader workers.
MAIN_PROCESS_THREADS = 6

# One OpenCV thread per loader worker prevents nested oversubscription.
WORKER_CV2_THREADS = 1

# Cache decoded, letterboxed images to disk as .npy. **The point is to move work
# off the CPU, not to save time per se.** Measured mid-run: GPU utilisation sat
# at 58% while the CPU held 28% -- the card was idling between batches waiting
# for images to be decoded and resized, every image, every epoch.
#
# 'disk' pays that cost once and memory-maps thereafter, and because the cache
# lives beside the dataset it is shared by **all twelve ablation cells** rather
# than rebuilt per run. 'ram' would be faster still and is not an option here:
# the RAM ceiling is already the binding constraint.
#
# Roughly 3 MB per image at imgsz=1024, so ~16 GB for this dataset.
DEFAULT_CACHE = "disk"

# Measured 2026-09-01 from a worker sweep on the real split, which is what these
# should always have come from.
#
# Both earlier estimates were derived from **per-process** figures and both were
# wrong. 0.8 GB came from working set, which undercounts shared and cached
# pages; 1.3 GB came from summed RSS, which over-counts pages shared *between*
# workers. Summing per-process memory cannot answer a machine-wide question in
# either direction, and the error that survived made workers look cheap -- so
# the guard picked too many and the run went straight back to 98%.
#
# The honest measurement is the machine-wide figure, differenced across a sweep:
#
#   workers=0  17.70 GB
#   workers=2  24.18 GB   -> 3.24 GB per worker
#   workers=4  29.63 GB   -> 2.72 GB per worker
#
# Base is what workers=0 costs above the machine's own baseline (14.06 GB of the
# user's applications at the time of measurement).
TRAINER_BASE_GB = 4.0
PER_WORKER_GB = 2.9

# Held back from the budget so the estimate can be wrong in our favour. The cost
# of being wrong is asymmetric: too few workers is slower, too many is a machine
# the user cannot type on.
#
# Reduced from 2.0 now that the per-worker figure is measured rather than
# inferred -- the reserve was covering for a constant that was wrong by 2x, and
# stacking a large reserve on top of a corrected constant just double-counts the
# same caution. The derivation stays deliberately conservative and **an explicit
# `--workers` is still preferred for a long run**: it rounds down, and it reads
# the machine at one instant while a grid runs for hours.
RAM_RESERVE_GB = 1.0

# Agreed with the user 2026-08-31: screen all twelve variants at this depth,
# then full-train the best two plus the baseline at PAPER_EPOCHS. Must be stated
# in the results table -- a screened grid is not a 100-epoch grid.
SCREENING_EPOCHS = 60

# Enough to prove the plumbing works and nothing else. A smoke run is not a
# result and must never be reported as one.
SMOKE_EPOCHS = 2
SMOKE_IMAGES = 64

# The normal unattended task stays below one hour. Longer sessions are only
# used when explicitly requested and remain bounded to four hours.
DEFAULT_TRAINING_CHUNK_MINUTES = 45.0
MAX_TRAINING_SESSION_MINUTES = 240.0

# Process-only GPU limits requested 2026-09-01. CUDA exposes a per-process VRAM
# cap but no per-process "compute percentage" switch. Compute is therefore
# bounded with an in-process duty cycle: after each batch, this training process
# sleeps long enough that even a batch which held the GPU at 100% averages about
# 80% over work + rest. Other applications and the laptop power profile are
# untouched.
GPU_MEMORY_FRACTION = 0.80
GPU_COMPUTE_FRACTION = 0.80

# Share of VRAM auto-batch aims to occupy. Ultralytics' own default leaves
# room for fragmentation and the validation pass; going much above this trades a
# marginally larger batch for an out-of-memory hours into a run. Raised from
# 0.70 to 0.80 on 2026-09-01 with the process cap lifted -- the headroom this
# leaves is now for fragmentation and validation alone, not for a second cap
# stacked on top of it.
AUTO_BATCH_FRACTION = 0.80

DEFAULT_MODEL = "yolo11n-seg.pt"


class TrainingError(RuntimeError):
    """Training could not be started as configured."""


@dataclass(frozen=True, slots=True)
class RunConfig:
    """Everything that must be recorded next to a result."""

    name: str
    data: Path
    model: str
    epochs: int
    imgsz: int
    batch: int
    nbs: int
    accumulate: int
    device: str
    gpu: str | None
    vram_gb: float | None
    amp: bool
    workers: int = DEFAULT_WORKERS
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "data": str(self.data),
            "model": self.model,
            "epochs": self.epochs,
            "imgsz": self.imgsz,
            "batch": self.batch,
            "nbs": self.nbs,
            "accumulate": self.accumulate,
            "device": self.device,
            "gpu": self.gpu,
            "vram_gb": self.vram_gb,
            "amp": self.amp,
            "workers": self.workers,
            "workers_paper": PAPER_WORKERS,
            **self.extra,
        }


# Augmentation that would break the pixel-to-geo mapping. Zeroed explicitly;
# see the module docstring.
GEOMETRY_PRESERVING_AUGMENTATION: dict[str, float] = {
    "degrees": 0.0,  # rotation -- forbidden by CONSTRAINTS.md
    "shear": 0.0,
    "perspective": 0.0,
    "fliplr": 0.5,  # mirroring: what P004 used, and geometry-safe
    "flipud": 0.5,
}


def run_config(
    data: Path,
    *,
    name: str,
    model: str = DEFAULT_MODEL,
    epochs: int = PAPER_EPOCHS,
    imgsz: int = PAPER_IMGSZ,
    batch: int | None = None,
    workers: int = DEFAULT_WORKERS,
) -> RunConfig:
    """Resolve the run against this machine, without starting it."""

    info = resolve_device()
    resolved = batch if batch is not None else suggest_batch_size(info.vram_gb)
    if resolved < 1:
        raise TrainingError(f"resolved batch {resolved} is not trainable")

    return RunConfig(
        name=name,
        data=data,
        model=model,
        epochs=epochs,
        imgsz=imgsz,
        batch=resolved,
        nbs=NOMINAL_BATCH,
        # `round`, not floor: this mirrors what ultralytics actually does
        # (`accumulate = max(round(nbs / batch), 1)`). Flooring reports 2 for a
        # batch of 12 where the trainer really uses 3, which understates the
        # effective batch in the one number the ablation's comparability rests
        # on. `backend/device.py` still floors; it agrees for 8 and 32 and
        # differs only on the 16 GB machine's batch of 12.
        accumulate=max(1, round(NOMINAL_BATCH / resolved)),
        device=info.device,
        gpu=info.name,
        vram_gb=round(info.vram_gb, 1) if info.vram_gb else None,
        amp=info.is_cuda,
        workers=workers,
    )


def ram_budget_gb(
    *,
    ceiling_gb: float = RAM_CEILING_GB,
    base_gb: float = TRAINER_BASE_GB,
) -> tuple[float, float]:
    """`(baseline_gb, budget_gb)` -- what the machine already holds, and what is
    left for dataloader workers under the absolute ceiling.

    Split out from `workers_for_available_ram` so the benchmark and the progress
    runner can *report* the budget without also acting on it. A worker count
    printed with no baseline beside it is unreadable: 0 workers on a machine at
    21 GB and 0 workers on a machine at 8 GB mean completely different things.
    """

    import psutil

    memory = psutil.virtual_memory()
    baseline_gb = (memory.total - memory.available) / 1024**3
    return baseline_gb, ceiling_gb - baseline_gb - base_gb - RAM_RESERVE_GB


def workers_for_available_ram(
    *,
    ceiling_gb: float = RAM_CEILING_GB,
    base_gb: float = TRAINER_BASE_GB,
    per_worker_gb: float = PER_WORKER_GB,
    maximum: int = PAPER_WORKERS,
) -> int:
    """Largest worker count that keeps machine-wide RAM under `ceiling_gb`.

    Derived from what is **in use right now**, not from total RAM, because the
    ceiling is machine-wide: SNAP's JVM holds 7+ GB while it runs and the user's
    own applications hold more. A count computed against total memory would be
    right on an idle machine and wrong on this one.

    **The ceiling is an absolute number of gigabytes, not a fraction.** It was a
    fraction until 2026-09-01, which on a larger machine would have quietly
    licensed a larger footprint than the user ever agreed to.

    Returns 0 rather than raising when even the base process will not fit: 0 is
    a valid ultralytics setting (the main process loads its own data), and
    refusing to train at all would be a worse answer than training slowly.
    """

    _, budget_gb = ram_budget_gb(ceiling_gb=ceiling_gb, base_gb=base_gb)
    if budget_gb <= 0:
        return 0
    return max(0, min(maximum, int(budget_gb // per_worker_gb)))


def logical_cores_by_efficiency() -> dict[int, list[int]]:
    """`{EfficiencyClass: [logical cpu ids]}` on Windows hybrid CPUs, else `{}`.

    Intel hybrid parts interleave the two core types rather than listing all the
    P-cores first, and **assuming the layout gets it exactly backwards.** Measured
    on this machine (Core Ultra 9 275HX, 24 cores, no SMT):

        P-cores  0, 1, 10, 11, 12, 13, 22, 23
        E-cores  2-9, 14-21

    So a naive `range(19)` cap -- which is what this module did until 2026-09-01
    -- lands on **6 of the 8 P-cores**, concentrating the dataloader on the
    hottest, highest-power silicon on the die. The count was right and the
    placement was wrong, which a percentage-based cap cannot express.

    Read from `GetLogicalProcessorInformationEx`, because it is the only
    authority: the numbering is firmware-dependent and differs between parts.
    Returns `{}` on anything that cannot answer, so the caller falls back to a
    plain count rather than trusting a guess.
    """

    import ctypes
    import ctypes.wintypes

    relation_processor_core = 0
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    except (AttributeError, OSError):
        return {}  # not Windows

    size = ctypes.wintypes.DWORD(0)
    kernel32.GetLogicalProcessorInformationEx(relation_processor_core, None, ctypes.byref(size))
    if not size.value:
        return {}
    buffer = (ctypes.c_ubyte * size.value)()
    if not kernel32.GetLogicalProcessorInformationEx(
        relation_processor_core, buffer, ctypes.byref(size)
    ):
        return {}

    raw = bytes(buffer)
    found: dict[int, list[int]] = {}
    offset = 0
    # SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX: Relationship(4) Size(4), then
    # PROCESSOR_RELATIONSHIP: Flags(1) EfficiencyClass(1) Reserved(20)
    # GroupCount(2) at +30, GROUP_AFFINITY[] at +32 (Mask 8, Group 2, Reserved 6).
    while offset + 8 <= size.value:
        relationship = int.from_bytes(raw[offset : offset + 4], "little")
        entry = int.from_bytes(raw[offset + 4 : offset + 8], "little")
        if not entry:
            break
        if relationship == relation_processor_core:
            efficiency = raw[offset + 9]
            groups = int.from_bytes(raw[offset + 30 : offset + 32], "little") or 1
            for group in range(groups):
                base = offset + 32 + group * 16
                mask = int.from_bytes(raw[base : base + 8], "little")
                found.setdefault(efficiency, []).extend(i for i in range(64) if mask >> i & 1)
        offset += entry
    return {klass: sorted(cpus) for klass, cpus in found.items()}


def allowed_cores(fraction: float = CPU_CEILING_FRACTION, *, prefer_efficiency: bool = True) -> list[int]:
    """Which logical CPUs this process tree may run on.

    **Placement, not just a count.** Preferring efficiency cores keeps the
    dataloader off the hotter performance cores.

    Falls back to the first N cores when the topology cannot be read, or when
    there are not enough efficiency cores to fill the budget.
    """

    total = os.cpu_count() or 1
    budget = max(1, int(total * fraction))

    if prefer_efficiency:
        by_class = logical_cores_by_efficiency()
        if len(by_class) > 1:
            slowest = min(by_class)
            efficiency_cores = by_class[slowest]
            if efficiency_cores:
                return efficiency_cores[:budget]
    return list(range(budget))


def cap_cpu(
    *,
    fraction: float = CPU_CEILING_FRACTION,
    threads: int = MAIN_PROCESS_THREADS,
    workers: int | None = None,
    prefer_efficiency: bool = True,
) -> dict[str, int]:
    """Bound this process **and every child** to `fraction` of the logical cores.

    Call once, early, and before the dataloader workers are created. Returns
    what was applied, so a run can record it rather than assert it.

    Three levers, and they are not interchangeable:

    * **Affinity** is the guarantee. A tree pinned to N of M cores cannot exceed
      N/M machine-wide, and on Windows a child inherits the parent's mask -- so
      doing this before the workers spawn caps the workers too, which is the
      part `scripts/cap_cpu.ps1` structurally could not do from outside.
    * **Thread counts** (OMP and friends) reduce oversubscription *within* the
      allowed cores. They change how efficiently the cap is used, not what it is.
    * **OpenCV's own pool** is covered by neither of the above by default. It is
      where the per-image decode, resize and mosaic work happens, so an uncapped
      pool in each of several workers is what actually saturates a machine.

    `workers` lets the OpenCV budget follow where the image work is: with
    workers=0 the main process does all of it and wants the threads; with
    workers>0 it does none of it and one thread is right, because the
    parallelism is already there at the process level.
    """

    cores = allowed_cores(fraction, prefer_efficiency=prefer_efficiency)
    total = os.cpu_count() or 1
    allowed = len(cores)

    by_class = logical_cores_by_efficiency() if prefer_efficiency else {}
    performance = set(by_class[max(by_class)]) if len(by_class) > 1 else set()

    applied = {
        "cores_total": total,
        "cores_allowed": allowed,
        "threads": threads,
        "p_cores_used": len(performance.intersection(cores)),
        "p_cores_total": len(performance),
    }

    try:
        import psutil

        psutil.Process().cpu_affinity(cores)
        applied["affinity"] = allowed
    except (ImportError, AttributeError, OSError):
        # Affinity is unavailable on some platforms and inside some containers.
        # The thread caps below still apply; record that the guarantee is absent
        # rather than reporting a cap that was never set.
        applied["affinity"] = 0

    for variable in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[variable] = str(threads)

    try:
        import torch

        torch.set_num_threads(threads)
    except ImportError:
        pass

    cv_threads = threads if not workers else WORKER_CV2_THREADS
    try:
        import cv2

        cv2.setNumThreads(cv_threads)
        applied["cv2_threads"] = cv2.getNumThreads()
    except ImportError:
        applied["cv2_threads"] = 0

    return applied


def cap_cpu_threads(fraction: float = CPU_CEILING_FRACTION) -> int:
    """Backwards-compatible shim for `cap_cpu`. Returns the thread count applied."""

    return cap_cpu(fraction=fraction)["threads"]


def capped_seed_worker(worker_id: int) -> None:
    """Ultralytics' `seed_worker`, plus a thread cap, run inside each worker.

    **Module-level, and it has to be.** Windows starts dataloader workers with
    `spawn`, which pickles `worker_init_fn` by qualified name -- so a closure
    fails with `Can't get local object`, taking the whole dataloader down before
    the first batch. Measured 2026-09-01; the closure version looked correct and
    could never have run.

    The original is looked up at call time rather than captured, so this stays
    picklable and still delegates to whatever ultralytics currently installs.
    Seeding first, because that is what makes a run reproducible and it must not
    be lost to a thread-count change.
    """

    from ultralytics.data import build as build_module

    original = getattr(build_module, "_seed_worker_uncapped", None)
    if original is not None:
        original(worker_id)

    try:
        import cv2

        cv2.setNumThreads(WORKER_CV2_THREADS)
    except ImportError:
        pass
    try:
        import torch

        torch.set_num_threads(WORKER_CV2_THREADS)
    except ImportError:
        pass


def cap_worker_threads() -> bool:
    """Make every dataloader worker cap its own OpenCV pool. Returns True if patched.

    **A worker cannot inherit this setting, which is why a patch is needed.**
    `cv2.setNumThreads` is process-local state, and Windows spawns workers as
    fresh interpreters that re-import cv2 and size its pool from scratch. The
    parent's call therefore governs the parent alone -- so with `workers=4` the
    four processes doing all the decoding, resizing and mosaicking were the exact
    four the cap never reached. That was the source of the 100% CPU on
    2026-09-01.

    Ultralytics passes `seed_worker` as `worker_init_fn`, the one hook that runs
    inside a worker before any batch. The original is stashed under
    `_seed_worker_uncapped` rather than discarded, so the seeding survives and
    the patch is idempotent.

    Affinity already bounds the machine-wide total on its own. This reduces
    contention *within* that bound -- throughput, not safety.
    """

    try:
        from ultralytics.data import build as build_module
    except ImportError:
        return False

    if getattr(build_module, "_seed_worker_uncapped", None) is not None:
        return False  # already patched

    original = getattr(build_module, "seed_worker", None)
    if original is None:
        return False

    build_module._seed_worker_uncapped = original  # type: ignore[attr-defined]
    build_module.seed_worker = capped_seed_worker  # type: ignore[assignment]
    return True


def cap_gpu_memory(fraction: float = GPU_MEMORY_FRACTION) -> bool:
    """Bound this process to `fraction` of VRAM. Returns False with no CUDA device.

    Applied before the model is built, because the limit only governs
    allocations made after it is set.
    """

    import torch

    if not torch.cuda.is_available():
        return False
    if not 0.0 < fraction <= 1.0:
        raise TrainingError(f"GPU memory fraction must be in (0, 1], got {fraction}")
    torch.cuda.set_per_process_memory_fraction(fraction, 0)
    return True


class GpuDutyCycleLimiter:
    """Throttle only the caller's GPU work to an approximate duty cycle.

    Instantaneous GPU samples may still show 100% while a CUDA kernel is
    executing; the enforced quantity is the work/rest average. Sleeping in the
    training callback is deliberately process-local and changes no system-wide
    NVIDIA, Windows, or Armoury Crate setting.
    """

    def __init__(
        self,
        fraction: float = GPU_COMPUTE_FRACTION,
        *,
        clock: Callable[[], float] | None = None,
        sleeper: Callable[[float], None] | None = None,
    ) -> None:
        if not 0.0 < fraction <= 1.0:
            raise TrainingError(f"GPU compute fraction must be in (0, 1], got {fraction}")
        self.fraction = fraction
        self.clock = clock or time.perf_counter
        self.sleeper = sleeper or time.sleep
        self._batch_started: float | None = None
        self.total_work_s = 0.0
        self.total_sleep_s = 0.0

    def on_batch_start(self, _: Any) -> None:
        self._batch_started = self.clock()

    def on_batch_end(self, _: Any) -> None:
        if self._batch_started is None:
            return
        work_s = max(0.0, self.clock() - self._batch_started)
        self._batch_started = None
        sleep_s = work_s * (1.0 / self.fraction - 1.0)
        self.total_work_s += work_s
        self.total_sleep_s += sleep_s
        if sleep_s > 0:
            self.sleeper(sleep_s)


def install_gpu_usage_limit(
    model: Any, fraction: float = GPU_COMPUTE_FRACTION
) -> GpuDutyCycleLimiter:
    """Install the process-only limiter for both training and validation."""

    limiter = GpuDutyCycleLimiter(fraction)
    model.add_callback("on_train_batch_start", limiter.on_batch_start)
    model.add_callback("on_train_batch_end", limiter.on_batch_end)
    model.add_callback("on_val_batch_start", limiter.on_batch_start)
    model.add_callback("on_val_batch_end", limiter.on_batch_end)
    return limiter


class TrainingTimeBudget:
    """Interrupt cleanly after an epoch checkpoint at the requested boundary.

    Ultralytics strips the optimizer from ``last.pt`` during its normal
    ``trainer.stop`` shutdown path.  A timed chunk must therefore leave that
    path *after* ``on_fit_epoch_end`` (which runs after ``save_model``) so the
    checkpoint remains genuinely resumable.
    """

    def __init__(
        self,
        minutes: float = DEFAULT_TRAINING_CHUNK_MINUTES,
        *,
        clock: Callable[[], float] | None = None,
    ) -> None:
        if not 0.0 < minutes <= MAX_TRAINING_SESSION_MINUTES:
            raise TrainingError(
                "training session must be greater than 0 and no more than "
                f"{MAX_TRAINING_SESSION_MINUTES:.0f} minutes, got {minutes}"
            )
        self.seconds = minutes * 60.0
        self.clock = clock or time.perf_counter
        self.started_at: float | None = None
        self.reached = False

    def on_train_start(self, _: Any) -> None:
        self.started_at = self.clock()

    def on_fit_epoch_end(self, trainer: Any) -> None:
        if self.started_at is None:
            return
        if self.clock() - self.started_at >= self.seconds:
            self.reached = True
            raise TrainingChunkCompleteError(
                f"training chunk reached its {self.seconds / 60:.0f}-minute boundary"
            )


class TrainingChunkCompleteError(RuntimeError):
    """Raised after an epoch checkpoint is saved, before optimizer stripping."""


def install_training_time_budget(
    model: Any, minutes: float = DEFAULT_TRAINING_CHUNK_MINUTES
) -> TrainingTimeBudget:
    """Install a clean, resumable task boundary on one model."""

    budget = TrainingTimeBudget(minutes)
    model.add_callback("on_train_start", budget.on_train_start)
    model.add_callback("on_fit_epoch_end", budget.on_fit_epoch_end)
    return budget


def resolve_auto_batch(
    model: str = DEFAULT_MODEL,
    *,
    imgsz: int = PAPER_IMGSZ,
    fraction: float = AUTO_BATCH_FRACTION,
) -> int:
    """Measure the largest batch that fits, instead of guessing one.

    `backend/device.py` derives a batch from VRAM by a lookup table and says so:
    "a starting point, not a measured limit". This profiles the real model at
    the real image size and returns what actually fits, which is both faster and
    the number PHASE-02 requires be reported.

    The result is passed back through `run_config` as an explicit batch, so the
    run record holds the *number* and never the `-1` sentinel -- an ablation row
    reading `batch: -1` would be unusable.
    """

    import torch
    from ultralytics import YOLO
    from ultralytics.utils.autobatch import check_train_batch_size

    if not torch.cuda.is_available():
        raise TrainingError("auto-batch needs a CUDA device")
    cap_gpu_memory()

    # ultralytics types `.model` as `str | None`; at runtime it is the network.
    network = cast(Any, YOLO(model).model)
    resolved = check_train_batch_size(network.cuda(), imgsz=imgsz, amp=True, batch=fraction)
    torch.cuda.empty_cache()
    return max(1, int(resolved))


def train_kwargs(
    config: RunConfig,
    *,
    project: Path,
    seed: int = 0,
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The exact keyword arguments handed to `YOLO.train`.

    `overrides` is merged last but **cannot** reintroduce a geometry-breaking
    augmentation: those are re-applied afterwards, because a caller silently
    turning rotation back on is the one mistake this module exists to prevent.
    """

    resolved: dict[str, Any] = {
        "data": str(config.data),
        "epochs": config.epochs,
        "imgsz": config.imgsz,
        "batch": config.batch,
        "nbs": config.nbs,
        "lr0": PAPER_LR0,
        "workers": config.workers,
        "cache": DEFAULT_CACHE,
        "device": 0 if config.device == "cuda" else "cpu",
        "amp": config.amp,
        "project": str(project),
        "name": config.name,
        "exist_ok": True,
        "seed": seed,
        "deterministic": True,
        **GEOMETRY_PRESERVING_AUGMENTATION,
    }
    if overrides:
        resolved.update(overrides)
        # Re-assert the constraint after the merge, not before.
        resolved.update(GEOMETRY_PRESERVING_AUGMENTATION)
    return resolved


def write_run_record(path: Path, config: RunConfig, results: dict[str, Any] | None = None) -> Path:
    """Persist the run configuration next to its weights.

    Written *before* training starts as well as after, so a run that dies
    part-way still says what it was trying to do.
    """

    payload: dict[str, Any] = {"config": config.as_dict()}
    if results is not None:
        payload["results"] = results
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path


def train(
    data: Path,
    *,
    name: str,
    model: str = DEFAULT_MODEL,
    epochs: int = PAPER_EPOCHS,
    imgsz: int = PAPER_IMGSZ,
    batch: int | None = None,
    workers: int = DEFAULT_WORKERS,
    project: Path = Path("runs/segment"),
    seed: int = 0,
    overrides: dict[str, Any] | None = None,
) -> tuple[RunConfig, Any]:
    """Run one training job, returning its configuration and results."""

    if not data.exists():
        raise TrainingError(f"no dataset descriptor at {data}. Run scripts/build_dataset.py first.")

    from ultralytics import YOLO

    cap_gpu_memory()
    config = run_config(
        data, name=name, model=model, epochs=epochs, imgsz=imgsz, batch=batch, workers=workers
    )
    write_run_record(project / name / "run.json", config)

    trained = YOLO(config.model)
    install_gpu_usage_limit(trained)
    results = trained.train(
        **train_kwargs(config, project=project, seed=seed, overrides=overrides)
    )
    write_run_record(project / name / "run.json", config, {"summary": str(results)})
    return config, results
