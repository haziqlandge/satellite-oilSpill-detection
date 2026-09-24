"""Seeding an ensemble over the detected slick, not at a point.

The real runs were seeded as a 500 m disc at the slick's centre, so a 9 km
discharge streak started life as a blob and the view's T0 showed a point
where the satellite showed a shape. Every member now starts from the same
positions spread uniformly over the polygon.
"""

from __future__ import annotations

import logging
import warnings
from datetime import datetime

import numpy as np
import pytest
from shapely import contains_xy
from shapely.geometry import Polygon

from backend.drift.seeding import SeedingError, points_in_polygon

# A thin streak off the Mississippi delta, about 10 km by 0.3 km, on a diagonal.
LON, LAT = -89.0, 29.2
_KX, _KY = 97.1, 110.9  # km per degree at 29.2 N


def _streak(length_km: float = 10.0, width_km: float = 0.3) -> Polygon:
    ax, ay = length_km / 2 / np.sqrt(2), length_km / 2 / np.sqrt(2)
    wx, wy = -width_km / 2 / np.sqrt(2), width_km / 2 / np.sqrt(2)
    corners = [(-ax + wx, -ay + wy), (ax + wx, ay + wy), (ax - wx, ay - wy), (-ax - wx, -ay - wy)]
    return Polygon([(LON + x / _KX, LAT + y / _KY) for x, y in corners])


def test_every_seed_is_inside_and_the_count_is_exact() -> None:
    lons, lats = points_in_polygon(_streak(), 500, seed=0)

    assert lons.shape == lats.shape == (500,)
    assert contains_xy(_streak(), lons, lats).all()


def test_seeds_are_reproducible_and_depend_on_the_seed() -> None:
    a = points_in_polygon(_streak(), 50, seed=3)
    b = points_in_polygon(_streak(), 50, seed=3)
    c = points_in_polygon(_streak(), 50, seed=4)

    assert np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1])
    assert not np.array_equal(a[0], c[0])


def test_seeds_cover_the_slick_rather_than_its_centre() -> None:
    # Along the streak's axis the seeds must reach close to both ends. A 500 m
    # disc at the centre -- what the runs used to seed -- spans 1 km.
    lons, lats = points_in_polygon(_streak(), 400, seed=0)
    along = ((lons - LON) * _KX + (lats - LAT) * _KY) / np.sqrt(2)

    assert along.max() - along.min() > 9.0


def test_a_polygon_with_no_area_is_refused() -> None:
    flat = Polygon([(LON, LAT), (LON + 0.01, LAT), (LON + 0.02, LAT)])

    with pytest.raises(SeedingError):
        points_in_polygon(flat, 10)


@pytest.mark.slow
def test_every_member_starts_on_the_same_polygon_seeds() -> None:
    pytest.importorskip("opendrift")
    warnings.filterwarnings("ignore")
    logging.disable(logging.WARNING)
    from backend.drift.ensemble import MIN_MEMBERS, run_ensemble
    from backend.drift.opendrift_runner import Forcing

    lons, lats = points_in_polygon(_streak(), 30, seed=0)
    result = run_ensemble(
        lon=lons, lat=lats, start=datetime(2023, 12, 5, 0, 2), hours=2, backward=True,
        members=MIN_MEMBERS, particles=lons.size, radius_m=0.0,
        forcing=Forcing(u_current=0.1), time_step_s=1800,
    )

    first = result.lon_history[0].reshape(MIN_MEMBERS, lons.size)
    first_lat = result.lat_history[0].reshape(MIN_MEMBERS, lats.size)
    for member in range(MIN_MEMBERS):
        # OpenDrift stores the elements in its own order (reversed, measured),
        # which carries no meaning; the SET of starting positions is what must
        # match. float32 history: a seed survives to about 1e-5 degrees.
        got = sorted(zip(first[member].round(4), first_lat[member].round(4), strict=True))
        want = sorted(zip(lons.round(4), lats.round(4), strict=True))
        assert np.allclose(np.array(got), np.array(want), atol=2e-4)
