"""Slick geometry measured from a detected outline (PHASE-03).

The problem statement asks for "geometric properties"; the drift ensemble
seeds over the footprint, and the attribution scorer needs the END points,
because Cerulean's lesson is that WHERE along a slick you look for a source
matters more than how you weight distance. This module turns one detection's
outline into those numbers.

**Measured in metres, never in degrees.** Every part is projected to a Lambert
azimuthal equal-area plane centred on the detection, so an area is an area at
any latitude (a degree of longitude is half as wide at 60N as at the equator).
Area and perimeter come from the exact polygon; the axis comes from a raster of
it, because a medial axis is a raster operation.

**The axis.** `skimage.morphology.medial_axis` on a raster fine enough to put
about `PIXELS_ACROSS` pixels across the slick's typical width. Its longest path
is the centreline. A raw skeleton also runs into every corner of the outline
and down every ripple of a ragged edge, so it is thinned to one pixel and then
pruned: every end branch shorter than `SPUR_FACTOR` times the half-width at its
junction is removed, all at once, until none is left (a rectangle's corner
branches are 1.4 half-widths long). Each end of the longest remaining path is
then carried on to the outline, aimed at the middle of its end cap. Those two exit points
are the ends: the perimeter points at the extremes of the medial axis, which is
Cerulean's head/tail construction. The pixel path is simplified with a
tolerance of 1.5 pixels before it is measured, because an 8-connected staircase
overstates a line at 22.5 degrees by 8%.

**Holes are filled for the axis and the widths, kept for the area.** A hole in
a slick does not make it narrower, and it would put a loop in the skeleton.

**Which end is the head is not a geometric fact** (PHASE-03). Both are
returned. They are ORDERED so the narrower end comes first, because oil spreads
with time and the narrower end is the fresher one on a discharge trail
(`RESEARCH/topics/slick-age-estimation.md`) -- a labelling convention only.
`head_tail_resolved_by` stays "ambiguous" until the drift field resolves it.

**Several parts are one slick in pieces.** Each part is measured on its own,
the parts are chained along the detection's principal direction, and the
length includes the gaps (reported separately as `gap_km`): a ribbon that wind
has broken is still as long as it was.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import numpy as np

LonLat = tuple[float, float]

# Width stations along the axis, head to tail.
DEFAULT_STATIONS = 32
# Raster resolution: this many pixels across the slick's typical width...
PIXELS_ACROSS = 24
# ...but never more than this many pixels along its longest side.
MAX_GRID_PX = 4000
# An end branch shorter than this many local half-widths is a corner of the
# outline, not a limb of the slick.
SPUR_FACTOR = 2.0
# Douglas-Peucker tolerance for the pixel path, in pixels.
SIMPLIFY_PX = 1.5
# Edge ripples smaller than this fraction of the typical width are smoothed
# away before the axis is traced (never before area or widths are measured).
SMOOTH_FRACTION = 0.25


class GeometryError(ValueError):
    """The outline cannot be measured."""


@dataclass(frozen=True, slots=True)
class SlickGeometry:
    """What PHASE-03 asks of a detection's shape (`INTERFACES.md` §2)."""

    area_km2: float
    perimeter_km: float
    #: Along the medial axis, end to end, gaps between parts included.
    length_km: float
    gap_km: float
    width_m_mean: float
    #: Perpendicular chords along the axis, from `head` to `tail`.
    width_m_profile: tuple[float, ...]
    #: Bearing from `head` to `tail`, degrees clockwise from north.
    orientation_deg: float
    elongation: float
    #: 4 pi A / P^2: 1 for a disc, toward 0 for a thin ribbon.
    compactness: float
    #: 1 - area / convex-hull area.
    hull_deficiency: float
    fragmentation: int
    medial_axis: tuple[LonLat, ...]
    #: The narrower end (see the module docstring: a convention, not a finding).
    head: LonLat
    tail: LonLat
    head_tail_resolved_by: str
    resolution_m: float


@dataclass(frozen=True, slots=True)
class _Part:
    polygon: Any  # projected, metres, holes kept
    solid: Any  # projected, holes filled
    line: np.ndarray  # (n, 2) metres, end to end
    resolution_m: float

    @property
    def length_m(self) -> float:
        return float(np.hypot(*np.diff(self.line, axis=0).T).sum())


def local_projection(lon: float, lat: float) -> tuple[Callable[..., Any], Callable[..., Any]]:
    """(forward, inverse) between lon/lat and an equal-area plane centred here, in metres."""

    from pyproj import Transformer

    crs = f"+proj=laea +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs"
    forward = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    inverse = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    return forward.transform, inverse.transform


