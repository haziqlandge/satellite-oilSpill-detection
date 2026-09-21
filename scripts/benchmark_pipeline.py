"""Benchmark the PHASE-02 training input pipeline on this machine.

    .venv/Scripts/python.exe scripts/benchmark_pipeline.py --sweep workers
    .venv/Scripts/python.exe scripts/benchmark_pipeline.py --workers 3 --batch 8
    .venv/Scripts/python.exe scripts/benchmark_pipeline.py --sweep batch --epochs 2

Runs a **short** job -- two real epochs per configuration, roughly four minutes
-- and reports CPU, RAM, GPU utilisation, VRAM, throughput and the implied cost
of one 60-epoch screening cell. It is not a training run and its output is
written to `runs/bench`, never to `runs/ablation`, so it cannot be mistaken for
a cell or picked up by the grid's resume logic.

Set the thread caps in the launching shell, not here -- the OMP runtime reads
them once, when torch first loads:

    OMP_NUM_THREADS=8 MKL_NUM_THREADS=8 .venv/Scripts/python.exe scripts/benchmark_pipeline.py
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from ml.bench.pipeline import (
    DEFAULT_DATA,
    DEFAULT_EPOCHS,
    DEFAULT_PROJECT,
    BenchResult,
    benchmark,
    render,
    write_report,
)
from ml.train.train import (
    DEFAULT_CACHE,
    PER_WORKER_GB,
    RAM_CEILING_GB,
    TRAINER_BASE_GB,
    ram_budget_gb,
    workers_for_available_ram,
)

# Worker counts worth measuring on a 24-core machine. 0 is included because it
# is a real ultralytics setting -- the main process loads its own data -- and
# because it is what the RAM guard returns on a loaded machine, so its cost
# needs to be a measured number rather than an assumption.
#
# **Stops at 4 deliberately.** Measured 2026-09-01: workers=4 already drove
# machine-wide RAM to 31.37 GB of 31.38 (100%), well past the 24 GB ceiling, on a
# laptop the user is working on. Sweeping to 6 or 8 to confirm a breach that is
# already established would buy one data point at the cost of making the machine
# unusable for the length of the run. Raise this only on an idle machine.
WORKER_SWEEP = (0, 2, 4)

# Batch sizes worth measuring on a 12 GB card. Each divides nbs=32 exactly, so
# `accumulate` stays an integer and the *effective* batch is unchanged -- which
# is what keeps a benchmark from quietly becoming a different experiment.
BATCH_SWEEP = (8, 16)

REPORT = Path("runs/bench/report.json")


@dataclass(frozen=True, slots=True)
class Plan:
    """One configuration to measure. A record rather than a dict, so the sweep
    builders and the runner cannot disagree about a key's name or its type."""

    label: str
    workers: int
    cache: str | bool
    batch: int | None


def _preflight() -> None:
    """State the budget before spending it, and refuse to guess at the ceiling."""
    baseline_gb, budget_gb = ram_budget_gb()
    derived = workers_for_available_ram()
    print(
        f"RAM ceiling {RAM_CEILING_GB:.0f} GB machine-wide | baseline now {baseline_gb:.1f} GB | "
        f"trainer {TRAINER_BASE_GB:.1f} GB | budget for workers {budget_gb:.1f} GB "
        f"({PER_WORKER_GB:.1f} GB each) -> derived workers {derived}"
    )
    if budget_gb <= 0:
        print(
            "  NOTE: the machine's own baseline already consumes the ceiling. Worker counts\n"
            "  above the derived value are measured here anyway, and the RAM column says what\n"
            "  each actually cost -- but running the grid at one of them would breach the cap\n"
            "  unless the baseline comes down first.",
            file=sys.stderr,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--imgsz", type=int, default=None)
    parser.add_argument("--cache", default=DEFAULT_CACHE, help="disk | ram | false")
    parser.add_argument(
        "--sweep",
        choices=("workers", "batch", "cache"),
        default=None,
        help="measure a range instead of one configuration",
    )
    parser.add_argument("--tag", default="", help="suffix for the run labels, e.g. 'post-resize'")
    parser.add_argument("--interval", type=float, default=1.0, help="sampling interval, seconds")
    arguments = parser.parse_args()

    if not arguments.data.exists():
        print(f"no dataset at {arguments.data}. Run scripts/build_dataset.py first.", file=sys.stderr)
        return 2

    cache: str | bool = arguments.cache
    if isinstance(cache, str) and cache.lower() in {"false", "none", "off"}:
        cache = False

    _preflight()

    suffix = f"-{arguments.tag}" if arguments.tag else ""
    plans: list[Plan] = []

    if arguments.sweep == "workers":
        plans = [Plan(f"w{n}{suffix}", n, cache, arguments.batch) for n in WORKER_SWEEP]
    elif arguments.sweep == "batch":
        base = arguments.workers if arguments.workers is not None else 4
        plans = [Plan(f"b{s}-w{base}{suffix}", base, cache, s) for s in BATCH_SWEEP]
    elif arguments.sweep == "cache":
        base = arguments.workers if arguments.workers is not None else 4
        plans = [
            Plan(f"cache-{m or 'off'}-w{base}{suffix}", base, m, arguments.batch)
            for m in ("disk", False)
        ]
    else:
        workers = arguments.workers if arguments.workers is not None else workers_for_available_ram()
        plans = [Plan(f"w{workers}{suffix}", workers, cache, arguments.batch)]

    results: list[BenchResult] = []
    for plan in plans:
        print(f"\n=== benchmarking {plan.label} ({arguments.epochs} epochs)", flush=True)
        try:
            results.append(
                benchmark(
                    label=plan.label,
                    data=arguments.data,
                    workers=plan.workers,
                    cache=plan.cache,
                    batch=plan.batch,
                    epochs=arguments.epochs,
                    imgsz=arguments.imgsz,
                    project=arguments.project,
                    interval_s=arguments.interval,
                )
            )
        except (RuntimeError, OSError) as error:
            print(f"  FAILED: {error}", file=sys.stderr)
            continue
        print(render(results[-1:]))

    if not results:
        print("no configuration completed", file=sys.stderr)
        return 1

    print(render(results))
    print(f"\nwritten: {write_report(results, REPORT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
