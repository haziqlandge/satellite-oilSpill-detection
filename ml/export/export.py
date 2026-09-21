"""Export the frozen single-class research release without changing tensor precision."""

import hashlib
import json
import shutil
from pathlib import Path

WEIGHTS = Path("weights/L1-ciou-research.pt")


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
    root = Path("eval/final/operational")
    frozen_path = root / "frozen.json"
    frozen = json.loads(frozen_path.read_text())
    protocol_path = root / "protocol.json"
    protocol = json.loads(protocol_path.read_text())
    if sha256(protocol_path) != frozen["protocol_sha256"]:
        raise ValueError("Frozen protocol hash mismatch")
    source = Path("runs/final_l1_fp32_release/L1-ciou/weights/best-fp32.pt")
    if sha256(source) != frozen["checkpoint_sha256"]:
        raise ValueError("Selected checkpoint hash mismatch")
    manifest = dict(
        name="L1-ciou-research",
        classes=["slick"],
        status="research-only",
        sha256=frozen["checkpoint_sha256"],
        frozen_sha256=sha256(frozen_path),
        data_hashes={k: protocol["inputs"][k] for k in ("data_yaml", "val", "test")},
        inference=dict(
            imgsz=1024,
            batch=4,
            conf=frozen["confidence"],
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
        ],
    )
    WEIGHTS.parent.mkdir(exist_ok=True)
    if WEIGHTS.exists() and sha256(WEIGHTS) != manifest["sha256"]:
        raise ValueError("Refusing to replace different exported weights")
    if (
        WEIGHTS.with_suffix(".json").exists()
        and json.loads(WEIGHTS.with_suffix(".json").read_text()) != manifest
    ):
        raise ValueError("Refusing to replace a different manifest")
    if not WEIGHTS.exists():
        shutil.copyfile(source, WEIGHTS)
    WEIGHTS.with_suffix(".json").write_text(json.dumps(manifest, indent=2))
    read_manifest(WEIGHTS, expected_classes=("slick",))
    print(f"Verified research release: {WEIGHTS}")


if __name__ == "__main__":
    main()
