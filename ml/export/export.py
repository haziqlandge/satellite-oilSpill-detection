"""Promote the single-class research release without changing tensor precision.

The release is the final-v12 checkpoint (Zenodo Part II negatives), promoted by
the user on 2026-09-25 from the comparison in `eval/part2/REPORT.md`. The
previous release (final-v11, `d4a749...`) is kept beside it as
`weights/L1-ciou-research-v11.{pt,json}`; its manifest records how it was made.
"""

import hashlib
import json
import shutil
from pathlib import Path

WEIGHTS = Path("weights/L1-ciou-research.pt")
PREVIOUS = Path("weights/L1-ciou-research-v11.pt")
SOURCE = Path("runs/final_v12_l1/L1-ciou/weights/best-fp32.pt")
RECORD = Path("eval/part2/comparison.json")
DATASET = Path("data/processed/dataset/final-v12")


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_manifest(weights, *, expected_classes=("oos", "slick_unknown")):
    weights = Path(weights)
    manifest = json.loads(weights.with_suffix(".json").read_text())
    if manifest["classes"] != list(expected_classes):
        raise ValueError("Weights class scheme does not match the requested detector")
    if sha256(weights) != manifest["sha256"]:
        raise ValueError("Weights SHA-256 does not match the manifest")
    return manifest


def main():
    record = json.loads(RECORD.read_text())
    if sha256(SOURCE) != record["models"]["v12"]:
        raise ValueError("Selected checkpoint hash mismatch")
    # Archive the previous release once; its bytes must be the ones compared.
    if WEIGHTS.exists() and sha256(WEIGHTS) == record["models"]["release"]:
        if PREVIOUS.exists():
            raise ValueError(f"{PREVIOUS} already exists; refusing to overwrite it")
        shutil.move(WEIGHTS, PREVIOUS)
        shutil.move(WEIGHTS.with_suffix(".json"), PREVIOUS.with_suffix(".json"))
    read_manifest(PREVIOUS, expected_classes=("slick",))
    manifest = dict(
        name="L1-ciou-research",
        version="final-v12",
        classes=["slick"],
        status="research-only",
        sha256=record["models"]["v12"],
        record_sha256=sha256(RECORD),
        data_hashes={k: sha256(DATASET / v) for k, v in
                     (("data_yaml", "data.yaml"), ("val", "val.txt"), ("test", "test.txt"))},
        supersedes=dict(path=PREVIOUS.as_posix(), sha256=record["models"]["release"]),
        inference=dict(
            imgsz=1024,
            batch=4,
            conf=record["operating_confidence"]["v12"],
            iou=0.7,
            max_det=1000,
            half=False,
            rect=True,
            retina_masks=True,
        ),
        raster=dict(band=2, units="sigma0_db", db_window=[-35.0, 0.0], masked_zero=True),
        tiling=dict(tile_size=1024, overlap=0.1, merge_metric="IOS", merge_threshold=0.5),
        limitations=[
            "One slick class; never relabel predictions as oos.",
            "Tile test does not validate full-scene transfer or attribution.",
            "Retina masks and seam merging are separate scene acceptance settings.",
            "Trained with Zenodo Part II look-alike and No_oil tiles; look-alike alarms are "
            "reported separately from mAP in eval/part2/REPORT.md (C8).",
        ],
    )
    if WEIGHTS.exists() and sha256(WEIGHTS) != manifest["sha256"]:
        raise ValueError("Refusing to replace different exported weights")
    if (
        WEIGHTS.with_suffix(".json").exists()
        and json.loads(WEIGHTS.with_suffix(".json").read_text()) != manifest
    ):
        raise ValueError("Refusing to replace a different manifest")
    if not WEIGHTS.exists():
        shutil.copyfile(SOURCE, WEIGHTS)
    WEIGHTS.with_suffix(".json").write_text(json.dumps(manifest, indent=2))
    read_manifest(WEIGHTS, expected_classes=("slick",))
    print(f"Verified research release: {WEIGHTS}")


if __name__ == "__main__":
    main()
