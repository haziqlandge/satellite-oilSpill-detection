"""PHASE-02's ablation grid: `{none, L1..L5} x {CIoU, MPDIoU}`.

Twelve cells reproducing Zhao et al. Table 1, on a segmentation head rather than
the detection head they used. **That difference is the point** — whether L5
remains optimal is `RESEARCH/SYNTHESIS.md` §9 Q1, the main technical risk of the
project, and **a negative result is a legitimate finding to report, not a
problem to engineer around.**

Run from the repository root:

    .venv/Scripts/python.exe -m ml.ablation.run_ablation --list
    .venv/Scripts/python.exe -m ml.ablation.run_ablation --screen
    .venv/Scripts/python.exe -m ml.ablation.run_ablation --screen --only L5:mpdiou

**Resumable, because it has to be.** At the measured 1.41 min/epoch (2026-09-01,
`workers=2`, after the pipeline work) the grid is roughly 17 hours, far longer
than any single sitting. A cell
whose `run.json` records a finished run is skipped, so an interrupted grid
continues rather than restarting.

**The screening depth is a deviation and is written into the results table.**
Agreed with the user 2026-08-31: screen all twelve at `SCREENING_EPOCHS`, then
full-train the best two plus the baseline at `PAPER_EPOCHS`. A screened grid is
not a 100-epoch grid and must not be presented as one.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ml.models.yolo_seg_lsk import POSITIONS, register_lsk, stock_index_map, write_config
from ml.train.train import (
    DEFAULT_TRAINING_CHUNK_MINUTES,
    MAX_TRAINING_SESSION_MINUTES,
    PAPER_EPOCHS,
    SCREENING_EPOCHS,
    TrainingError,
    run_config,
    train_kwargs,
    write_run_record,
)

LOSSES: tuple[str, ...] = ("ciou", "mpdiou")

# Every cell starts from the same COCO-pretrained checkpoint. **This is not
# optional.** Handing the YAML straight to `YOLO()` builds from random
# initialisation, so a baseline trained from `yolo11n-seg.pt` against LSK cells
# trained from scratch would differ overwhelmingly because of pretraining, not
# because of LSK -- and the grid would report a confident, wrong negative on the
# one question PHASE-02 exists to answer.
PRETRAINED = "yolo11n-seg.pt"

# Only used when no cell has finished yet. Flagged as an assumption wherever it
# is displayed, so an estimate is never mistaken for a measurement.
FALLBACK_MIN_PER_EPOCH = 1.5

DEFAULT_DATA = Path("data/processed/dataset/oos/data.yaml")
# Absolute: ultralytics prefixes its own `runs_dir` setting onto a relative
# project, which turned "runs/ablation" into "runs/segment/runs/ablation" and
# put the weights somewhere other than the run record that indexes them.
DEFAULT_PROJECT = Path("runs/ablation").resolve()
CONFIG_DIR = Path("ml/ablation/configs")
RESULTS = Path("ml/ablation/results.md")


class ChunkLimitReachedError(RuntimeError):
    """A clean checkpoint was written at this task's requested boundary."""


@dataclass(frozen=True, slots=True)
class Cell:
    """One point in the grid."""

    position: str
    loss: str

    @property
    def name(self) -> str:
        return f"{self.position}-{self.loss}"


def grid() -> list[Cell]:
    """All twelve cells, in P004 Table 1's order."""

    return [Cell(position, loss) for loss in LOSSES for position in POSITIONS]


