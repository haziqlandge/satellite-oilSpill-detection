"""Frozen three-model final comparison; separate outputs, shared initialization."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import torch
from ultralytics import YOLO
from ultralytics.utils.torch_utils import init_seeds

from ml.ablation.run_ablation import (
    Cell,
    ChunkLimitReachedError,
    load_pretrained_backbone,
    run_cell,
)
from ml.models.yolo_seg_lsk import register_lsk, write_config
from scripts.train_queue import completed

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "runs/final"
DATA = ROOT / "data/processed/dataset/final-v11"
HEAD = PROJECT / "initial_head.pt"
OVERLAP = ROOT / "eval/final_preflight/retained_v11_overlaps.json"
OVERRIDES = dict(
    optimizer="AdamW",
    lr0=0.002,
    momentum=0.9,
    weight_decay=0.0005,
    lrf=0.01,
    cos_lr=False,
    patience=1000,
    mosaic=0.0,
    close_mosaic=0,
    translate=0.0,
    scale=0.0,
    hsv_h=0.0,
    hsv_s=0.0,
    hsv_v=0.0,
    mixup=0.0,
    cutmix=0.0,
    copy_paste=0.0,
    degrees=0.0,
    shear=0.0,
    perspective=0.0,
    flipud=0.5,
    fliplr=0.5,
    cache="disk",
    save_period=10,
)
CELLS = ["none-ciou", "L1-ciou", "L4-ciou"]


def digest(path):
    with Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def verify_data():
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    # Manifest rows are repo-relative and split lines are relative to the list
    # file itself; both forms resolve against their own anchor, and an absolute
    # value left over from an older generation still wins on the right of `/`,
    # so this reads either. See scripts/repath_artifacts.py.
    for split in ("train", "val", "test"):
        expected = [
            (ROOT / row["path"]).resolve() for row in manifest["retained"] if row["split"] == split
        ]
        actual = [
            (DATA / line).resolve() for line in (DATA / f"{split}.txt").read_text().splitlines()
        ]
        if actual != expected or len(actual) != manifest["counts"][split]:
            raise RuntimeError(f"Frozen split list does not match manifest: {split}")
    for row in manifest["retained"]:
        image = ROOT / row["path"]
        label = image.parent.parent.parent / "labels" / image.parent.name / (image.stem + ".txt")
        if digest(image) != row["image_sha256"] or digest(label) != row["label_sha256"]:
            raise RuntimeError(f"Frozen source changed: {image}")
    groups = {
        split: {r["pixel_sha256"] for r in manifest["retained"] if r["split"] == split}
        for split in ["train", "val", "test"]
    }
    assert not (
        groups["train"] & groups["val"]
        or groups["train"] & groups["test"]
        or groups["val"] & groups["test"]
    )
    return manifest


def prepare():
    manifest = verify_data()
    overlap = json.loads(OVERLAP.read_text())
    # Anchored at ROOT, not at the working directory: the recorded value is
    # repo-relative, so `Path(...).resolve()` alone would only agree when this
    # happened to be run from the repository root.
    if overlap["pairs"] or (ROOT / overlap["manifest"]).resolve() != DATA / "manifest.json":
        raise RuntimeError("Dataset overlap preflight has not passed for this manifest")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable")
    PROJECT.mkdir(parents=True, exist_ok=True)
    register_lsk()
    torch.set_num_threads(6)
    if not HEAD.exists():
        init_seeds(0, deterministic=True)
        config = write_config("none", PROJECT / "configs/yolo11n-seg-none.yaml")
        model = YOLO(str(config), task="segment")
        load_pretrained_backbone(model, str(ROOT / "yolo11n-seg.pt"), "none")
        torch.save(model.model.model[-1].state_dict(), HEAD)
    head = torch.load(HEAD, map_location="cpu", weights_only=True)
    for position in ["none", "L1", "L4"]:
        init_seeds(0, deterministic=True)
        model = YOLO(
            str(write_config(position, PROJECT / f"configs/yolo11n-seg-{position}.yaml")),
            task="segment",
        )
        transferred, _ = load_pretrained_backbone(model, str(ROOT / "yolo11n-seg.pt"), position)
        assert transferred == 378
        model.model.model[-1].load_state_dict(head, strict=True)
        assert all(torch.equal(v, head[k]) for k, v in model.model.model[-1].state_dict().items())
    freeze = dict(
        cells=CELLS,
        epochs=100,
        batch=4,
        workers=2,
        nbs=32,
        imgsz=1024,
        seed=0,
        loss="ciou",
        full_resources=True,
        overrides=OVERRIDES,
        dataset_counts=manifest["counts"],
        scope=manifest["scope"],
        head_sha256=digest(HEAD),
        pretrained_sha256=digest(ROOT / "yolo11n-seg.pt"),
        files={
            str(p): digest(p)
            for p in [
                DATA / "manifest.json",
                DATA / "data.yaml",
                DATA / "train.txt",
                DATA / "val.txt",
                DATA / "test.txt",
                OVERLAP,
                ROOT / "scripts/train_final.py",
                ROOT / "scripts/train_queue.py",
                ROOT / "ml/ablation/run_ablation.py",
                ROOT / "ml/train/train.py",
                ROOT / "ml/models/yolo_seg_lsk.py",
                ROOT / "ml/models/lsk.py",
            ]
        },
    )
    destination = PROJECT / "frozen.json"
    if destination.exists() and json.loads(destination.read_text()) != freeze:
        raise RuntimeError("Final configuration changed; refuse to overwrite freeze.")
    destination.write_text(json.dumps(freeze, indent=2), encoding="utf-8")
    print(
        "PREFLIGHT PASSED:",
        manifest["counts"],
        "same 378 pretrained tensors and identical initial head for all three",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--only", choices=CELLS)
    args = parser.parse_args()
    if args.preflight:
        prepare()
        return 0
    if not args.only:
        parser.error("--only or --preflight required")
    gate = json.loads((PROJECT / "preflight_gate.json").read_text())
    if gate.get("status") != "passed" or gate.get("frozen_sha256") != digest(
        PROJECT / "frozen.json"
    ):
        raise RuntimeError(
            "Final training blocked: preflight checks have not all passed for this frozen configuration"
        )
    frozen = json.loads((PROJECT / "frozen.json").read_text())
    assert frozen["overrides"] == OVERRIDES and frozen["cells"] == CELLS
    for path, sha in frozen["files"].items():
        if digest(path) != sha:
            raise RuntimeError(f"Frozen manifest changed: {path}")
    assert (
        digest(HEAD) == frozen["head_sha256"]
        and digest(ROOT / "yolo11n-seg.pt") == frozen["pretrained_sha256"]
    )
    verify_data()
    cell = Cell(args.only.split("-")[0], "ciou")
    if completed(cell, PROJECT, 100):
        print("Already complete:", cell.name)
        return 0
    try:
        run_cell(
            cell,
            data=DATA / "data.yaml",
            epochs=100,
            project=PROJECT,
            batch=4,
            workers=2,
            seed=0,
            max_minutes=240,
            full_resources=True,
            overrides=OVERRIDES,
            config_dir=PROJECT / "configs",
            initial_head=HEAD,
        )
    except ChunkLimitReachedError as event:
        print(f"PAUSED: {event}", flush=True)
        return 0
    artifacts = [PROJECT / cell.name / "weights" / name for name in ("best.pt", "last.pt")]
    artifacts += [PROJECT / cell.name / name for name in ("results.csv", "args.yaml", "run.json")]
    (PROJECT / cell.name / "artifact_hashes.json").write_text(
        json.dumps({str(path.relative_to(PROJECT)): digest(path) for path in artifacts}, indent=2),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
