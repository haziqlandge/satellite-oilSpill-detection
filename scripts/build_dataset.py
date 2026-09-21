"""Assemble the YOLO-seg training set from the extracted Zenodo corpus.

Third and last step of the corpus pipeline:

    download_zenodo.py  ->  extract_zenodo.py  ->  build_dataset.py

Run from the repository root:

    .venv/Scripts/python.exe scripts/build_dataset.py --dry-run
    .venv/Scripts/python.exe scripts/build_dataset.py

Defaults are the conservative reading of the corpus, and each is a decision
rather than an accident:

* **Sentinel-1 only.** Record 15298010 is 48% ALOS PALSAR (L-band) against this
  pipeline's Sentinel-1 C-band. `--sensors all` takes the lot, and if you do
  that it belongs in the weights manifest.
* **Single-class.** The corpus is binary oil/not-oil. `oos` versus
  `slick_unknown` needs the human relabelling pass; nothing here will guess one.
  `--classes two` requires a directory of attributed reviews and a new output directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from backend.ingest.datasets.relabel import load_confirmed
from ml.datasets.oos_dataset import (
    CLASS_SCHEME,
    SINGLE_CLASS_NAME,
    BuildReport,
    DatasetError,
    SourceImage,
    build_dataset,
    discover_part_one,
    discover_part_three,
    discover_refined_sos,
)

CORPUS = Path("data/interim/datasets/zenodo")
DEFAULT_OUT = Path("data/processed/dataset/oos")


def load_reviews(directory: Path, sources: list[SourceImage]) -> dict[str, dict[int, str]]:
    """Import attributed reviews bound to the exact source image and mask bytes."""
    if not directory.is_dir():
        raise DatasetError("--confirmed must be a directory of attributed review JSON files")
    available = {source.identity: source for source in sources}
    confirmed = {}
    for path in sorted(directory.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        identity = document.get("source")
        if identity not in available or identity in confirmed:
            raise DatasetError(f"{path}: unknown or duplicate source identity {identity!r}")
        source = available[identity]
        for field, original in (("image", source.image), ("mask", source.mask)):
            if (
                original is None
                or document.get(f"{field}_sha256")
                != hashlib.sha256(original.read_bytes()).hexdigest()
            ):
                raise DatasetError(f"{path}: {field} hash mismatch; review the current source")
        try:
            confirmed[identity] = load_confirmed(path)
        except ValueError as error:
            raise DatasetError(str(error)) from error
    if not confirmed or not any(confirmed.values()):
        raise DatasetError("No human-confirmed labels found; complete annotation review first")
    return confirmed


def _collect(sensors: tuple[str, ...] | None) -> list[SourceImage]:
    sources: list[SourceImage] = []

    images = CORPUS / "8346860" / "01_Train_Val_Oil_Spill_images"
    masks = CORPUS / "8346860" / "01_Train_Val_Oil_Spill_mask"
    if images.is_dir() and masks.is_dir():
        found = discover_part_one(images, masks)
        print(f"  Part I        {len(found):>6} images (all positive)")
        sources.extend(found)

    part_three = CORPUS / "13761290" / "02_Test_images_and_ground_truth"
    if part_three.is_dir():
        found = discover_part_three(part_three)
        print(
            f"  Part III      {len(found):>6} images ({sum(s.is_negative for s in found)} negatives)"
        )
        sources.extend(found)

    images = CORPUS / "15298010" / "images" / "images"
    masks = CORPUS / "15298010" / "masks" / "masks"
    if images.is_dir() and masks.is_dir():
        found = discover_refined_sos(images, masks, sensors=sensors)
        label = "all sensors" if sensors is None else "+".join(sensors)
        print(f"  Refined SOS   {len(found):>6} images ({label})")
        sources.extend(found)

    return sources


def _report(report: BuildReport) -> None:
    print(f"\nwrote {report.total} images to {report.root}")
    print(f"classes: {list(report.class_names)}")
    print(f"instances: {report.instances}\n")
    for split in ("train", "val", "test"):
        count = report.per_split.get(split, 0)
        negatives = report.negatives_per_split.get(split, 0)
        share = report.negative_fraction(split)
        print(f"  {split:<6} {count:>6} images   {negatives:>5} empty ({share:.1%})")

    if report.undersized:
        print(
            f"\n{len(report.undersized)} image(s) excluded: the mask marks a slick but every "
            "component is below the area floor. Left out rather than labelled empty, which "
            "would teach the model that a real slick is background."
        )

    if report.skipped:
        print(f"\n{len(report.skipped)} image(s) skipped for want of a confirmed class:")
        for line in report.skipped[:5]:
            print(f"    {line}")
        if len(report.skipped) > 5:
            print(f"    ... and {len(report.skipped) - 5} more")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--sensors",
        default="sentinel",
        help="'sentinel' (default), 'all', or a comma-separated list",
    )
    parser.add_argument(
        "--classes",
        choices=("single", "two"),
        default="single",
        help="'single' emits one class (binary baseline); 'two' needs --confirmed",
    )
    parser.add_argument(
        "--confirmed",
        type=Path,
        default=None,
        help="Directory of attributed review JSON files with source image/mask hashes",
    )
    parser.add_argument("--dry-run", action="store_true", help="list sources, then stop")
    arguments = parser.parse_args()

    if not CORPUS.is_dir():
        print(f"no corpus at {CORPUS}. Run scripts/extract_zenodo.py first.", file=sys.stderr)
        return 2

    sensors: tuple[str, ...] | None
    sensors = None if arguments.sensors == "all" else tuple(arguments.sensors.split(","))

    print("sources:")
    sources = _collect(sensors)
    if not sources:
        print("\nnothing to assemble -- is the corpus extracted?", file=sys.stderr)
        return 1
    print(f"  {'total':<13} {len(sources):>6} images")

    confirmed = None
    class_names: tuple[str, ...] = (SINGLE_CLASS_NAME,)
    if arguments.classes == "two":
        if arguments.confirmed is None:
            print(
                "\n--classes two needs --confirmed: the corpus is binary oil/not-oil and "
                "the two-class scheme cannot be derived from it. Complete the relabelling "
                "review first, or build with --classes single for a binary baseline.",
                file=sys.stderr,
            )
            return 1
        try:
            confirmed = load_reviews(arguments.confirmed, sources)
        except DatasetError as error:
            print(str(error), file=sys.stderr)
            return 1
        class_names = CLASS_SCHEME

    if arguments.dry_run:
        print("\ndry run: nothing written")
        return 0

    try:
        report = build_dataset(sources, arguments.out, class_names=class_names, confirmed=confirmed)
    except DatasetError as error:
        print(f"\n{error}", file=sys.stderr)
        return 1

    _report(report)
    if class_names == (SINGLE_CLASS_NAME,):
        print(
            f"\nNOTE: this is a BINARY baseline ({SINGLE_CLASS_NAME}), not the two-class "
            "model. Do not export it under the two-class manifest in INTERFACES.md section 6."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
