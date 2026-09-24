"""Slick geometry (PHASE-03): shapes with analytically known answers, and the P004 cases."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest
from shapely.affinity import rotate
from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.ops import transform

from backend.characterize.geometry import GeometryError, local_projection, measure
from backend.characterize.verdict import haversine_km

FIXTURES = Path(__file__).parent / "fixtures" / "characterise"
LON, LAT = -89.4, 28.6


def lonlat(shape_m, lon: float = LON, lat: float = LAT):
    """A shape drawn in metres around (lon, lat), as lon/lat."""
    _, inverse = local_projection(lon, lat)
    return transform(inverse, shape_m)


def metres(point, lon: float = LON, lat: float = LAT) -> np.ndarray:
    forward, _ = local_projection(lon, lat)
    return np.asarray(forward(*point))


def test_rotated_rectangle_is_measured_exactly():
    # 10 km x 500 m, long axis on a bearing of 30 degrees.
    shape = rotate(box(-5000, -250, 5000, 250), 60, origin=(0, 0))
    g = measure(lonlat(shape))
    assert g.area_km2 == pytest.approx(5.0, rel=1e-3)
    assert g.length_km == pytest.approx(10.0, rel=0.01)
    assert g.width_m_mean == pytest.approx(500, rel=0.02)
    assert g.elongation == pytest.approx(20, rel=0.03)
    assert g.orientation_deg % 180 == pytest.approx(30, abs=1.0)
    assert g.fragmentation == 1 and g.gap_km == 0
    # The ends are the middles of the short edges, to within a pixel or so.
    ends = sorted([metres(g.head), metres(g.tail)], key=lambda p: p[1])
    for end, want in zip(ends, [(-2500, -4330.1), (2500, 4330.1)], strict=True):
        assert np.hypot(*(end - want)) < 2 * g.resolution_m


def test_curved_ribbon_length_follows_the_curve():
    # A quarter circle of radius 10 km, 300 m wide: the centreline is 15.708 km.
    theta = np.linspace(0, math.pi / 2, 200)
    outer = [(10150 * math.cos(t), 10150 * math.sin(t)) for t in theta]
    inner = [(9850 * math.cos(t), 9850 * math.sin(t)) for t in theta[::-1]]
    g = measure(lonlat(Polygon(outer + inner)))
    assert g.length_km == pytest.approx(10 * math.pi / 2, rel=0.01)
    assert g.width_m_mean == pytest.approx(300, rel=0.03)
    assert g.hull_deficiency > 0.8  # an arc is mostly empty hull


def test_wedge_puts_the_narrow_end_first_and_widens_along_the_profile():
    wedge = Polygon([(0, -30), (8000, -300), (8000, 300), (0, 30)])
    g = measure(lonlat(wedge))
    assert np.hypot(*metres(g.head)) < 2 * g.resolution_m, "the head is the narrow end"
    assert g.length_km == pytest.approx(8.0, rel=0.01)
    profile = np.asarray(g.width_m_profile)
    assert profile[0] < 120 and profile[-1] > 560
    assert np.all(np.diff(profile) > -2 * g.resolution_m)
    assert g.head_tail_resolved_by == "ambiguous", "a width order is a convention, not a resolution"


def test_disc_is_compact_and_not_elongated():
    g = measure(lonlat(Point(0, 0).buffer(1000, 256)))
    assert g.area_km2 == pytest.approx(math.pi, rel=1e-3)
    assert g.compactness == pytest.approx(1.0, abs=0.01)
    assert g.elongation < 1.5


def test_fragments_are_chained_and_the_gaps_count_toward_length():
    parts = MultiPolygon([box(0, -100, 2000, 100), box(3000, -100, 5000, 100), box(6000, -100, 8000, 100)])
    g = measure(lonlat(parts))
    assert g.fragmentation == 3
    assert g.gap_km == pytest.approx(2.0, rel=0.01)
    assert g.length_km == pytest.approx(8.0, rel=0.01)
    # Stations sit on the parts, never in the gaps.
    assert min(g.width_m_profile) == pytest.approx(200, rel=0.05)


def test_holes_count_against_area_but_not_width_or_length():
    holed = Polygon(box(-4000, -300, 4000, 300).exterior.coords, [Point(0, 0).buffer(150).exterior.coords])
    g = measure(lonlat(holed))
    assert g.area_km2 == pytest.approx(4.8 - math.pi * 0.15**2, rel=1e-3)
    assert g.length_km == pytest.approx(8.0, rel=0.01)
    assert g.width_m_mean == pytest.approx(600, rel=0.02)


def test_area_is_equal_area_not_degrees():
    # Regression guard (PHASE-03): a 10 km square at 60N is 100 km2. Degrees
    # scaled by 111 km on both axes call it about twice that.
    square = lonlat(box(-5000, -5000, 5000, 5000), lon=10.0, lat=60.0)
    g = measure(square)
    assert g.area_km2 == pytest.approx(100.0, rel=5e-3)
    assert square.area * 111.32**2 > 190


def test_outlines_that_cannot_be_measured_are_refused():
    with pytest.raises(GeometryError):
        measure(Polygon())
    with pytest.raises(GeometryError):
        measure(Polygon([(0, 0), (1, 0), (2, 0), (0, 0)]))


def test_a_self_intersecting_outline_is_repaired_and_measured():
    bowtie = Polygon([(0, 0), (4000, 400), (4000, 0), (0, 400), (0, 0)])
    assert not bowtie.is_valid
    g = measure(lonlat(bowtie))
    assert g.area_km2 > 0 and g.fragmentation >= 1


def _authored() -> list[dict]:
    return json.loads((FIXTURES / "authored_slicks.json").read_text())["slicks"]


def _outline(slick: dict):
    polygons = [Polygon(ring) for ring in slick["parts"]]
    return MultiPolygon(polygons) if len(polygons) > 1 else polygons[0]


@pytest.mark.parametrize("slick", _authored(), ids=lambda s: s["id"])
def test_authored_slicks_measure_as_they_were_drawn(slick):
    g = measure(_outline(slick))
    source = tuple(slick["source"])
    # PHASE-03: an end within 1 km of the source tip. Measured: 3-15 m on the Gulf and Kutch
    # slicks, 100 m on the three-fragment mumbai-null.
    assert min(haversine_km(g.head, source), haversine_km(g.tail, source)) < 1.0
    # Length along the axis agrees with the generator's own centreline.
    assert g.length_km == pytest.approx(slick["console"]["lengthKm"], rel=0.08)
    assert g.area_km2 == pytest.approx(slick["console"]["areaKm2"], rel=0.01)
    assert g.fragmentation == slick["console"]["fragmentation"]


@pytest.mark.parametrize("slick", [s for s in _authored() if s["p004"]], ids=lambda s: s["p004"]["case"])
def test_p004_case_lengths(slick):
    # PHASE-03 acceptance: Case 2 ~19 km, Case 1 ~5.5 km, Case 3 ~5 km.
    g = measure(_outline(slick))
    assert g.length_km == pytest.approx(slick["p004"]["lengthKm"], rel=0.05)


def test_the_same_outline_measures_the_same_every_time():
    # medial_axis breaks ties in a random order unless seeded; unseeded, one
    # real seed measured 8.45 km on one run and 8.12 on the next.
    slick = next(s for s in _authored() if s["id"] == "kutch-dark")
    assert measure(_outline(slick)) == measure(_outline(slick))


def test_length_does_not_hang_on_the_skeleton_tie_break(monkeypatch):
    # kutch-dark measured 4.72 km per part on nine tie-break orders and 5.61 on
    # one, when a corner branch lost its junction and the tip ran back across
    # the slick. The end trim and the outward-only extension hold it.
    import skimage.morphology

    original = skimage.morphology.medial_axis
    slick = next(s for s in _authored() if s["id"] == "kutch-dark")
    lengths = []
    for seed in range(10):
        monkeypatch.setattr(
            skimage.morphology, "medial_axis",
            lambda image, mask=None, return_distance=False, *, rng=None, _s=seed: original(
                image, mask, return_distance, rng=_s),
        )
        lengths.append(measure(_outline(slick)).length_km)
    assert max(lengths) - min(lengths) < 0.01 * min(lengths)