def is_complete(cell: Cell, project: Path) -> bool:
    """True if this cell already has a finished run recorded.

    Presence of `results` in the record — not merely the file — is the signal,
    so a run killed after writing its pre-flight config is retried rather than
    skipped.
    """

    record = project / cell.name / "run.json"
    if not record.exists():
        return False
    try:
        return "results" in json.loads(record.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False


def load_pretrained_backbone(
    model: Any, checkpoint: str, position: str = "none"
) -> tuple[int, int]:
    """Transfer pretrained weights for everything **except the head**.

    Two reasons the head is excluded, and both are about keeping the twelve
    cells comparable rather than about accuracy:

    * **The head's layer index moves.** Appending LSK before `Segment` shifts it
      from 23 to 24/25/26 for L2-L5, so its checkpoint keys stop matching by
      name while they still match for `none` and L1. Measured before this fix:
      510 of 561 tensors transferred for `none` against 378 of 609 for L5.
    * **The head is rebuilt for our class count anyway.** COCO's 80-class head
      cannot carry over to a 1-class (later 2-class) model.

    Excluding it everywhere gives every cell a pretrained backbone and neck and
    an identically-initialised random head, so the only thing that differs
    between cells is the thing being ablated.

    The lazy LSK parameters are materialised first, so the state dict is
    complete and the returned count is honest.
    """

    import torch

    with torch.no_grad():
        model.model(torch.zeros(1, 3, 64, 64))

    target = model.model.state_dict()
    head_index = max(int(k.split(".")[1]) for k in target if k.startswith("model."))
    head_prefix = f"model.{head_index}."

    loaded = torch.load(checkpoint, map_location="cpu", weights_only=False)
    source = (
        loaded["model"].float().state_dict()
        if hasattr(loaded.get("model"), "state_dict")
        else loaded
    )

    # Remap stock layer indices onto this architecture's; identity for every
    # position except L1, whose inline insertion shifts the backbone and neck.
    remap = stock_index_map(position)

    def _retarget(key: str) -> str:
        if not remap or not key.startswith("model."):
            return key
        parts = key.split(".")
        moved = remap.get(int(parts[1]))
        if moved is None:
            return key
        return ".".join(["model", str(moved), *parts[2:]])

    usable = {}
    for key, value in source.items():
        # Filter the *retargeted* key: for L1 the stock head at `model.23`
        # remaps to `model.24`, so testing the source key against this
        # architecture's head prefix would let the head slip through and give
        # L1 pretrained head weights the other cells do not get.
        target_key = _retarget(key)
        if target_key.startswith(head_prefix):
            continue
        if target_key in target and target[target_key].shape == value.shape:
            usable[target_key] = value
    model.model.load_state_dict(usable, strict=False)
    return len(usable), sum(1 for k in target if not k.startswith(head_prefix))


def measured_min_per_epoch(project: Path) -> tuple[float, str]:
    """`(minutes_per_epoch, provenance)` from finished cells, not a constant.

    This was a hard-coded 2.5, measured before the disk cache existed. It now
    overstates the grid by 40% -- claiming ~25 h for what takes ~14 -- and an
    estimate wrong by that much is worse than none, because it is exactly what a
    decision to cut cells would rest on. Ultralytics already writes cumulative
    epoch time to `results.csv`; read it rather than assuming.
    """

    import csv

    rates: list[float] = []
    for cell in grid():
        results = project / cell.name / "results.csv"
        if not is_complete(cell, project) or not results.exists():
            continue
        try:
            with results.open(encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
        except (OSError, ValueError):
            continue
        if rows and float(rows[-1].get("time", 0) or 0) > 0:
            rates.append(float(rows[-1]["time"]) / len(rows) / 60)

    if not rates:
        return FALLBACK_MIN_PER_EPOCH, "ASSUMED - no finished cell to measure"
    rates.sort()
    return rates[len(rates) // 2], f"median of {len(rates)} finished cell(s)"


def run_cell(
    cell: Cell,
    *,
    data: Path,
    epochs: int,
    project: Path,
    batch: int | None,
    workers: int,
    seed: int,
    max_minutes: float,
    full_resources: bool = False,
    overrides: dict[str, Any] | None = None,
    config_dir: Path = CONFIG_DIR,
    initial_head: Path | None = None,
) -> dict[str, Any]:
    """Train one cell and return its metrics."""

    from ultralytics import YOLO

    from ml.models.loss_patch import use_mpdiou
    from ml.train.train import (
        TrainingChunkCompleteError,
        cap_cpu,
        cap_gpu_memory,
        cap_worker_threads,
        install_gpu_usage_limit,
        install_training_time_budget,
    )

    register_lsk()
    if full_resources:
        cap_gpu_memory(fraction=1.0)
    else:
        cap_gpu_memory()
    # Before the dataloader workers exist: on Windows they inherit the affinity
    # mask set here, and that inheritance is the whole mechanism. Applied from
    # outside afterwards -- which is all `scripts/cap_cpu.ps1` can do -- it
    # reaches the parent and misses every worker.
    if full_resources:
        cpu = cap_cpu(workers=workers, fraction=1.0, prefer_efficiency=False)
    else:
        cpu = cap_cpu(workers=workers)
    cap_worker_threads()
    print(
        f"  cpu cap: {cpu['cores_allowed']}/{cpu['cores_total']} cores "
        f"(affinity {cpu['affinity'] or 'UNAVAILABLE'}), {cpu['threads']} torch threads, "
        f"cv2 {cpu['cv2_threads']}",
        flush=True,
    )

    if initial_head is not None:
        from ultralytics.utils.torch_utils import init_seeds

        init_seeds(seed, deterministic=True)
    architecture = write_config(cell.position, config_dir / f"yolo11n-seg-{cell.position}.yaml")
    config = run_config(
        data, name=cell.name, model=str(architecture), epochs=epochs, batch=batch, workers=workers
    )
    loss_version = "mpdiou_pixel_v2" if cell.loss == "mpdiou" else "ultralytics_ciou"
    prior_record = project / cell.name / "run.json"
    prior_checkpoint = project / cell.name / "weights/last.pt"
    if cell.loss == "mpdiou" and prior_checkpoint.exists():
        prior = (
            json.loads(prior_record.read_text(encoding="utf-8")) if prior_record.exists() else {}
        )
        if prior.get("config", {}).get("loss_implementation") != loss_version:
            raise TrainingError(
                "Refusing to resume legacy grid-unit MPDIoU weights with the corrected pixel-unit loss; use a new experiment directory"
            )
    config.extra["loss_implementation"] = loss_version
    config.extra["full_resources"] = full_resources
    if overrides is not None:
        config.extra["training_overrides"] = overrides
        config.extra["initial_head"] = str(initial_head)
    write_run_record(project / cell.name / "run.json", config)

    checkpoint = project / cell.name / "weights" / "last.pt"
    resuming = checkpoint.exists()
    if resuming:
        model = YOLO(str(checkpoint), task="segment")
        resumed_epoch = int(getattr(model, "ckpt", {}).get("epoch", -1)) + 1
        print(f"  resuming {checkpoint} after epoch {resumed_epoch}", flush=True)
    else:
        model = YOLO(str(architecture), task="segment")
        transferred, total = load_pretrained_backbone(model, PRETRAINED, cell.position)
        print(f"  pretrained backbone/neck: {transferred}/{total} tensors", flush=True)
        if initial_head is not None:
            import torch

            network: Any = model.model
            network.model[-1].load_state_dict(
                torch.load(initial_head, map_location="cpu", weights_only=True), strict=True
            )
            print(f"  shared initial segmentation head: {initial_head}", flush=True)

    if cell.loss == "mpdiou":
        # Construct the criterion explicitly so the first batch uses the selected loss.
        state = {"swapped": 0}

        def _swap(trainer: Any) -> None:
            if not state["swapped"]:
                if getattr(trainer.model, "criterion", None) is None:
                    trainer.model.criterion = trainer.model.init_criterion()
                state["swapped"] = use_mpdiou(trainer.model)
                if not state["swapped"]:
                    raise TrainingError(
                        f"{cell.name}: MPDIoU patch did not apply. Training would have used "
                        "CIoU while the results table claimed MPDIoU."
                    )

        model.add_callback("on_train_start", _swap)

    if full_resources:
        install_gpu_usage_limit(model, fraction=1.0)
    else:
        install_gpu_usage_limit(model)
    install_training_time_budget(model, max_minutes)
    kwargs = train_kwargs(config, project=project, seed=seed, overrides=overrides)
    if resuming:
        kwargs["resume"] = str(checkpoint)
        # Transferred checkpoints retain the previous machine's absolute output path.
        kwargs["save_dir"] = str((project / cell.name).resolve())
    results = None
    chunk_reached = False
    try:
        results = model.train(**kwargs)
    except TrainingChunkCompleteError:
        # Raised by ``on_fit_epoch_end`` only after Ultralytics has written
        # ``last.pt``.  Catching it here exits before ``final_eval()`` strips
        # the optimizer and turns a resumable checkpoint into inference-only
        # weights.
        chunk_reached = True

    completed_epochs = 0
    if checkpoint.exists():
        import torch

        payload = torch.load(checkpoint, map_location="cpu", weights_only=False)
        completed_epochs = max(0, int(payload.get("epoch", -1)) + 1)
    if chunk_reached and completed_epochs < epochs:
        raise ChunkLimitReachedError(
            f"{cell.name}: saved after {completed_epochs}/{epochs} epochs at the "
            f"{max_minutes:.0f}-minute task boundary"
        )

    metrics = {}
    for key in (
        "metrics/mAP50(M)",
        "metrics/mAP50-95(M)",
        "metrics/mAP50(B)",
        "metrics/mAP50-95(B)",
    ):
        value = getattr(results, "results_dict", {}).get(key)
        if value is not None:
            metrics[key] = float(value)

    write_run_record(project / cell.name / "run.json", config, metrics)
    return metrics


def write_results(project: Path, epochs: int, destination: Path = RESULTS) -> Path:
    """Render every completed cell into the committed results table."""

    rows: list[str] = []
    completed: dict[str, dict[str, float]] = {}
    for cell in grid():
        record = project / cell.name / "run.json"
        if not record.exists():
            continue
        try:
            payload = json.loads(record.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        results = payload.get("results")
        config = payload.get("config", {})
        if not results:
            continue
        completed[cell.name] = results
        rows.append(
            f"| {cell.position} | {cell.loss.upper()} | "
            f"{results.get('metrics/mAP50-95(M)', float('nan')):.3f} | "
            f"{results.get('metrics/mAP50(M)', float('nan')):.3f} | "
            f"{config.get('batch')} | {config.get('workers')} |"
        )

    l2_note = ""
    if all(name in completed for name in ("none-ciou", "L1-ciou", "L2-ciou")):
        none_score = completed["none-ciou"]["metrics/mAP50-95(M)"]
        l1_score = completed["L1-ciou"]["metrics/mAP50-95(M)"]
        l2_score = completed["L2-ciou"]["metrics/mAP50-95(M)"]
        l2_note = (
            f"The completed `L2-ciou` screen is **{none_score - l2_score:.5f} below "
            f"`none-ciou`** and **{l1_score - l2_score:.5f} below `L1-ciou`** on mask "
            "mAP50-95. Both gaps exceed the ~0.004 within-run distinguishability "
            "threshold, so L2 is a materially worse CIoU placement in this single-seed "
            "screen. This is a screening result, not a multi-seed significance claim.\n\n"
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        "# PHASE-02 ablation — LSK placement x IoU loss\n\n"
        f"Screened at **{epochs} epochs**, not the {PAPER_EPOCHS} of P004 §2.7. "
        "**A screened grid is not a 100-epoch grid** and these numbers are not "
        "directly comparable to Zhao et al. Table 1 without saying so.\n\n"
        "Segmentation mask metrics (`M`), single `slick` class — this is a "
        "**binary baseline**, not the two-class `oos` / `slick_unknown` model, "
        "which needs the human relabelling pass first.\n\n"
        "`workers` records the loader setting used on each machine. Hardware and "
        "mid-run physical-batch changes are documented in `HANDOFF.md`; `nbs=32` "
        "is retained, but does not guarantee numerical equivalence across batches.\n\n"
        "## Read the noise floor before reading the table\n\n"
        "Measured 2026-09-01 from the first two completed CIoU runs: the **detrended "
        "epoch-to-epoch standard deviation** of mask mAP50-95 over the last ten "
        "epochs is **+/-0.0012**. Two cells differing by less than roughly "
        "**0.004** are not distinguishable by this grid.\n\n"
        "> `none` and `L1` differ by **0.00036** -- about a third of a single "
        "run's own jitter. **That is not a result, and no number of further "
        "cells resolves variants separated by less than the noise floor of one "
        "run.** If the grid comes in flat, report it as flat: `SYNTHESIS.md` "
        "section 9 Q1 states that a negative result is a legitimate finding.\n\n"
        + l2_note
        + "**Screening depth is not reducible.** The first two 60-epoch reference runs peak at epoch "
        "**59 of 60** with every validation loss still falling -- the models are "
        "under-trained, not over-trained, so a shorter screen would rank an "
        "unconverged curve.\n\n"
        f"**Progress: {len(rows)} of {len(grid())} screening cells complete.**\n\n"
        "| LSK | Loss | mAP50-95 (M) | mAP50 (M) | batch | workers |\n"
        "|---|---|---|---|---|---|\n"
        + ("\n".join(rows) if rows else "| _no completed runs yet_ | | | | | |")
        + "\n",
        encoding="utf-8",
    )
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--screen", action="store_true", help=f"{SCREENING_EPOCHS} epochs per cell")
    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--full-resources",
        action="store_true",
        help="allow all CPU cores and GPU memory without GPU duty-cycle throttling",
    )
    parser.add_argument(
        "--max-minutes",
        type=float,
        default=DEFAULT_TRAINING_CHUNK_MINUTES,
        help="stop cleanly and checkpoint at the requested bounded session length",
    )
    parser.add_argument("--only", default=None, help="run one cell, e.g. 'L5:mpdiou'")
    parser.add_argument("--list", action="store_true", help="show the grid and what is done")
    arguments = parser.parse_args()

    if not 0.0 < arguments.max_minutes <= MAX_TRAINING_SESSION_MINUTES:
        print(
            "--max-minutes must be greater than 0 and no more than "
            f"{MAX_TRAINING_SESSION_MINUTES:.0f}",
            file=sys.stderr,
        )
        return 2

    epochs = arguments.epochs or (SCREENING_EPOCHS if arguments.screen else PAPER_EPOCHS)
    cells = grid()

    if arguments.only:
        position, _, loss = arguments.only.partition(":")
        cells = [c for c in cells if c.position == position and c.loss == loss]
        if not cells:
            print(f"no cell matches {arguments.only!r}", file=sys.stderr)
            return 2

    if arguments.list:
        print(f"{'cell':<16} {'status'}")
        for cell in grid():
            print(
                f"  {cell.name:<14} {'done' if is_complete(cell, arguments.project) else 'pending'}"
            )
        remaining = sum(1 for c in grid() if not is_complete(c, arguments.project))
        rate, provenance = measured_min_per_epoch(arguments.project)
        print(
            f"\n{remaining} of {len(grid())} pending, "
            f"~{remaining * epochs * rate / 60:.1f} h at {rate:.2f} min/epoch ({provenance})"
        )
        return 0

    if not arguments.data.exists():
        print(
            f"no dataset at {arguments.data}. Run scripts/build_dataset.py first.", file=sys.stderr
        )
        return 2

    if arguments.workers is None:
        from ml.train.train import workers_for_available_ram

        workers = workers_for_available_ram()
    else:
        workers = arguments.workers

    failures = 0
    for cell in cells:
        if is_complete(cell, arguments.project):
            print(f"= {cell.name}: already done, skipping")
            continue
        print(f"\n=== {cell.name}  ({epochs} epochs, workers={workers})", flush=True)
        started = time.monotonic()
        try:
            metrics = run_cell(
                cell,
                data=arguments.data,
                epochs=epochs,
                project=arguments.project,
                batch=arguments.batch,
                workers=workers,
                seed=arguments.seed,
                max_minutes=arguments.max_minutes,
                full_resources=arguments.full_resources,
            )
        except ChunkLimitReachedError as event:
            print(f"  PAUSED: {event}")
            write_results(arguments.project, epochs)
            break
        except (TrainingError, RuntimeError, OSError) as error:
            print(f"  FAILED: {error}", file=sys.stderr)
            failures += 1
            continue
        print(f"  done in {(time.monotonic() - started) / 60:.1f} min: {metrics}")
        write_results(arguments.project, epochs)
        # One invocation is one sub-hour task. Never roll straight into another
        # cell even when a resumed cell happens to finish early.
        break

    write_results(arguments.project, epochs)
    print(f"\nresults table: {RESULTS}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
