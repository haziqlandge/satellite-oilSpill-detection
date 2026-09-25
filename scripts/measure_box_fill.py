"""Whole-box fill (ISSUES Q5) on the three Gulf scenes: the v11 release against v12.

A polygon whose outline runs straight along the pixel grid for `FRAME_EDGE_KM`
or more filled its predicted box (`backend/drift/seedrule.py`). This counts
them, and their share of all detected area, in each model's full-scene output.

    .venv/Scripts/python.exe -m scripts.measure_box_fill
"""

from __future__ import annotations

import json
from pathlib import Path

from backend.drift.seedrule import (
    EARTH_KM_PER_DEG_LAT,
    FRAME_EDGE_KM,
    NoSeedError,
    choose_seed_in,
    km_per_deg_lon,
    polygon_parts,
    straight_edge_km,
)

ROOT = Path(__file__).resolve().parents[1]
MODELS = {"v11": ROOT / "eval/final/scenes-v11", "v12": ROOT / "eval/final/scenes"}
OUT = ROOT / "eval/part2/box_fill.json"


def measure(document: dict) -> dict:
    parts = polygon_parts(document)
    areas = [p.area * km_per_deg_lon(p.centroid.y) * EARTH_KM_PER_DEG_LAT for _, _, p, _ in parts]
    boxed = [straight_edge_km(p) >= FRAME_EDGE_KM for _, _, p, _ in parts]
    total = sum(areas)
    box_area = sum(a for a, b in zip(areas, boxed, strict=True) if b)
    try:
        seed = choose_seed_in(document).as_dict()
    except NoSeedError as error:
        seed = {"refused": str(error)}
    return dict(
        detections=len(document["features"]),
        polygons=len(parts),
        areaKm2=round(total, 2),
        boxCutPolygons=sum(boxed),
        boxCutAreaKm2=round(box_area, 2),
        boxCutAreaShare=round(box_area / total, 4) if total else None,
        seed=seed,
    )


def main() -> None:
    report: dict = {"rule": f"straight grid-aligned run >= {FRAME_EDGE_KM} km", "scenes": {}}
    for scene in sorted(p.stem for p in MODELS["v12"].glob("*.geojson")):
        report["scenes"][scene] = {
            name: measure(json.loads((folder / f"{scene}.geojson").read_text()))
            for name, folder in MODELS.items()
        }
        for name, row in report["scenes"][scene].items():
            print(scene[17:25], name, {k: v for k, v in row.items() if k != "seed"})
    OUT.write_text(json.dumps(report, indent=2))
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
