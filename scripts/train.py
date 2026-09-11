"""Train a YOLO-seg model on the assembled corpus (PHASE-02).

    .venv/Scripts/python.exe scripts/train.py --smoke
    .venv/Scripts/python.exe scripts/train.py --name baseline
    .venv/Scripts/python.exe scripts/train.py --name baseline --epochs 60

`--smoke` runs two epochs over a small fraction of the training split. It exists
to prove the plumbing -- that `data.yaml` parses, the polygon labels load, CUDA
works on this card, and the resolved batch actually fits in VRAM -- **before**
committing hours to a real run. A smoke run is not a result and must never be
reported as one.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ml.train.train import (
    DEFAULT_MODEL,
    PAPER_EPOCHS,
    PAPER_WORKERS,
    SCREENING_EPOCHS,
    SMOKE_EPOCHS,
    TrainingError,
    run_config,
    train,
)

DEFAULT_DATA = Path("data/processed/dataset/oos/data.yaml")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--name", default=None, help="run name; defaults to the mode")
    parser.add_argument("--model", default=None, help="override the base checkpoint")
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--batch", type=int, default=None, help="override the detected batch")
    parser.add_argument(
        "--auto-batch",
        action="store_true",
        help="profile the largest batch that actually fits, instead of the VRAM lookup",
    )
    # Absolute: ultralytics also prefixes its own `runs_dir` setting, which
    # turned a relative "runs/segment" into "runs/segment/runs/segment".
    parser.add_argument("--project", type=Path, default=Path("runs/segment").resolve())
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help=(
            f"dataloader workers. Default: derived from free RAM against an 80% ceiling "
            f"(the paper uses {PAPER_WORKERS}; 8 workers reached 98% of a 31 GB machine)."
        ),
    )
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help=f"{SMOKE_EPOCHS} epochs on a small fraction, to prove the pipeline",
    )
    parser.add_argument(
        "--screen",
        action="store_true",
        help=f"{SCREENING_EPOCHS} epochs -- the agreed ablation screening depth",
    )
    parser.add_argument("--dry-run", action="store_true", help="resolve and print, do not train")
    arguments = parser.parse_args()

    if not arguments.data.exists():
        print(
            f"no dataset at {arguments.data}. Run scripts/build_dataset.py first.",
            file=sys.stderr,
        )
        return 2

    workers = arguments.workers
    if workers is None:
        from ml.train.train import workers_for_available_ram

        workers = workers_for_available_ram()
        print(f"workers derived from free RAM (80% ceiling): {workers}")

    epochs = arguments.epochs
    overrides: dict[str, object] = {}
    name = arguments.name

    if arguments.smoke:
        epochs = epochs or SMOKE_EPOCHS
        overrides["fraction"] = 0.05
        overrides["val"] = True
        name = name or "smoke"
    elif arguments.screen:
        epochs = epochs or SCREENING_EPOCHS
        name = name or "screen"
    else:
        epochs = epochs or PAPER_EPOCHS
        name = name or "baseline"

    batch = arguments.batch
    if arguments.auto_batch and batch is None:
        from ml.train.train import resolve_auto_batch

        try:
            batch = resolve_auto_batch(arguments.model or DEFAULT_MODEL)
        except (TrainingError, RuntimeError) as error:
            print(f"auto-batch failed ({error}); falling back to the detected batch", file=sys.stderr)
            batch = None
        else:
            print(f"auto-batch profiled: {batch}")

    kwargs = {"epochs": epochs, "batch": batch, "workers": workers}
    if arguments.model:
        kwargs["model"] = arguments.model

    try:
        config = run_config(arguments.data, name=name, **kwargs)  # type: ignore[arg-type]
    except TrainingError as error:
        print(error, file=sys.stderr)
        return 1

    print("resolved run configuration:")
    for key, value in config.as_dict().items():
        print(f"  {key:<12} {value}")
    if overrides:
        print(f"  {'overrides':<12} {overrides}")

    if config.device != "cuda":
        print(
            "\nWARNING: no usable CUDA device -- this will train on CPU and take "
            "far longer than any useful budget.",
            file=sys.stderr,
        )

    if arguments.dry_run:
        print("\ndry run: nothing trained")
        return 0

    if arguments.smoke:
        print(f"\nSMOKE RUN: {epochs} epochs on {overrides['fraction']:.0%} of train.")
        print("Proves the pipeline works. NOT a result -- do not report it as one.\n")

    try:
        config, _ = train(
            arguments.data,
            name=name,
            epochs=epochs,
            batch=batch,
            workers=workers,
            project=arguments.project,
            seed=arguments.seed,
            overrides=overrides or None,
            **({"model": arguments.model} if arguments.model else {}),
        )
    except TrainingError as error:
        print(f"\n{error}", file=sys.stderr)
        return 1

    print(f"\nrun record: {arguments.project / name / 'run.json'}")
    if arguments.smoke:
        print("Smoke run finished. The pipeline works; these numbers are not a result.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