def _polygons(outline: Any) -> list[Any]:
    from shapely import make_valid

    if outline is None or outline.is_empty:
        raise GeometryError("the outline is empty")
    if not outline.is_valid:
        outline = make_valid(outline)
    if outline.geom_type == "Polygon":
        found = [outline]
    elif hasattr(outline, "geoms"):
        found = [g for g in outline.geoms if g.geom_type == "Polygon"]
        for g in outline.geoms:
            if g.geom_type == "MultiPolygon":
                found.extend(g.geoms)
    else:
        found = []
    found = [p for p in found if not p.is_empty and p.area > 0]
    if not found:
        raise GeometryError(f"no polygon with area in a {outline.geom_type}")
    return found


def _prune(graph: Any, rows: np.ndarray, cols: np.ndarray, distance: np.ndarray) -> np.ndarray:
    """Which skeleton nodes survive spur pruning (a boolean mask over the nodes).

    Every end branch -- endpoint to the first junction -- shorter than
    SPUR_FACTOR half-widths at its junction is removed, ALL AT ONCE per pass,
    until nothing changes. Simultaneous matters: removing a rectangle's two
    corner branches one at a time would leave the second one joined to the
    axis, and the axis would end in a corner. Pruning only the longest path's
    own ends is not enough either: a side branch elsewhere could capture the
    path (kutch-dark, measured: 4.72 km on nine tie-break seeds, 5.61 on one).
    """

    n = rows.size
    neighbours = [set(graph.indices[graph.indptr[k]:graph.indptr[k + 1]].tolist()) for k in range(n)]
    alive = np.ones(n, dtype=bool)
    for _ in range(12):
        removal: set[int] = set()
        for e in np.nonzero(alive)[0].tolist():
            if len(neighbours[e]) != 1:
                continue
            branch = [e]
            length = 0.0
            previous, current = e, next(iter(neighbours[e]))
            junction = None
            while True:
                length += math.hypot(rows[current] - rows[previous], cols[current] - cols[previous])
                degree = len(neighbours[current])
                if degree >= 3:
                    junction = current
                    break
                if degree <= 1:
                    break  # an isolated line: nothing to prune it back to
                branch.append(current)
                previous, current = current, next(x for x in neighbours[current] if x != previous)
            if junction is not None and length < SPUR_FACTOR * max(float(distance[rows[junction], cols[junction]]), 1.0):
                removal.update(branch)
        if not removal:
            break
        for v in removal:
            for u in neighbours[v]:
                neighbours[u].discard(v)
            neighbours[v] = set()
            alive[v] = False
    return alive


def _skeleton_path(skeleton: np.ndarray, distance: np.ndarray) -> np.ndarray:
    """The longest path through the pruned skeleton, as (row, col)."""

    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components, dijkstra
    from skimage.morphology import thin

    # One pixel wide: medial_axis leaves pixel triangles that read as junctions.
    skeleton = thin(skeleton)
    rows, cols = np.nonzero(skeleton)
    n = rows.size
    if n < 2:
        return np.column_stack([rows, cols]).astype(float)
    height, width = skeleton.shape
    index = np.full(skeleton.shape, -1, dtype=np.int64)
    index[rows, cols] = np.arange(n)
    src: list[np.ndarray] = []
    dst: list[np.ndarray] = []
    weight: list[np.ndarray] = []
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        r2, c2 = rows + dr, cols + dc
        ok = (r2 >= 0) & (r2 < height) & (c2 >= 0) & (c2 < width)
        other = np.full(n, -1, dtype=np.int64)
        other[ok] = index[r2[ok], c2[ok]]
        linked = other >= 0
        src.append(np.nonzero(linked)[0])
        dst.append(other[linked])
        weight.append(np.full(int(linked.sum()), math.hypot(dr, dc)))
    a = np.concatenate(src)
    b = np.concatenate(dst)
    w = np.concatenate(weight)
    graph = coo_matrix((np.concatenate([w, w]), (np.concatenate([a, b]), np.concatenate([b, a]))), shape=(n, n)).tocsr()

    keep = _prune(graph, rows, cols, distance)
    if keep.sum() < 2:
        # Everything was a spur of everything else: a compact blob with no axis.
        return np.empty((0, 2))
    graph = graph[keep][:, keep]
    rows, cols = rows[keep], cols[keep]

    _, labels = connected_components(graph, directed=False)
    biggest = np.bincount(labels).argmax()
    start = int(np.nonzero(labels == biggest)[0][0])
    # Tree diameter by double sweep: farthest from anywhere, then farthest from that.
    reach = dijkstra(graph, directed=False, indices=start)
    reach[~np.isfinite(reach)] = -1
    first = int(reach.argmax())
    reach, previous = dijkstra(graph, directed=False, indices=first, return_predecessors=True)
    reach[~np.isfinite(reach)] = -1
    last = int(reach.argmax())
    path = [last]
    while path[-1] != first:
        path.append(int(previous[path[-1]]))
    nodes = np.asarray(path[::-1])
    return np.column_stack([rows[nodes], cols[nodes]]).astype(float)


