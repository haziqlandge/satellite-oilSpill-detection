"""Where an ensemble's parcels start: spread over the detected slick.

A detection is a shape, and a drift run is a claim about where THAT oil was
and will be. Seeding it as a disc at the centroid throws the shape away: a
10 km discharge streak and a 1 km patch start as the same blob, and the
reconstruction's T0 shows a point where the satellite showed a slick.

So the positions are drawn uniformly over the polygon, once, and handed to
every member, which is also what the authored engine does ("every member
starts from the same mask"). Members then diverge only through their own
sampled parameters, which is the spread the ensemble exists to measure (C5).
Only the starting positions come from here; the motion, and the diffusion that
follows, stay OpenDrift's (C6).

Uniform in degrees is uniform in area to within the change of cos(latitude)
across the polygon -- under 0.1% for a slick tens of kilometres across.
"""

from __future__ import annotations

from typing import Any

import numpy as np


class SeedingError(ValueError):
    """The polygon cannot hold a seed."""


def points_in_polygon(polygon: Any, number: int, *, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """`number` positions drawn uniformly inside `polygon` (lon/lat), reproducibly.

    Rejection sampling over the bounding box: exact for any shape, holes
    included, and cheap for the aspect ratios slicks have.
    """

    from shapely import contains_xy

    if number < 1:
        raise SeedingError(f"number must be at least 1, got {number}")
    if polygon.is_empty or polygon.area <= 0:
        raise SeedingError("the polygon has no area to seed")
    west, south, east, north = polygon.bounds
    fill = polygon.area / max((east - west) * (north - south), 1e-30)
    rng = np.random.default_rng(seed)
    lons: list[np.ndarray] = []
    lats: list[np.ndarray] = []
    have = 0
    for _ in range(1000):
        draw = max(64, int(1.3 * (number - have) / fill))
        x = rng.uniform(west, east, draw)
        y = rng.uniform(south, north, draw)
        keep = contains_xy(polygon, x, y)
        lons.append(x[keep])
        lats.append(y[keep])
        have += int(keep.sum())
        if have >= number:
            break
    else:
        raise SeedingError("could not place the seeds inside the polygon")
    return np.concatenate(lons)[:number], np.concatenate(lats)[:number]
