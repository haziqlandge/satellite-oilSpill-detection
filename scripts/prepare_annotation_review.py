"""Prepare a local annotation pilot from frozen train/val only; never infer test data."""

import argparse
import hashlib
import html
import json
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from skimage.measure import label

from backend.config import REPO_ROOT
from backend.ingest.datasets.relabel import binarise, export_review, propose_all
from ml.datasets.oos_dataset import _read_mask
from scripts.build_dataset import _collect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("eval/phase2-closure/annotation-pilot"))
    parser.add_argument("--limit", type=int, default=24)
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    if args.out.exists():
        raise FileExistsError(f"Refusing to overwrite {args.out}")
    sources = {source.identity: source for source in _collect(("sentinel",))}
    frozen = REPO_ROOT / "data/processed/dataset/final-v11"
    inventory = []
    for split in ("train", "val"):
        for line in (frozen / f"{split}.txt").read_text().splitlines():
            # Split lines are relative to the list file, not to the working
            # directory. See scripts/repath_artifacts.py.
            image = (frozen / line).resolve()
            annotation = image.parents[2] / "labels" / split / f"{image.stem}.txt"
            count = len(annotation.read_text().splitlines())
            inventory.append(
                dict(
                    identity=image.stem,
                    split=split,
                    image=image.relative_to(REPO_ROOT).as_posix(),
                    instances=count,
                )
            )
    # Alternate source/split groups so a small pilot does not cover just one corpus.
    groups = {}
    for row in inventory:
        if row["instances"]:
            source = sources[row["identity"]]
            assert source.mask is not None and not source.is_negative
            groups.setdefault((row["split"], row["identity"].split("__")[0]), []).append(row)
    selected = []
    while len(selected) < args.limit and any(groups.values()):
        for group in groups.values():
            if group and len(selected) < args.limit:
                selected.append(group.pop(0))
    reviews = args.out / "reviews"
    reviews.mkdir(parents=True)
    cards = []
    for row in selected:
        source = sources[row["identity"]]
        mask = _read_mask(source.mask)
        proposals = propose_all(mask)
        review = reviews / f"{source.identity}.json"
        export_review(proposals, review, source=source.identity)
        document = json.loads(review.read_text())
        document.update(
            image_sha256=hashlib.sha256(source.image.read_bytes()).hexdigest(),
            mask_sha256=hashlib.sha256(source.mask.read_bytes()).hexdigest(),
            # Repo-relative. `.resolve()` here is what rooted every earlier
            # review pack in the training machine's home directory, so the pack
            # only opened on the machine that built it.
            original_image=source.image.resolve().relative_to(REPO_ROOT).as_posix(),
            original_mask=source.mask.resolve().relative_to(REPO_ROOT).as_posix(),
            split=row["split"],
        )
        review.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        with Image.open(REPO_ROOT / row["image"]) as opened:
            picture = opened.convert("RGB")
        components = label(binarise(mask), connectivity=2)
        height, width = components.shape
        assert picture.size == (width, height)
        scale = min(768 / width, 768 / height, 1)
        size = (round(width * scale), round(height * scale))
        picture = picture.resize(size)
        overlay = np.zeros((height, width, 4), dtype=np.uint8)
        overlay[components > 0] = (255, 80, 0, 100)
        annotated = Image.alpha_composite(
            picture.convert("RGBA"), Image.fromarray(overlay).resize(size)
        ).convert("RGB")
        draw = ImageDraw.Draw(annotated)
        for proposal in proposals:
            r, c = proposal.morphology.centroid_rc
            draw.text(
                (c * scale, r * scale),
                str(proposal.label),
                fill="yellow",
                stroke_width=1,
                stroke_fill="black",
            )
        canvas = Image.new("RGB", (size[0] * 2, size[1]))
        canvas.paste(picture, (0, 0))
        canvas.paste(annotated, (size[0], 0))
        preview = f"{source.identity}.png"
        canvas.save(args.out / preview)
        cards.append(
            f'<h2>{html.escape(source.identity)} ({row["split"]})</h2><img width="100%" src="{html.escape(preview)}"><p><a href="reviews/{html.escape(review.name)}">Review JSON</a></p>'
        )
    summary = dict(
        eligible_tiles=len(inventory),
        positive_tiles=sum(row["instances"] > 0 for row in inventory),
        existing_polygon_instances=sum(row["instances"] for row in inventory),
        by_split=dict(Counter(row["split"] for row in inventory)),
        pilot_tiles=len(selected),
        note="Train/validation only. Existing polygon count estimates workload; raw component IDs are authoritative. No test predictions or labels reviewed. Pilot is not a training-ready dataset.",
        inventory=inventory,
    )
    (args.out / "inventory.json").write_text(json.dumps(summary, indent=2) + "\n")
    (args.out / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><title>Phase 02 annotation pilot</title>'
        "<style>body{max-width:1200px;margin:32px auto;font:16px sans-serif}img{border:1px solid #aaa}</style>"
        "<h1>Human annotation pilot — train/validation only</h1>"
        "<p>Left: image. Right: mask and original component IDs. Proposals are unconfirmed; "
        "shape alone does not establish oil origin. Verify against source evidence. "
        "Set confirmed_class (oos or slick_unknown) and confirmed_by in each review JSON only "
        "when supported. Leave uncertain components unconfirmed; do not force a class. "
        "Rejected/misdrawn masks need a separate corrected dataset version. "
        "Do not substitute a model prediction for human confirmation.</p>" + "\n".join(cards),
        encoding="utf-8",
    )
    print(json.dumps({k: v for k, v in summary.items() if k != "inventory"}, indent=2))


if __name__ == "__main__":
    main()
