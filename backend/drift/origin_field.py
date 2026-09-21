"""Particle density to `P(lat, lon, t)` — the origin probability field (PHASE-04).

The phase's headline output and what PHASE-06 conditions AIS attribution on. A
backward ensemble produces a cloud of candidate release positions per timestep;
this turns that cloud into a normalised probability grid, and the grid into the
50% and 90% contours the API actually serves.

**Normalisation is per timestep, and it is a deliberate choice with a
consequence.** Each slice integrates to 1.0, so the field answers *"given the
slick was released at time t, where?"* — not *"when was it released?"*. Making
each slice a proper distribution is what lets `convergence.py` compare slices to
each other by concentration; if slices were normalised jointly, a diffuse early
slice would simply carry less mass and the comparison would measure the
normalisation rather than the physics.

**The field legitimately widens with backward time, and that must be reported,
never tuned away.** Diffusion is irreversible: running a diffusive process
backwards spreads the cloud. A narrow origin field at 48 h would be a bug or a
lie, not a success. `spread_km` exposes it, and `convergence.py` turns it into
`insufficient_evidence` past the point where the field can discriminate (C3).

**Highest-density contours, not level sets of the raw grid.** A "90% contour"
here means *the smallest region containing 90% of the probability mass*, found
by sorting cells by density and accumulating. Taking `P >= 0.1` instead would
give a region whose enclosed mass depends on the grid resolution — and would
silently change meaning when the resolution changed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np

# Grid resolution in degrees. ~1.1 km in latitude, which is finer than the
# forcing (CMEMS GLOBAL is 1/12 degree, ~9 km) and so does not pretend to more
# spatial information than the currents carry.
DEFAULT_RESOLUTION_DEG = 0.01

# Padding around the particle extent, so the cloud is not clipped at the edge of
# its own grid.
DEFAULT_PAD_DEG = 0.05

# The contours the API serves. PHASE-04 names both.
DEFAULT_LEVELS: tuple[float, ...] = (0.5, 0.9)

# Mean degrees-of-latitude to km. Longitude is scaled by cos(lat) at use.
_KM_PER_DEG_LAT = 111.19


class OriginFieldError(RuntimeError):
    """The origin field could not be built as specified."""


@dataclass(frozen=True, slots=True)
class OriginField:
    """`P(lat, lon, t)` on a regular grid, one normalised slice per timestep."""

    lons: np.ndarray  # (nx,) cell centres
    lats: np.ndarray  # (ny,)
    times: tuple[datetime, ...]  # (nt,) descending for a backward run
    probability: np.ndarray  # (nt, ny, nx), each slice summing to 1.0

    @property
    def shape(self) -> tuple[int, int, int]:
        return tuple(self.probability.shape)  # type: ignore[return-value]

    def slice_at(self, index: int) -> np.ndarray:
        return np.asarray(self.probability[index])

    def spread_km(self, index: int) -> float:
        """Probability-weighted RMS distance from the slice's own centroid.

        The honest measure of how much the field has smeared. It should *grow*
        with backward time; a run where it does not is a run whose diffusion is
        not doing anything.
        """

        weights = self.probability[index]
        total = weights.sum()
        if total <= 0:
            return float("nan")

        grid_lon, grid_lat = np.meshgrid(self.lons, self.lats)
        mean_lon = float((grid_lon * weights).sum() / total)
        mean_lat = float((grid_lat * weights).sum() / total)

        scale_lon = _KM_PER_DEG_LAT * np.cos(np.radians(mean_lat))
        dx = (grid_lon - mean_lon) * scale_lon
        dy = (grid_lat - mean_lat) * _KM_PER_DEG_LAT
        return float(np.sqrt(((dx**2 + dy**2) * weights).sum() / total))

    def contains(self, index: int, lon: float, lat: float, level: float = 0.9) -> bool:
        """Is `(lon, lat)` inside the `level` highest-density region?

        This is PHASE-04's backward hit-rate criterion: the 90% region must
        contain the true source for all three fixture cases.
        """

        mask = highest_density_mask(self.probability[index], level)
        x = int(np.argmin(np.abs(self.lons - lon)))
        y = int(np.argmin(np.abs(self.lats - lat)))
        if not (0 <= x < self.lons.size and 0 <= y < self.lats.size):
            return False
        return bool(mask[y, x])


def highest_density_mask(slice_: np.ndarray, level: float) -> np.ndarray:
    """The smallest set of cells holding at least `level` of the mass.

    Cells are ranked by density and accumulated until the level is reached, so
    the region's *meaning* is fixed regardless of grid resolution. A raw
    threshold on `P` would not be.
    """

    if not 0.0 < level <= 1.0:
        raise OriginFieldError(f"level must be in (0, 1], got {level}")

    flat = slice_.ravel()
    order = np.argsort(flat)[::-1]
    cumulative = np.cumsum(flat[order])
    total = cumulative[-1] if cumulative.size else 0.0
    if total <= 0:
        return np.zeros_like(slice_, dtype=bool)

    # searchsorted on the cumulative sum: the first index reaching the level.
    cut = int(np.searchsorted(cumulative, level * total)) + 1
    keep = np.zeros(flat.size, dtype=bool)
    keep[order[:cut]] = True
    return keep.reshape(slice_.shape)


def build_origin_field(
    lon_history: np.ndarray,
    lat_history: np.ndarray,
    times: tuple[datetime, ...],
    *,
    resolution_deg: float = DEFAULT_RESOLUTION_DEG,
    pad_deg: float = DEFAULT_PAD_DEG,
) -> OriginField:
    """Bin particle positions per timestep into a normalised probability grid.

    `lon_history` / `lat_history` are `(timestep, particle)` as
    `opendrift_runner.run_drift` returns them — stacked across ensemble members
    on the particle axis, since an ensemble is what makes this a probability
    rather than a trajectory (C5).

    NaNs (deactivated particles) are dropped per timestep rather than filled, so
    a stranded or seeded-out particle does not pull mass to an arbitrary place.
    """

    if lon_history.shape != lat_history.shape:
        raise OriginFieldError(
            f"lon/lat history shapes differ: {lon_history.shape} vs {lat_history.shape}"
        )
    if lon_history.ndim != 2:
        raise OriginFieldError(f"expected (timestep, particle), got {lon_history.shape}")
    if lon_history.shape[0] != len(times):
        raise OriginFieldError(
            f"{lon_history.shape[0]} history rows against {len(times)} times"
        )
    if resolution_deg <= 0:
        raise OriginFieldError(f"resolution must be positive, got {resolution_deg}")

    finite = np.isfinite(lon_history) & np.isfinite(lat_history)
    if not finite.any():
        raise OriginFieldError("no finite particle positions in the history")

    lon_min = float(np.nanmin(lon_history[finite])) - pad_deg
    lon_max = float(np.nanmax(lon_history[finite])) + pad_deg
    lat_min = float(np.nanmin(lat_history[finite])) - pad_deg
    lat_max = float(np.nanmax(lat_history[finite])) + pad_deg

    lon_edges = np.arange(lon_min, lon_max + resolution_deg, resolution_deg)
    lat_edges = np.arange(lat_min, lat_max + resolution_deg, resolution_deg)
    if lon_edges.size < 2 or lat_edges.size < 2:
        raise OriginFieldError("particle extent is smaller than one grid cell")

    slices = np.zeros((len(times), lat_edges.size - 1, lon_edges.size - 1), dtype=float)
    for step in range(len(times)):
        usable = finite[step]
        if not usable.any():
            continue
        counts, _, _ = np.histogram2d(
            lat_history[step][usable],
            lon_history[step][usable],
            bins=[lat_edges, lon_edges],
        )
        total = counts.sum()
        if total > 0:
            slices[step] = counts / total  # per-timestep normalisation

    centres = lambda edges: (edges[:-1] + edges[1:]) / 2.0  # noqa: E731
    return OriginField(
        lons=centres(lon_edges),
        lats=centres(lat_edges),
        times=tuple(times),
        probability=slices,
    )


def contour_geojson(
    field: OriginField, index: int, levels: tuple[float, ...] = DEFAULT_LEVELS
) -> dict:
    """The `level` regions of one timestep as a GeoJSON FeatureCollection.

    The API serves contours, never the grid: an origin field is large and a map
    client needs polygons. Emitted as cell boxes rather than smoothed isolines
    so the geometry cannot imply more spatial precision than the grid holds.
    """

    features = []
    resolution = float(field.lons[1] - field.lons[0]) if field.lons.size > 1 else 0.01
    half = resolution / 2.0

    for level in levels:
        mask = highest_density_mask(field.probability[index], level)
        ys, xs = np.nonzero(mask)
        boxes = []
        for y, x in zip(ys, xs, strict=True):
            west, east = float(field.lons[x]) - half, float(field.lons[x]) + half
            south, north = float(field.lats[y]) - half, float(field.lats[y]) + half
            boxes.append(
                [[west, south], [east, south], [east, north], [west, north], [west, south]]
            )
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "level": level,
                    "time": field.times[index].isoformat(),
                    "cells": len(boxes),
                    "spread_km": round(field.spread_km(index), 3),
                },
                "geometry": {"type": "MultiPolygon", "coordinates": [[box] for box in boxes]},
            }
        )

    return {"type": "FeatureCollection", "features": features}
