"""Measure two-pass detection against the full sweep on the processed Gulf scenes.

`backend/pipeline/screen.py` fixes its rule before this is run. This says what
the rule costs: how many of each scene's 864 tiles it sends to the model, how
much of the full sweep's detected area those tiles reach, and -- with `--infer`
-- what the model actually finds on them against `eval/final/scenes/`, down to
whether the drift would be seeded from the same slick.

    .venv/Scripts/python.exe -m scripts.measure_two_pass
    .venv/Scripts/python.exe -m scripts.measure_two_pass --infer
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from backend.config import REPO_ROOT

SCENES = REPO_ROOT / "eval" / "final" / "scenes"
SAR = REPO_ROOT / "data" / "processed" / "sar"
WEIGHTS = REPO_ROOT / "weights" / "L1-ciou-research.pt"


def measure(stem: str, *, infer: bool) -> dict[str, object]:
    import rasterio
    from shapely.geometry import box, shape
    from shapely.ops import unary_union

    from backend.drift.seedrule import choose_seed_in, polygon_parts
    from backend.pipeline.screen import screen_raster
    from ml.export.export import read_manifest

    raster = SAR / f"{stem}.tif"
    sweep = json.loads((SCENES / f"{stem}.geojson").read_text())
    manifest = read_manifest(WEIGHTS, expected_classes=("slick",))
    tiling = manifest["tiling"]
    started = time.perf_counter()
    screen = screen_raster(raster, manifest["raster"]["band"], tile_size=tiling["tile_size"], overlap=tiling["overlap"])
    screen_s = time.perf_counter() - started

    with rasterio.open(raster) as source:
        transform = source.transform
    size = tiling["tile_size"]
    # The selected tiles' footprint in lon/lat.
    footprint = unary_union([
        box(*(transform * (c, r + size)), *(transform * (c + size, r))) for r, c in screen.selected
    ])
    total = reached = 0.0
    for feature in sweep["features"]:
        geometry = shape(feature["geometry"])
        total += geometry.area
        reached += geometry.intersection(footprint).area
    seed = choose_seed_in(sweep)
    seed_polygon = next(p for fi, pi, p, _ in polygon_parts(sweep) if (fi, pi) == (seed.feature, seed.part))
    result: dict[str, object] = {
        "scene": stem,
        "screen": screen.as_dict(),
        "screenSeconds": round(screen_s, 1),
        "detections": len(sweep["features"]),
        "areaReachedPct": round(100 * reached / total, 2) if total else None,
        "seedReachedPct": round(100 * seed_polygon.intersection(footprint).area / seed_polygon.area, 2),
    }
    if infer:
        from backend.detect.yolo_lsk.infer import infer_scene

        started = time.perf_counter()
        found = infer_scene(raster, WEIGHTS, research=True, device="cpu", assume_vv_db_band=manifest["raster"]["band"],
                            select=screen.admits)
        infer_s = time.perf_counter() - started
        got = unary_union([shape(f["geometry"]) for f in found["features"]]) if found["features"] else None
        full = unary_union([shape(f["geometry"]) for f in sweep["features"]])
        recovered = 0.0 if got is None else full.intersection(got).area
        extra = 0.0 if got is None else got.difference(full).area
        try:
            two_seed = choose_seed_in(found)
            two_polygon = next(p for fi, pi, p, _ in polygon_parts(found) if (fi, pi) == (two_seed.feature, two_seed.part))
            seed_iou = seed_polygon.intersection(two_polygon).area / seed_polygon.union(two_polygon).area
        except Exception as error:  # recorded in the row, not hidden
            seed_iou = None
            result["twoPassSeedError"] = str(error)
        result.update({
            "inferSeconds": round(infer_s, 1),
            "tilesRun": found["properties"]["tiles"],
            "twoPassDetections": len(found["features"]),
            "areaRecoveredPct": round(100 * recovered / full.area, 2),
            "areaNotInSweepPct": round(100 * extra / full.area, 2),
            "seedIoU": None if seed_iou is None else round(seed_iou, 4),
        })
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--infer", action="store_true", help="run the model on the selected tiles too")
    parser.add_argument("--out", type=Path, help="write the measurements as JSON")
    args = parser.parse_args()
    rows = []
    for path in sorted(SCENES.glob("*.geojson")):
        if not (SAR / f"{path.stem}.tif").exists():
            print(f"{path.stem[17:32]}: the processed scene is not on this machine")
            continue
        row = measure(path.stem, infer=args.infer)
        rows.append(row)
        print(json.dumps(row), flush=True)
    if args.out:
        args.out.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
