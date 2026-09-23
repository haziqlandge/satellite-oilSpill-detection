"""The real drift runs' seed: a detected slick at sea, not a box the model filled."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("roaring_landmask")

from scripts.export_drift_runs import (
    FRAME_EDGE_KM,
    choose_seed,
    scene_bbox,
    straight_edge_km,
)

# Open water south of the Mississippi delta, and a point well inland in Louisiana.
SEA = (-89.40, 28.60)
LAND = (-91.10, 30.40)
PIXEL = 8.983152841195215e-05  # the processed scenes' grid, degrees


def _ragged(lon: float, lat: float, cells: int) -> list[list[float]]:
    """A diagonal streak traced the way a mask is: every edge a few pixels long."""
    lower = [[lon, lat]]
    for _ in range(cells):
        x, y = lower[-1]
        lower.append([x + 4 * PIXEL, y])
        lower.append([x + 4 * PIXEL, y + 4 * PIXEL])
    upper = [[x, y + 8 * PIXEL] for x, y in lower]
    return lower + upper[::-1] + [lower[0]]


def _box(lon: float, lat: float, side_px: int) -> list[list[float]]:
    """A mask that filled its predicted box: four straight edges."""
    d = side_px * PIXEL
    return [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]


def _scene(tmp_path: Path, rings: list[tuple[list[list[float]], float]]) -> Path:
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"confidence": conf},
        }
        for ring, conf in rings
    ]
    path = tmp_path / "S1A_IW_GRDH_1SDV_20230409T000206_x_s0db.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return path


def test_a_box_edge_is_measured_and_a_traced_edge_is_not() -> None:
    from shapely.geometry import Polygon

    assert straight_edge_km(Polygon(_box(*SEA, 400))) > 3.0
    assert straight_edge_km(Polygon(_ragged(*SEA, 40))) < FRAME_EDGE_KM


def test_the_largest_detection_loses_to_a_smaller_slick_when_it_is_a_filled_box(tmp_path: Path) -> None:
    path = _scene(tmp_path, [(_box(*SEA, 900), 0.74), (_ragged(SEA[0] + 0.2, SEA[1], 30), 0.4)])
    seed = choose_seed(path)
    assert (seed.feature, seed.part) == (1, 0)
    assert seed.frame_cut == 1 and seed.ashore == 0


def test_a_detection_on_land_is_passed_over(tmp_path: Path) -> None:
    path = _scene(tmp_path, [(_ragged(*LAND, 60), 0.9), (_ragged(*SEA, 20), 0.3)])
    seed = choose_seed(path)
    assert seed.feature == 1
    assert seed.ashore == 1
    lon, lat = seed.centre
    assert abs(lon - SEA[0]) < 0.05 and abs(lat - SEA[1]) < 0.05


def test_no_eligible_detection_is_an_error_not_a_fallback(tmp_path: Path) -> None:
    path = _scene(tmp_path, [(_box(*SEA, 900), 0.74), (_ragged(*LAND, 30), 0.5)])
    with pytest.raises(SystemExit, match="no detection"):
        choose_seed(path)


def test_the_wind_request_box_still_covers_every_ring(tmp_path: Path) -> None:
    """The ERA5 cache is keyed on this box; re-seeding must not move it."""
    path = _scene(tmp_path, [(_box(*SEA, 900), 0.74), (_ragged(*LAND, 30), 0.5)])
    (west, south, east, north), count = scene_bbox(path)
    assert count == 2
    assert west == pytest.approx(LAND[0]) and south == pytest.approx(SEA[1])
    assert east >= SEA[0] + 900 * PIXEL - 1e-9 and north > LAND[1]
