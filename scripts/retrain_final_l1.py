"""Reproduce the selected L1 model with FP32-safe resumable/release checkpoints."""

from __future__ import annotations

import json
from pathlib import Path

from ml.ablation.run_ablation import Cell, ChunkLimitReachedError, run_cell
from ml.train.checkpoint import FP32ReleaseTrainer
from scripts.train_final import (
    CELLS,
    DATA,
    HEAD,
    OVERLAP,
    OVERRIDES,
    ROOT,
    digest,
    verify_data,
)
from scripts.train_queue import completed

PROJECT = ROOT / "runs/final_l1_fp32_release"
CELL = Cell("L1", "ciou")
EPOCHS = 100


def verify_frozen_inputs() -> None:
    """Require the same frozen data and initialization used for model selection."""

    gate = json.loads((ROOT / "runs/final/preflight_gate.json").read_text(encoding="utf-8"))
    frozen_path = ROOT / "runs/final/frozen.json"
    if gate.get("status") != "passed" or gate.get("frozen_sha256") != digest(frozen_path):
        raise RuntimeError("Original final-training preflight gate no longer matches frozen.json")
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    if frozen["cells"] != CELLS or frozen["overrides"] != OVERRIDES:
        raise RuntimeError("Original final comparison configuration changed")
    if digest(HEAD) != frozen["head_sha256"]:
        raise RuntimeError("Shared initial segmentation head changed")
    overlap = json.loads(OVERLAP.read_text(encoding="utf-8"))
    if overlap["pairs"] or Path(overlap["manifest"]).resolve() != DATA / "manifest.json":
        raise RuntimeError("Frozen dataset overlap preflight no longer passes")
    verify_data()


def write_release_record() -> None:
    weights = PROJECT / CELL.name / "weights"
    artifacts = [
        weights / "best-fp32.pt",
        PROJECT / CELL.name / "results.csv",
        PROJECT / CELL.name / "args.yaml",
        PROJECT / CELL.name / "run.json",
    ]
    missing = [str(path) for path in artifacts if not path.exists()]
    if missing:
        raise RuntimeError(f"Release artifacts missing: {missing}")
    payload = {
        "selected_model": CELL.name,
        # Repo-relative: an absolute path here records the training machine's
        # home directory into the release provenance, where it is wrong
        # everywhere else. See scripts/repath_artifacts.py.
        "selection_report": "eval/final/REVIEW.md",
        "reason": (
            "L1 leads both comparable validation evaluations and the completed final-v11 "
            "100-epoch curves on mask AP; it also leads recall, Dice, boundary F1, small-object "
            "recall, and source coverage. L4 is retained as the precision/box-quality reserve."
        ),
        "checkpoint_policy": (
            "best-fp32.pt is serialized directly from the live FP32 EMA because Ultralytics' "
            "FP16 save path saturated finite LSK weights above 65504."
        ),
        "artifacts": {
            str(path.relative_to(PROJECT)): digest(path) for path in artifacts
        },
    }
    (PROJECT / CELL.name / "release.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )


def main() -> int:
    verify_frozen_inputs()
    PROJECT.mkdir(parents=True, exist_ok=True)
    if completed(CELL, PROJECT, EPOCHS):
        write_release_record()
        print("Already complete:", CELL.name)
        return 0
    try:
        run_cell(
            CELL,
            data=DATA / "data.yaml",
            epochs=EPOCHS,
            project=PROJECT,
            batch=4,
            workers=2,
            seed=0,
            max_minutes=240,
            full_resources=True,
            overrides={**OVERRIDES, "trainer": FP32ReleaseTrainer},
            config_dir=PROJECT / "configs",
            initial_head=HEAD,
        )
    except ChunkLimitReachedError as event:
        print(f"PAUSED: {event}", flush=True)
        return 0
    write_release_record()
    print("FP32 L1 release complete", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())