"""Which detection a drift run starts from: the seed rule.

Moved here from `scripts/export_drift_runs.py` when the live pipeline
(`backend/pipeline`) became its second user; the script re-exports every name,
so the rule is one piece of code whichever path runs it.

A traced slick's outline follows the pixel grid in short steps. It runs
straight along a row or a column for a kilometre only where something cut it:
YOLO-seg crops every mask to its predicted box, so a mask that filled its box
-- the model found dark water but no edge to it -- ends in straight,
axis-aligned sides. Over the three Gulf scenes 90% of detections have no
straight run longer than ~60 px (~0.6 km); the filled boxes run 380-959 px.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import numpy as np

EARTH_KM_PER_DEG_LAT = 110.574

FRAME_EDGE_KM = 1.2
# At sea on OpenDrift's own coastline (GSHHG): a seed ashore is not a seed, and
# OpenDrift has to move its particles off land before it can start.
MAX_LAND_FRACTION = 0.1
# Big enough to characterise: about 500 Sentinel-1 pixels, a 50 m x 1 km streak.
# Added 2026-09-24 when the live pipeline, on a coastal window whose one
# detection was a filled box, fell through to a single pixel at sea. The three
# exported seeds are 3.2-6.7 km2 and do not move.
MIN_SEED_KM2 = 0.05

SEED_RULE = (
    "the largest detection at sea (GSHHG: centre offshore, at most "
    f"{MAX_LAND_FRACTION:.0%} of it on land) whose outline never runs straight along the "
    f"pixel grid for {FRAME_EDGE_KM} km or more -- an edge that straight is the model's "
    f"box, not a slick's edge -- and that covers at least {MIN_SEED_KM2} km2"
)


class NoSeedError(RuntimeError):
    """No detection meets the seed rule. A result to report, never a fallback."""


def km_per_deg_lon(lat: float) -> float:
    return 111.320 * math.cos(math.radians(lat))


@dataclass(frozen=True, slots=True)
class Seed:
    """The detection a backward run starts from, and what was passed over for it."""

    centre: tuple[float, float]
    feature: int
    part: int
    area_km2: float
    confidence: float
    straight_edge_km: float
    land_fraction: float
    frame_cut: int
    ashore: int
    candidates: int
    #: Parts under `MIN_SEED_KM2`; a seed exists only when a larger part qualified,
    #: so this is how many smaller parts were never considered.
    small: int = 0

    def as_dict(self) -> dict[str, Any]:
        return dict(
            rule=SEED_RULE,
            areaKm2=round(self.area_km2, 3),
            confidence=round(self.confidence, 4),
            straightEdgeKm=round(self.straight_edge_km, 3),
            landFraction=round(self.land_fraction, 3),
            passedOver=dict(frameCut=self.frame_cut, ashore=self.ashore, tooSmall=self.small),
            of=self.candidates,
        )


def polygon_parts(document: dict[str, Any]) -> list[tuple[int, int, Any, float]]:
    """(feature, part, polygon, confidence) for every polygon in a detection file."""
    from shapely.geometry import shape

    parts = []
    for fi, feature in enumerate(document.get("features", [])):
        geometry = shape(feature["geometry"])
        polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
        confidence = float(feature.get("properties", {}).get("confidence", 0.0))
        for pi, polygon in enumerate(polygons):
            parts.append((fi, pi, polygon, confidence))
    return parts


def straight_edge_km(polygon: Any) -> float:
    """The longest run of any ring along one pixel row or column, in km."""
    best = 0.0
    for ring in [polygon.exterior, *polygon.interiors]:
        coords = list(ring.coords)
        run = 0.0
        line: tuple[str, float] | None = None
        for (x0, y0), (x1, y1) in pairwise(coords):
            if y0 == y1 and x0 != x1:
                here = ("row", y0)
                length = abs(x1 - x0) * km_per_deg_lon(y0)
            elif x0 == x1 and y0 != y1:
                here = ("col", x0)
                length = abs(y1 - y0) * EARTH_KM_PER_DEG_LAT
            else:
                run, line = 0.0, None
                continue
            # Consecutive edges on the same row or column are one straight run.
            run = run + length if here == line else length
            line = here
            best = max(best, run)
    return best


def land_fraction(polygon: Any, landmask: Any) -> float:
    """Share of the polygon on GSHHG land, sampled on a grid over its extent."""
    from shapely import contains_xy

    west, south, east, north = polygon.bounds
    grid_x, grid_y = np.meshgrid(np.linspace(west, east, 30), np.linspace(south, north, 30))
    xs, ys = grid_x.ravel(), grid_y.ravel()
    inside = contains_xy(polygon, xs, ys)
    if inside.sum() < 5:
        point = polygon.representative_point()
        return float(landmask.contains(point.x, point.y))
    return float(np.mean(landmask.contains_many(xs[inside], ys[inside])))


def choose_seed_in(document: dict[str, Any]) -> Seed:
    """The detection to hindcast: see `SEED_RULE`.

    This used to be "the ring with the biggest bounding box". In every processed
    Gulf scene that was a box the model had filled -- whole tiles of sheltered
    or wind-calmed water, and in December an inland water body (ISSUES Q5). A
    bounding box rewards exactly that shape. The rule is fixed before any run,
    and nothing is ranked from these fields, so it cannot be steering an answer.
    """
    from roaring_landmask import RoaringLandmask

    landmask = RoaringLandmask.new()
    parts = polygon_parts(document)
    frame_cut = ashore = 0
    ordered = sorted(parts, key=lambda p: -p[2].area)
    for rank, (fi, pi, polygon, confidence) in enumerate(ordered):
        centroid = polygon.centroid
        area = polygon.area * km_per_deg_lon(centroid.y) * EARTH_KM_PER_DEG_LAT
        if area < MIN_SEED_KM2:
            # Sorted by area: everything from here on is smaller still.
            raise NoSeedError(
                f"no detection meets the seed rule ({frame_cut} box-cut, {ashore} ashore, "
                f"{len(ordered) - rank} under {MIN_SEED_KM2} km2, of {len(parts)})"
            )
        edge = straight_edge_km(polygon)
        if edge >= FRAME_EDGE_KM:
            frame_cut += 1
            continue
        centre = centroid if polygon.contains(centroid) else polygon.representative_point()
        share = land_fraction(polygon, landmask)
        if landmask.contains(centre.x, centre.y) or share > MAX_LAND_FRACTION:
            ashore += 1
            continue
        area = polygon.area * km_per_deg_lon(centre.y) * EARTH_KM_PER_DEG_LAT
        return Seed(
            centre=(float(centre.x), float(centre.y)),
            feature=fi, part=pi, area_km2=area, confidence=confidence,
            straight_edge_km=edge, land_fraction=share,
            frame_cut=frame_cut, ashore=ashore, candidates=len(parts),
            small=sum(1 for p in ordered[rank + 1:] if p[2].area * km_per_deg_lon(p[2].centroid.y)
                      * EARTH_KM_PER_DEG_LAT < MIN_SEED_KM2),
        )
    raise NoSeedError(
        f"no detection meets the seed rule ({frame_cut} box-cut, {ashore} ashore, of {len(parts)})"
    )


def seed_polygon_in(document: dict[str, Any], seed: Seed) -> Any:
    """The seed detection's own polygon, which the parcels are spread over."""
    for fi, pi, polygon, _ in polygon_parts(document):
        if (fi, pi) == (seed.feature, seed.part):
            return polygon
    raise NoSeedError(f"the seed polygon {seed.feature}/{seed.part} is missing")


def detections_bbox(document: dict[str, Any]) -> tuple[tuple[float, float, float, float], int]:
    """Every ring's extent, and the feature count.

    The ERA5 request is made for this box and its cache is keyed on it, so it
    stays exactly what the first real runs asked for, whichever detection seeds.
    """
    features = document.get("features", [])
    if not features:
        raise NoSeedError("no polygons to seed from")
    west = south = math.inf
    east = north = -math.inf
    for feature in features:
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        rings = coordinates if geometry["type"] == "Polygon" else [r for p in coordinates for r in p]
        for ring in rings:
            xs = [c[0] for c in ring]
            ys = [c[1] for c in ring]
            west, east = min(west, *xs), max(east, *xs)
            south, north = min(south, *ys), max(north, *ys)
    return (west, south, east, north), len(features)
