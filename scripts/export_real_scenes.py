"""Export what a real-run view needs besides the drift: detections and wind.

`export_drift_runs.py` writes OpenDrift's backward field for each full scene in
`eval/final/scenes/`. A console view of that run also needs the slicks the
model actually found in the scene, and the wind the drift actually ran
through, so both are written beside it as `frontDemo/public/runs/<scene>/scene.json`.

* **Detections** are the release model's full-scene output, every polygon with
  its confidence. They follow pixel edges, which makes the files 1.6-12 MB; each
  ring is simplified to 0.0002 degrees (~20 m, two Sentinel-1 pixels) with its
  topology preserved, which is invisible at any zoom the console uses. The
  polygon the drift was seeded from is flagged.
* **Wind** is read from the SAME cached ERA5 request the drift used, at the
  seed, hour by hour. `DEMO_OFFLINE=1` is set so this can only read the cache:
  a wind series that was fetched separately would not be the wind the particles
  felt. There is no current field (ISSUES X2), and the file says so rather than
  writing zeros that look like a measurement.

    .venv/Scripts/python.exe -m scripts.export_real_scenes
"""

from __future__ import annotations

import json
import math
import os
from datetime import timedelta
from pathlib import Path

import numpy as np

from scripts.export_drift_runs import (
    BACKWARD_HOURS,
    OUT,
    SCENES,
    largest_polygon,
    scene_acquired_at,
)

SIMPLIFY_DEG = 0.0002


def detections(path: Path) -> list[dict[str, object]]:
    from shapely.geometry import shape

    document = json.loads(path.read_text())
    seed, _, _ = largest_polygon(path)
    out: list[dict[str, object]] = []
    for feature in document.get("features", []):
        geometry = shape(feature["geometry"])
        polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
        for polygon in polygons:
            simple = polygon.simplify(SIMPLIFY_DEG, preserve_topology=True)
            if simple.is_empty or simple.geom_type != "Polygon":
                continue
            ring = [[round(x, 5), round(y, 5)] for x, y in simple.exterior.coords]
            xs = [p[0] for p in polygon.exterior.coords]
            ys = [p[1] for p in polygon.exterior.coords]
            # The drift export seeds from the centroid of the vertex list of the
            # ring with the biggest bounding box; flag that ring the same way.
            is_seed = math.isclose(sum(xs) / len(xs), seed[0], abs_tol=1e-9) and math.isclose(
                sum(ys) / len(ys), seed[1], abs_tol=1e-9
            )
            out.append({
                "ring": ring,
                "confidence": round(float(feature["properties"].get("confidence", 0.0)), 4),
                "seed": is_seed,
            })
    return out


def wind(path: Path) -> dict[str, object]:
    import xarray as xr

    from backend.ingest.metocean.cache import fetch_with_cache
    from backend.ingest.metocean.era5 import fetch_era5_wind, wind_request

    acquired = scene_acquired_at(path.stem)
    assert acquired is not None
    seed, bbox, _ = largest_polygon(path)
    # Exactly the request `export_drift_runs.export_scene` made.
    request = wind_request(
        west=bbox[0], south=bbox[1], east=bbox[2], north=bbox[3],
        start=acquired - timedelta(hours=BACKWARD_HOURS + 1),
        end=acquired + timedelta(hours=1),
    )
    os.environ["DEMO_OFFLINE"] = "1"
    nc = fetch_with_cache(request, fetch_era5_wind)
    with xr.open_dataset(nc) as ds:
        time_name = "valid_time" if "valid_time" in ds.coords else "time"
        lat_name = "latitude" if "latitude" in ds.coords else "lat"
        lon_name = "longitude" if "longitude" in ds.coords else "lon"
        at = ds.sel({lat_name: seed[1], lon_name: seed[0]}, method="nearest")
        hours, speed, from_deg = [], [], []
        for h in range(-BACKWARD_HOURS, 1):
            instant = np.datetime64(acquired + timedelta(hours=h))
            row = at.sel({time_name: instant}, method="nearest")
            u, v = float(row["u10"]), float(row["v10"])
            hours.append(h)
            speed.append(round(math.hypot(u, v), 2))
            # Meteorological convention: the direction the wind blows FROM.
            from_deg.append(round((math.degrees(math.atan2(-u, -v)) + 360) % 360, 1))
        grid = [round(float(at[lon_name]), 3), round(float(at[lat_name]), 3)]
    return {
        "source": "ERA5 10 m wind (u10, v10), the cached request the drift ran on",
        "gridPoint": grid,
        "hours": hours,
        "ms": speed,
        "fromDeg": from_deg,
        "current": "none: no current field (CMEMS has no credentials, ISSUES X2); the drift is wind-driven",
    }


def main() -> int:
    for path in sorted(SCENES.glob("*.geojson")):
        target = OUT / path.stem
        if not (target / "drift.json").exists():
            print(f"{path.stem[:32]}: no drift.json; run export_drift_runs first")
            continue
        found = detections(path)
        series = wind(path)
        payload = {
            "scene": path.stem,
            "detections": found,
            "detectionSource": "release model (L1-ciou research) on the full scene, eval/final/scenes; "
                               f"rings simplified to {SIMPLIFY_DEG} deg",
            "wind": series,
        }
        out = target / "scene.json"
        out.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        seeds = sum(1 for d in found if d["seed"])
        hours = series["hours"]
        assert isinstance(hours, list)
        print(f"{path.stem[17:32]}: {len(found)} polygons ({seeds} seed), "
              f"{len(hours)} wind hours, {out.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
