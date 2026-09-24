"""Run CFAR over the annotation pilot and build a review pack a person can use.

FUTURE_WORK §2.1-2.3. The pilot's proposer could never propose `oos`: it needs a
bright target near a linear instance, no CFAR had been run, and so
`bright_target_distance_px` was -1 for all 355 instances (ISSUES B2). This runs
`backend/detect/cfar` over every pilot tile whose raster carries calibrated
backscatter, re-proposes with the targets it finds, and measures per instance
what the rubric asks a reviewer to weigh:

* **distance to the nearest bright target**, in pixels and metres;
* **whether that target sits at an end** of the instance's long axis -- where a
  vessel sits for a discharge trail, and also for a wake, which the reviewer
  separates by eye (a wake diverges in a V from the target; a trail does not);
* **contrast**: the instance against a ring of sea around it, in dB of mean
  linear backscatter (the damping ratio, relative, never a thickness -- C2);
* **the sea behind it**: the tile's median band-2 backscatter outside every
  instance, as a sea-state hint. It is not a wind speed: the corpus records no
  acquisition time, so ERA5 cannot be looked up, and the pack says so.

It writes a NEW directory (the pilot is left untouched): `reviews/*.json` in
the `relabel.export_review` format plus the evidence, `tiles/` previews, and
one self-contained `index.html` where a reviewer records decisions and
downloads them as a bundle for `scripts/apply_review_decisions.py`.

Refined SOS tiles are 8-bit PNGs scaled by their authors under an unknown rule
(DATA.md D6). CA-CFAR's threshold is derived for linear power, so it is not run
on them, and their records say why.

    .venv/Scripts/python.exe -m scripts.cfar_review_pack \
        --pilot eval/phase2-closure/annotation-pilot --out eval/phase2-closure/annotation-pilot-cfar
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from backend.config import REPO_ROOT
from backend.detect.cfar.detector import (
    DEFAULT_GUARD_PX,
    DEFAULT_MIN_AREA_PX,
    DEFAULT_PFA,
    DEFAULT_TRAIN_PX,
    SCENE_BAND,
    BrightTarget,
    detect_bright_targets,
)
from backend.ingest.datasets.relabel import (
    VESSEL_ADJACENT_PX,
    binarise,
    export_review,
    propose_all,
)
from ml.datasets.oos_dataset import _read_mask, db_to_uint8

TEMPLATE = Path(__file__).with_name("review_pack.html")
PREVIEW_PX = 1024
# The contrast ring: a guard of 3 px so the slick's own soft edge is not counted
# as sea, then 12 px of sea around it.
RING_GUARD_PX = 3
RING_WIDTH_PX = 12
# A target within this share of the long axis of either end reads as "at an end".
END_SHARE = 0.2


def read_db_band(path: Path) -> tuple[np.ndarray | None, tuple[float, float] | None, str]:
    """The calibrated band-2 dB raster and its pixel spacing, or why there is none."""

    if path.suffix.lower() in {".tif", ".tiff"}:
        import rasterio

        with rasterio.open(path) as source:
            if source.count >= SCENE_BAND and np.issubdtype(np.dtype(source.dtypes[0]), np.floating):
                db = np.asarray(source.read(SCENE_BAND), dtype=np.float64)
                spacing = None
                if source.crs is not None and source.crs.to_epsg() == 4326:
                    lat = (source.bounds.top + source.bounds.bottom) / 2.0
                    spacing = (
                        abs(source.transform.a) * 111_320.0 * math.cos(math.radians(lat)),
                        abs(source.transform.e) * 110_574.0,
                    )
                return db, spacing, ""
    return None, None, (
        "not a calibrated backscatter raster (an 8-bit image scaled by its authors, DATA.md D6); "
        "CA-CFAR's threshold is derived for linear power, so it is not run"
    )


def _linear_mean_db(db: np.ndarray, where: np.ndarray) -> float:
    return float(10.0 * np.log10(np.mean(np.power(10.0, db[where] / 10.0))))


def instance_evidence(
    labelled: np.ndarray,
    label: int,
    db: np.ndarray | None,
    targets: list[BrightTarget],
    spacing: tuple[float, float] | None,
) -> dict[str, Any]:
    """What the rubric weighs for one instance, measured."""

    from scipy import ndimage

    rows, cols = np.nonzero(labelled == label)
    evidence: dict[str, Any] = {
        "contrast_db": None,
        "nearest_target_px": None,
        "nearest_target_m": None,
        "target_at_end": None,
    }
    if rows.size == 0:
        return evidence

    if db is not None:
        pad = RING_GUARD_PX + RING_WIDTH_PX + 1
        r0, r1 = max(0, rows.min() - pad), min(labelled.shape[0], rows.max() + pad + 1)
        c0, c1 = max(0, cols.min() - pad), min(labelled.shape[1], cols.max() + pad + 1)
        window = labelled[r0:r1, c0:c1]
        values = db[r0:r1, c0:c1]
        valid = values != 0.0  # zero is no-data in the corpus, as in CFAR
        inside = window == label
        near = ndimage.binary_dilation(inside, iterations=RING_GUARD_PX)
        far = ndimage.binary_dilation(inside, iterations=RING_GUARD_PX + RING_WIDTH_PX)
        ring = far & ~near & (window == 0) & valid
        inner = inside & valid
        if inner.any() and ring.any():
            evidence["contrast_db"] = round(_linear_mean_db(values, inner) - _linear_mean_db(values, ring), 2)

    if targets:
        dx, dy = spacing if spacing else (1.0, 1.0)
        cr, cc = float(rows.mean()), float(cols.mean())
        nearest = min(targets, key=lambda t: math.hypot(t.row - cr, t.col - cc))
        # Distance to the instance itself, not its centroid: a trail runs away
        # from the vessel, so its centroid can be kilometres from the target.
        step = max(1, rows.size // 20_000)
        gaps = np.hypot(rows[::step] - nearest.row, cols[::step] - nearest.col)
        px = float(gaps.min())
        evidence["nearest_target_px"] = round(px, 1)
        if spacing:
            k = int(np.argmin(gaps))
            evidence["nearest_target_m"] = round(
                math.hypot((rows[::step][k] - nearest.row) * dy, (cols[::step][k] - nearest.col) * dx), 1)
        # Where along the long axis the target sits.
        y = rows - cr
        x = cols - cc
        cov = np.cov(np.vstack([x, y])) if rows.size > 2 else np.eye(2)
        values_, vectors = np.linalg.eigh(cov)
        ux, uy = vectors[:, int(np.argmax(values_))]
        along = x * ux + y * uy
        lo, hi = float(along.min()), float(along.max())
        length = max(hi - lo, 1.0)
        t = (nearest.col - cc) * ux + (nearest.row - cr) * uy
        evidence["target_at_end"] = bool(
            px <= VESSEL_ADJACENT_PX and (t <= lo + END_SHARE * length or t >= hi - END_SHARE * length))
    return evidence


def _preview(identity: str, db: np.ndarray | None, image_path: Path, labelled: np.ndarray, tiles: Path) -> float:
    from PIL import Image

    if db is not None:
        grey = Image.fromarray(db_to_uint8(db))
    else:
        with Image.open(image_path) as opened:
            grey = opened.convert("L")
    height, width = labelled.shape
    scale = min(1.0, PREVIEW_PX / max(width, height))
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    grey.resize(size, Image.Resampling.LANCZOS).save(tiles / f"{identity}.jpg", quality=88)

    # The mask as its own layer, coloured by instance, so the page can toggle it.
    rng = np.random.default_rng(7)
    palette = np.zeros((int(labelled.max()) + 1, 4), dtype=np.uint8)
    palette[1:, :3] = rng.integers(90, 256, (palette.shape[0] - 1, 3))
    palette[1:, 3] = 130
    small = np.asarray(Image.fromarray(labelled.astype(np.int32)).resize(size, Image.Resampling.NEAREST))
    Image.fromarray(palette[small], "RGBA").save(tiles / f"{identity}-mask.png")
    return float(scale)


def build_pack(
    pilot: Path,
    out: Path,
    *,
    repo_root: Path = REPO_ROOT,
    guard_px: int = DEFAULT_GUARD_PX,
    train_px: int = DEFAULT_TRAIN_PX,
    pfa: float = DEFAULT_PFA,
    min_area_px: int = DEFAULT_MIN_AREA_PX,
) -> dict[str, Any]:
    """Build the pack from the pilot's reviews. Refuses to overwrite `out`."""

    from skimage.measure import label as label_components

    if out.exists():
        raise FileExistsError(f"Refusing to overwrite {out}")
    reviews_out = out / "reviews"
    tiles = out / "tiles"
    reviews_out.mkdir(parents=True)
    tiles.mkdir()

    started = time.time()
    before: Counter[str] = Counter()
    after: Counter[str] = Counter()
    cfar_runs: Counter[str] = Counter()
    pack_tiles: list[dict[str, Any]] = []
    for path in sorted((pilot / "reviews").glob("*.json")):
        old = json.loads(path.read_text(encoding="utf-8"))
        identity = old["source"]
        for record in old.get("instances", []):
            before[str(record.get("proposed_class"))] += 1
        image_path = repo_root / old["original_image"]
        mask_path = repo_root / old["original_mask"]
        mask = _read_mask(mask_path)
        db, spacing, why_not = read_db_band(image_path)

        targets: list[BrightTarget] = []
        if db is not None:
            targets = detect_bright_targets(
                db, guard_px=guard_px, train_px=train_px, pfa=pfa, min_area_px=min_area_px, input_db=True)
            cfar: dict[str, Any] = {
                "status": "run",
                "band": SCENE_BAND,
                "params": {"guard_px": guard_px, "train_px": train_px, "pfa": pfa, "min_area_px": min_area_px},
                "targets": [
                    {"row": round(t.row, 1), "col": round(t.col, 1), "area_px": t.area_px,
                     "peak_db": round(10.0 * math.log10(t.peak_linear), 2)}
                    for t in targets
                ],
            }
        else:
            cfar = {"status": "not_applicable", "reason": why_not, "targets": []}
        cfar_runs[cfar["status"]] += 1

        proposals = propose_all(mask, bright_targets=[t.centroid_rc for t in targets])
        destination = reviews_out / f"{identity}.json"
        export_review(proposals, destination, source=identity)
        document = json.loads(destination.read_text(encoding="utf-8"))

        labelled = label_components(binarise(mask), connectivity=2)
        background = None
        if db is not None:
            sea = (labelled == 0) & (db != 0.0)
            if sea.any():
                background = round(float(np.median(db[sea])), 2)
        for record in document["instances"]:
            record["evidence"] = instance_evidence(labelled, record["label"], db, targets, spacing)
            record["review_decision"] = None
            record["confirmed_confidence"] = None
            record["notes"] = ""
            after[str(record["proposed_class"])] += 1
        document.update(
            image_sha256=hashlib.sha256(image_path.read_bytes()).hexdigest(),
            mask_sha256=hashlib.sha256(mask_path.read_bytes()).hexdigest(),
            original_image=old["original_image"],
            original_mask=old["original_mask"],
            split=old.get("split"),
            cfar=cfar,
            pixel_spacing_m=[round(v, 2) for v in spacing] if spacing else None,
            background_db=background,
            wind={
                "status": "unknown",
                "reason": "the corpus records no acquisition time, so ERA5 wind cannot be looked up",
            },
        )
        destination.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

        scale = _preview(identity, db, image_path, labelled, tiles)
        height, width = labelled.shape
        pack_tiles.append({
            "identity": identity,
            "corpus": identity.split("__")[0],
            "split": document["split"],
            "width": width,
            "height": height,
            "scale": scale,
            "image": f"tiles/{identity}.jpg",
            "mask": f"tiles/{identity}-mask.png",
            "pixel_spacing_m": document["pixel_spacing_m"],
            "background_db": background,
            "wind": document["wind"],
            "cfar": {k: v for k, v in cfar.items() if k != "targets"} | {"count": len(targets)},
            "targets": [{"x": t.col * scale, "y": t.row * scale, "peak_db": c["peak_db"]}
                        for t, c in zip(targets, cfar["targets"], strict=True)],
            "instances": [
                {
                    "label": r["label"],
                    "proposed_class": r["proposed_class"],
                    "confidence": r["confidence"],
                    "needs_review": r["needs_review"],
                    "reasons": r["reasons"],
                    "terms": r["terms"],
                    "evidence": r["evidence"],
                    "x": r["morphology"]["centroid_rc"][1] * scale,
                    "y": r["morphology"]["centroid_rc"][0] * scale,
                    "area_km2": (round(r["morphology"]["area_px"] * spacing[0] * spacing[1] / 1e6, 4)
                                 if spacing else None),
                }
                for r in document["instances"]
            ],
        })

    summary: dict[str, Any] = {
        "tiles": len(pack_tiles),
        "instances": sum(after.values()),
        "cfar": dict(cfar_runs),
        "targets": sum(len(t["targets"]) for t in pack_tiles),
        "proposed_before": dict(before),
        "proposed": {"oos": after["oos"], "slick_unknown": after["slick_unknown"], "deferred": after["None"]},
        "seconds": round(time.time() - started, 1),
        "note": (
            "Proposals are suggestions, not labels. Train/validation tiles only; no test data. "
            "Wind is unknown for every tile (no acquisition time in the corpus)."
        ),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    data = json.dumps({"summary": summary, "tiles": pack_tiles}, separators=(",", ":")).replace("</", "<\\/")
    page = TEMPLATE.read_text(encoding="utf-8").replace("/*__PACK_DATA__*/null", data)
    (out / "index.html").write_text(page, encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pilot", type=Path, default=REPO_ROOT / "eval/phase2-closure/annotation-pilot")
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "eval/phase2-closure/annotation-pilot-cfar")
    args = parser.parse_args()
    summary = build_pack(args.pilot, args.out)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
