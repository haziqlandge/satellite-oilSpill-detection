"""Measure the training input pipeline on this laptop, without running a cell.

PHASE-02's screening grid costs ~1.7 h per cell, so tuning it by running cells is
not affordable. This runs **one or two real epochs over the real split** and
reports what the machine did while it happened.

**One real epoch, not an extrapolated fraction.** An earlier attempt to size runs
from `fraction` is recorded in `HANDOFF.md` as a trap: ultralytics' `fraction`
takes a *contiguous prefix* of the file list, and our identities sort with every
Part III negative first, so it selects a slice that is 100% background. A
subset also distorts the thing being measured here -- the corpus mixes 256x256
and 2048x2048 sources whose per-image load costs differ by an order of
magnitude, so any subset that does not preserve that mix reports a load cost the
real epoch will not have. A full epoch has neither problem and costs ~2 minutes.

**What each knob is expected to move**, so a result that does something else is
visibly a surprise rather than quietly accepted:

| Knob | Moves | Does not move |
|---|---|---|
| `workers` | GPU utilisation, CPU, RAM | the model, the loss, the result |
| `cache` | CPU, disk read volume | the tensors the model sees |
| pre-resize | CPU, disk read volume | the tensors the model sees (bit-identical) |
| `batch` | VRAM, GPU utilisation | the *effective* batch, held at `nbs=32` |

Only `batch` is capable of changing a result, and only if `nbs` is not held --
which is why `accumulate` is recorded in every row.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ml.bench.monitor import ResourceMonitor, Summary
from ml.train.train import (
    DEFAULT_CACHE,
    RAM_CEILING_GB,
    ram_budget_gb,
    run_config,
    train_kwargs,
)

DEFAULT_DATA = Path("data/processed/dataset/oos/data.yaml")
DEFAULT_PROJECT = Path("runs/bench").resolve()

# The architecture every screening cell starts from. Benchmarking the `none`
# config rather than an LSK one keeps the numbers about the *pipeline*: LSK adds
# at most 337k parameters against 2.88M, so it moves GPU time by a few percent
# and the input pipeline not at all.
BENCH_MODEL = "yolo11n-seg.pt"

# Two epochs by default: the first pays warmup, AMP checks and any cache
# building, and reporting that as steady state would understate every
# configuration by the same misleading amount. The second is the one quoted.
DEFAULT_EPOCHS = 2


@dataclass
class EpochTiming:
    index: int
    train_s: float
    total_s: float
    batches: int

    @property
    def iterations_per_s(self) -> float:
        return self.batches / self.train_s if self.train_s else 0.0


@dataclass
class BenchResult:
    """One configuration, measured."""

    label: str
    workers: int
    cache: str | bool
    batch: int
    imgsz: int
    accumulate: int
    epochs: list[EpochTiming] = field(default_factory=list)
    resources: dict[str, Any] = field(default_factory=dict)
    train_images: int = 0
    ram_baseline_gb: float = 0.0
    note: str = ""

    @property
    def steady(self) -> EpochTiming | None:
        """The epoch to quote: the last one, never the first.

        The first pays warmup, the AMP check and any cache building. Quoting it
        would understate every configuration -- by different amounts, since a
        cold cache costs a cold-cache config more.
        """
        return self.epochs[-1] if self.epochs else None

    @property
    def minutes_per_epoch(self) -> float:
        steady = self.steady
        return steady.total_s / 60 if steady else 0.0

    @property
    def images_per_s(self) -> float:
        steady = self.steady
        return steady.batches * self.batch / steady.train_s if steady and steady.train_s else 0.0

    def screening_hours(self, epochs: int = 60) -> float:
        """Wall-clock for one screening cell at this configuration."""
        return self.minutes_per_epoch * epochs / 60

    def as_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "workers": self.workers,
            "cache": self.cache,
            "batch": self.batch,
            "imgsz": self.imgsz,
            "accumulate": self.accumulate,
            "train_images": self.train_images,
            "ram_baseline_gb": round(self.ram_baseline_gb, 2),
            "epochs": [asdict(e) for e in self.epochs],
            "minutes_per_epoch": round(self.minutes_per_epoch, 2),
            "images_per_s": round(self.images_per_s, 1),
            "iterations_per_s": round(self.steady.iterations_per_s, 2) if self.steady else 0.0,
            "screening_hours_60ep": round(self.screening_hours(), 2),
            "resources": self.resources,
            "note": self.note,
        }


def benchmark(
    *,
    label: str,
    data: Path = DEFAULT_DATA,
    workers: int,
    cache: str | bool = DEFAULT_CACHE,
    batch: int | None = None,
    epochs: int = DEFAULT_EPOCHS,
    imgsz: int | None = None,
    project: Path = DEFAULT_PROJECT,
    model: str = BENCH_MODEL,
    interval_s: float = 1.0,
    note: str = "",
) -> BenchResult:
    """Train for `epochs` real epochs and report what the machine did.

    The run is thrown away -- `project` is `runs/bench`, deliberately not
    `runs/ablation`, so a benchmark can never be mistaken for a cell or picked
    up by the grid's resume logic.
    """
    from ultralytics import YOLO

    from ml.train.train import cap_cpu, cap_gpu_memory, cap_worker_threads

    cap_gpu_memory()
    cpu = cap_cpu(workers=workers)
    cap_worker_threads()
    print(
        f"  cpu cap: {cpu['cores_allowed']}/{cpu['cores_total']} cores "
        f"(affinity {cpu['affinity'] or 'UNAVAILABLE'}), {cpu['threads']} torch threads, "
        f"cv2 {cpu['cv2_threads']}",
        flush=True,
    )

    config = run_config(
        data,
        name=label,
        model=model,
        epochs=epochs,
        batch=batch,
        workers=workers,
        **({"imgsz": imgsz} if imgsz is not None else {}),
    )
    baseline_gb, _ = ram_budget_gb()

    timings: list[EpochTiming] = []
    state: dict[str, float] = {}
    # `on_fit_epoch_end` fires once more than there are epochs: ultralytics runs a
    # final validation pass after the last one and it goes through the same hook.
    # Counting that as an epoch reported a 1.5-minute epoch as 7.9 seconds, which
    # is exactly the direction of error a benchmark must not make. Only a hook
    # that follows an actual training phase is recorded.
    pending = {"epoch": False}

    def _epoch_start(trainer: Any) -> None:
        state["train_start"] = time.monotonic()
        pending["epoch"] = True
        if "epoch_start" not in state:
            state["epoch_start"] = state["train_start"]

    def _epoch_end(trainer: Any) -> None:
        state["train_end"] = time.monotonic()

    def _fit_end(trainer: Any) -> None:
        now = time.monotonic()
        if not pending["epoch"]:
            return
        pending["epoch"] = False
        timings.append(
            EpochTiming(
                index=len(timings) + 1,
                train_s=state.get("train_end", now) - state.get("train_start", now),
                total_s=now - state.get("epoch_start", now),
                batches=len(trainer.train_loader),
            )
        )
        state["epoch_start"] = now

    overrides: dict[str, Any] = {"cache": cache, "plots": False}
    kwargs = train_kwargs(config, project=project, overrides=overrides)

    trained = YOLO(config.model)
    trained.add_callback("on_train_epoch_start", _epoch_start)
    trained.add_callback("on_train_epoch_end", _epoch_end)
    trained.add_callback("on_fit_epoch_end", _fit_end)

    with ResourceMonitor(interval_s=interval_s) as monitor:
        trained.train(**kwargs)
    summary: Summary = monitor.summary()

    train_images = 0
    listing = Path(str(data)).parent / "images" / "train"
    if listing.is_dir():
        train_images = sum(1 for p in listing.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"})

    return BenchResult(
        label=label,
        workers=workers,
        cache=cache,
        batch=config.batch,
        imgsz=config.imgsz,
        accumulate=config.accumulate,
        epochs=timings,
        resources=summary.as_dict(),
        train_images=train_images,
        ram_baseline_gb=baseline_gb,
        note=note,
    )


def render(results: list[BenchResult]) -> str:
    """A table a human reads, with the ceilings stated beside the measurements."""
    header = (
        f"\n{'config':<26} {'wrk':>4} {'cache':>6} {'bat':>4} "
        f"{'min/ep':>7} {'img/s':>7} {'it/s':>6} "
        f"{'CPU%':>6} {'RAM GB':>7} {'GPU%':>6} {'VRAM':>6} {'60ep h':>7}"
    )
    lines = [header, "-" * len(header.strip()) ]
    for r in results:
        res = r.resources
        gpu = res.get("gpu_mean")
        vram = res.get("vram_max_mb")
        lines.append(
            f"{r.label:<26} {r.workers:>4} {r.cache!s:>6} {r.batch:>4} "
            f"{r.minutes_per_epoch:>7.2f} {r.images_per_s:>7.1f} "
            f"{(r.steady.iterations_per_s if r.steady else 0):>6.2f} "
            f"{res.get('cpu_mean', 0):>6.1f} {res.get('ram_max_gb', 0):>7.2f} "
            f"{(gpu if gpu is not None else float('nan')):>6.1f} "
            f"{(f'{vram/1024:.1f}G' if vram else '-'):>6} "
            f"{r.screening_hours():>7.2f}"
        )
    lines.append("")
    lines.append(f"ceilings: CPU 80%  RAM {RAM_CEILING_GB:.0f} GB machine-wide  GPU unrestricted")
    return "\n".join(lines)


def write_report(results: list[BenchResult], destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps([r.as_dict() for r in results], indent=2), encoding="utf-8"
    )
    return destination