def _trim_ends(path: np.ndarray, distance: np.ndarray) -> np.ndarray:
    """Cut each end back to the first point at least SPUR_FACTOR half-widths along the path from it.

    A corner branch runs from the axis into a corner of a flat end, losing
    0.7 of a half-width of clearance per unit of length, so it is always
    shorter than twice the half-width it starts from; a straight axis loses
    none. Cutting there removes a corner branch whether or not the skeleton
    kept the junction it hangs from (medial_axis's tie-break sometimes drops
    the opposite corner branch, and then pruning has nothing to cut back to).
    The tip is restored by the extension to the outline that follows.
    """

    if len(path) < 3:
        return path
    arc = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(path, axis=0).T))])
    half = distance[path[:, 0].astype(int), path[:, 1].astype(int)]
    from_start = np.nonzero(arc >= SPUR_FACTOR * half)[0]
    from_end = np.nonzero(arc[-1] - arc >= SPUR_FACTOR * half)[0]
    if from_start.size == 0 or from_end.size == 0 or from_end[-1] <= from_start[0]:
        # Nothing is far enough from both ends: a compact blob, with no axis to speak of.
        return np.empty((0, 2))
    return path[from_start[0]:from_end[-1] + 1]


def _tip(solid: Any, end: np.ndarray, towards: np.ndarray, reach_m: float) -> np.ndarray:
    """Where a ray from `end` along `towards` first leaves the outline."""

    from shapely.geometry import LineString, Point

    point = Point(float(end[0]), float(end[1]))
    if not solid.covers(point):
        nearest = solid.exterior.interpolate(solid.exterior.project(point))
        return np.array([nearest.x, nearest.y])
    ray = LineString([tuple(end), tuple(end + towards * reach_m)])
    crossing = ray.intersection(solid.exterior)
    if crossing.is_empty:
        return end
    points = [crossing] if crossing.geom_type == "Point" else [g for g in getattr(crossing, "geoms", []) if g.geom_type == "Point"]
    if not points:
        # A ray running along an edge: its first coordinate is the exit.
        coords = np.asarray(crossing.coords if hasattr(crossing, "coords") else [], dtype=float)
        if coords.size == 0:
            return end
        points = [Point(*c) for c in coords]
    best = min(points, key=lambda p: p.distance(point))
    return np.array([best.x, best.y])


def _fallback_line(solid: Any) -> np.ndarray:
    """A part too small to skeletonise: the long axis of its minimum rotated rectangle."""

    box = np.asarray(solid.minimum_rotated_rectangle.exterior.coords)[:4]
    sides = [np.hypot(*(box[(k + 1) % 4] - box[k])) for k in range(4)]
    k = int(np.argmin(sides[:2]))  # a short side; its opposite is k + 2
    a = (box[k] + box[(k + 1) % 4]) / 2
    b = (box[(k + 2) % 4] + box[(k + 3) % 4]) / 2
    return np.vstack([a, b])


