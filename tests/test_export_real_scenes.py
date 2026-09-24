"""The real-run scene export: one ring per polygon part, each saying whose part it is."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("roaring_landmask")

from scripts.export_real_scenes import detections
from tests.test_export_drift_runs import PIXEL, SEA, _box, _ragged


def test_rings_carry_the_detection_they_came_from(tmp_path: Path) -> None:
    # A MultiPolygon is one detection with two parts. The view counts
    # detections, so a ring must say which one it belongs to, or 86 detections
    # in April read as 366 (their parts).
    one = _ragged(*SEA, 40)
    lon, lat = SEA[0] + 400 * PIXEL, SEA[1]
    two_a = _ragged(lon, lat, 20)
    two_b = _ragged(lon + 200 * PIXEL, lat, 20)
    features = [
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [one]},
         "properties": {"confidence": 0.5}},
        {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": [[two_a], [two_b]]},
         "properties": {"confidence": 0.4}},
    ]
    path = tmp_path / "S1A_IW_GRDH_1SDV_20230409T000206_x_s0db.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))

    found = detections(path)

    assert [d["feature"] for d in found] == [0, 1, 1]
    assert len({d["feature"] for d in found}) == 2
    assert sum(1 for d in found if d["seed"]) == 1


def test_box_filled_polygons_are_flagged_for_the_view(tmp_path: Path) -> None:
    # The view draws a mask that filled its inference box differently from a
    # traced slick (ISSUES F18, Q5), so the export says which is which, by the
    # same straight-edge test the seed rule uses.
    streak = _ragged(*SEA, 40)
    box = _box(SEA[0] + 600 * PIXEL, SEA[1], 400)
    features = [
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
         "properties": {"confidence": conf}}
        for ring, conf in ((streak, 0.5), (box, 0.3))
    ]
    path = tmp_path / "S1A_IW_GRDH_1SDV_20230409T000206_x_s0db.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))

    found = detections(path)

    assert [d["boxCut"] for d in found] == [False, True]
    assert [d["seed"] for d in found] == [True, False]


def test_cfar_near_the_seed_returns_targets_where_they_are(tmp_path: Path) -> None:
    # A real run's radar evidence: CA-CFAR on the processed scene around the
    # seed, positions in lon/lat. A 3x3 target 30 dB over the sea at a known
    # place must come back there, within a pixel.
    import rasterio
    from rasterio.transform import from_origin

    from scripts.export_real_scenes import cfar_near_seed

    rng = np.random.default_rng(1)
    size, west, north = 600, -89.3, 29.0
    db = 10 * np.log10(10 ** (-2.0) * rng.exponential(1.0, (size, size)))
    db[300:303, 200:203] = 10.0
    path = tmp_path / "scene_s0db.tif"
    with rasterio.open(path, "w", driver="GTiff", width=size, height=size, count=2, dtype="float32",
                       crs="EPSG:4326", transform=from_origin(west, north, PIXEL, PIXEL)) as out:
        out.write((db - 7).astype(np.float32), 1)
        out.write(db.astype(np.float32), 2)
    target_lon, target_lat = west + 201.5 * PIXEL, north - 301.5 * PIXEL

    found = cfar_near_seed(path, (west + 300 * PIXEL, north - 300 * PIXEL), radius_km=2.0)

    assert found["status"] == "run"
    lon, lat = found["targets"][0]["position"]
    assert abs(lon - target_lon) < 1.5 * PIXEL and abs(lat - target_lat) < 1.5 * PIXEL
    assert found["targets"][0]["peakDb"] > 5


def test_cfar_near_the_seed_says_when_the_scene_is_not_here(tmp_path: Path) -> None:
    from scripts.export_real_scenes import cfar_near_seed

    found = cfar_near_seed(tmp_path / "absent.tif", (-89.0, 29.0))
    assert found["status"] == "not_run" and found["targets"] == []