def _measure_part(polygon: Any) -> _Part:
    from affine import Affine
    from rasterio.features import rasterize
    from shapely.geometry import LineString, Polygon
    from skimage.morphology import medial_axis

    solid = Polygon(polygon.exterior)
    typical_width = 2.0 * solid.area / max(solid.exterior.length, 1e-9)
    west, south, east, north = solid.bounds
    span = max(east - west, north - south)
    resolution = max(typical_width / PIXELS_ACROSS, span / MAX_GRID_PX, 1e-3)
    pad = 3
    columns = math.ceil((east - west) / resolution) + 2 * pad
    rows = math.ceil((north - south) / resolution) + 2 * pad
    origin_x = west - pad * resolution
    origin_y = north + pad * resolution
    transform = Affine(resolution, 0.0, origin_x, 0.0, -resolution, origin_y)
    # The axis is traced on a lightly smoothed outline (closed then opened at
    # SMOOTH_FRACTION of the typical width): every ripple of a ragged edge
    # otherwise grows a skeleton branch, and on a blobby real mask the longest
    # path then depends on pixel tie-breaks. Area, perimeter and the width
    # chords stay on the exact outline.
    smooth = SMOOTH_FRACTION * typical_width
    traced = solid.buffer(smooth).buffer(-2 * smooth).buffer(smooth) if smooth > 0 else solid
    if traced.is_empty or traced.area < 0.5 * solid.area:
        traced = solid
    mask = rasterize([traced], out_shape=(rows, columns), transform=transform, fill=0, default_value=1, dtype="uint8").astype(bool)

    line: np.ndarray
    if mask.sum() < 9:
        return _Part(polygon=polygon, solid=solid, line=_fallback_line(solid), resolution_m=resolution)
    # Seeded: medial_axis breaks ties in a random pixel order, and unseeded the
    # same ragged outline measured 8.45 km on one run and 8.12 on the next.
    skeleton, distance = medial_axis(mask, return_distance=True, rng=0)
    path = _trim_ends(_skeleton_path(skeleton, distance), distance)
    if len(path) < 2:
        return _Part(polygon=polygon, solid=solid, line=_fallback_line(solid), resolution_m=resolution)

    xy = np.column_stack([origin_x + (path[:, 1] + 0.5) * resolution, origin_y - (path[:, 0] + 0.5) * resolution])
    simple = LineString(xy).simplify(SIMPLIFY_PX * resolution, preserve_topology=False)
    coords = np.asarray(simple.coords, dtype=float)

    # Each end is carried on toward the middle of its END CAP: the pixels
    # nearer that end of the path than to any other part of it. On a
    # rectangle that is straight down the axis; on a curving, widening or
    # obliquely cut end it is the middle of the end, where the skeleton's own
    # last few pixels can point 20 degrees off (measured on mumbai-null).
    from scipy.spatial import cKDTree

    inside_rc = np.column_stack(np.nonzero(mask)).astype(float)
    nearest = cKDTree(path).query(inside_rc)[1]

    def unit(row: float, col: float) -> np.ndarray:
        vector = np.array([col, -row], dtype=float)
        norm = float(np.hypot(*vector))
        return vector / norm if norm > 0 else vector

    def direction(at_start: bool) -> np.ndarray:
        k = 0 if at_start else len(path) - 1
        # Outward along the path's own last stretch, a few half-widths long.
        span_px = max(3.0, 2.0 * float(distance[int(path[k][0]), int(path[k][1])]))
        steps = np.hypot(*np.diff(path, axis=0).T)
        arc = np.concatenate([[0.0], np.cumsum(steps)])
        if at_start:
            other = path[int(np.searchsorted(arc, min(span_px, arc[-1])))]
        else:
            other = path[int(np.searchsorted(arc, max(arc[-1] - span_px, 0.0)))]
        outward = unit(*(path[k] - other))
        cap = inside_rc[nearest == k]
        if len(cap) < 3:
            return outward
        toward_cap = unit(*(cap.mean(axis=0) - path[k]))
        # Never back into the slick: a cap more than 60 degrees off the axis
        # means the path ended somewhere odd, and the axis is the better guide.
        return toward_cap if float(np.dot(toward_cap, outward)) >= 0.5 else outward

    reach = 2.0 * span + 10.0 * resolution
    head = _tip(solid, coords[0], direction(True), reach)
    tail = _tip(solid, coords[-1], direction(False), reach)
    line = np.vstack([head, coords, tail])
    keep = np.concatenate([[True], np.hypot(*np.diff(line, axis=0).T) > 1e-9])
    return _Part(polygon=polygon, solid=solid, line=line[keep], resolution_m=resolution)


def _widths(part: _Part, stations: int) -> list[float]:
    """Perpendicular chords across the (hole-filled) part at evenly spaced stations."""

    from shapely.geometry import LineString, Point

    axis = LineString(part.line)
    length = axis.length
    if length <= 0 or stations < 1:
        return []
    west, south, east, north = part.solid.bounds
    reach = 2.0 * max(east - west, north - south) + 1.0
    half_step = max(2.0 * part.resolution_m, length / (2.0 * stations))
    out: list[float] = []
    for k in range(stations):
        s = (k + 0.5) / stations * length
        here = axis.interpolate(s)
        before = axis.interpolate(max(0.0, s - half_step))
        after = axis.interpolate(min(length, s + half_step))
        tx, ty = after.x - before.x, after.y - before.y
        norm = math.hypot(tx, ty)
        if norm == 0:
            continue
        nx, ny = -ty / norm, tx / norm
        chord = LineString([(here.x - nx * reach, here.y - ny * reach), (here.x + nx * reach, here.y + ny * reach)])
        cut = chord.intersection(part.solid)
        pieces = [cut] if cut.geom_type == "LineString" else [g for g in getattr(cut, "geoms", []) if g.geom_type == "LineString"]
        pieces = [p for p in pieces if not p.is_empty]
        if not pieces:
            continue
        station = Point(here.x, here.y)
        piece = min(pieces, key=lambda p: p.distance(station))
        if piece.distance(station) <= 1.5 * part.resolution_m:
            out.append(float(piece.length))
    return out


def measure(outline: Any, *, stations: int = DEFAULT_STATIONS) -> SlickGeometry:
    """Measure a detection's outline (a lon/lat Polygon or MultiPolygon)."""

    from shapely.geometry import MultiPolygon
    from shapely.ops import transform

    polygons = _polygons(outline)
    centre = MultiPolygon(polygons).centroid
    forward, inverse = local_projection(float(centre.x), float(centre.y))
    projected = [transform(forward, p) for p in polygons]
    parts = [_measure_part(p) for p in projected if p.area > 0]
    if not parts:
        raise GeometryError("nothing left to measure after projection")

    # Chain the parts along the detection's principal direction.
    if len(parts) > 1:
        points = np.vstack([np.asarray(p.solid.exterior.coords) for p in parts])
        _, _, basis = np.linalg.svd(points - points.mean(axis=0), full_matrices=False)
        principal = basis[0]
        parts.sort(key=lambda p: float(np.dot(np.asarray(p.solid.centroid.coords[0]), principal)))
        parts = [
            p if np.dot(p.line[-1] - p.line[0], principal) >= 0
            else _Part(polygon=p.polygon, solid=p.solid, line=p.line[::-1], resolution_m=p.resolution_m)
            for p in parts
        ]
    part_lengths = [p.length_m for p in parts]
    gaps = [float(np.hypot(*(b.line[0] - a.line[-1]))) for a, b in pairwise(parts)]
    total_axis = sum(part_lengths)
    per_part = [max(2, round(stations * length / total_axis)) if total_axis > 0 else 2 for length in part_lengths]
    profile: list[float] = []
    for part, count in zip(parts, per_part, strict=True):
        profile.extend(_widths(part, count))
    line = np.vstack([p.line for p in parts])

    area_m2 = float(sum(p.polygon.area for p in parts))
    perimeter_m = float(sum(p.polygon.length for p in parts))
    length_m = total_axis + sum(gaps)
    if not profile:
        profile = [area_m2 / max(length_m, 1e-9)]

    # Narrower end first: a convention (module docstring), never evidence.
    third = max(1, len(profile) // 3)
    if len(profile) >= 2 and float(np.mean(profile[:third])) > float(np.mean(profile[-third:])):
        profile = profile[::-1]
        line = line[::-1]

    width_mean = float(np.mean(profile))
    hull = MultiPolygon([p.polygon for p in parts]).convex_hull
    dx, dy = line[-1] - line[0]
    to_lonlat = [inverse(float(x), float(y)) for x, y in line]
    axis_lonlat = tuple((float(lon), float(lat)) for lon, lat in to_lonlat)
    return SlickGeometry(
        area_km2=area_m2 / 1e6,
        perimeter_km=perimeter_m / 1e3,
        length_km=length_m / 1e3,
        gap_km=sum(gaps) / 1e3,
        width_m_mean=width_mean,
        width_m_profile=tuple(float(w) for w in profile),
        orientation_deg=float(math.degrees(math.atan2(dx, dy)) % 360.0),
        elongation=length_m / max(width_mean, 1e-9),
        compactness=4.0 * math.pi * area_m2 / max(perimeter_m**2, 1e-9),
        hull_deficiency=max(0.0, 1.0 - area_m2 / max(float(hull.area), 1e-9)),
        fragmentation=len(parts),
        medial_axis=axis_lonlat,
        head=axis_lonlat[0],
        tail=axis_lonlat[-1],
        head_tail_resolved_by="ambiguous",
        resolution_m=max(p.resolution_m for p in parts),
    )
