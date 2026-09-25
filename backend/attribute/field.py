"""How far a position agrees with the origin field at one hour (PHASE-06, `S_drift`'s input).

The Python twin of the console's `fieldAgreement` (`frontDemo/src/sim/drift.ts`)
and the grid helpers it reads (`sim/field.ts`: `sampleDensity`, `massTable`,
`massForLevel`). `tests/test_attribution.py` holds it to them on fixtures the
console exported (`npm run export:scoring-fixtures`).

Agreement is the product of two parts, both in [0, 1]:

  * **centrality** -- one minus the smallest credible region containing the
    position's density: 1 at the mode, 0 out in the skirt;
  * **informativeness** -- `sqrt(25 km2 / area90)`, capped at 1: a track at the
    mode of a 400 km2 cloud has coincided with almost nothing.

`frames_from_origin_field` puts the backend's own `OriginField`
(`backend/drift/origin_field.py`) into the same form, so the live pipeline and
the console answer the same question the same way.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np

#: Area of a 90% contour that still constrains an origin, km2 (`INFORMATIVE_AREA_KM2`).
INFORMATIVE_AREA_KM2 = 25.0

#: Quantiles kept per frame (`TABLE_STEPS` in `sim/field.ts`).
TABLE_STEPS = 256

_KM_PER_DEG_LAT = 111.19  # as backend/drift/origin_field.py


@dataclass(slots=True)
class FieldFrame:
    """One hour of the origin field: a density grid and its mass table.

    `values` is row-major, `ny` rows of `nx`, row 0 at `min_lat`. Densities are
    cell values divided by `cell_area_km2`, so frames of different extent
    compare. `levels` descend; `mass[i]` is the share of total mass on cells at
    or above `levels[i]`.
    """

    values: np.ndarray
    nx: int
    ny: int
    min_lon: float
    min_lat: float
    d_lon: float
    d_lat: float
    cell_area_km2: float
    area90_km2: float
    levels: np.ndarray
    mass: np.ndarray


def mass_table(values: np.ndarray, cell_area_km2: float) -> tuple[np.ndarray, np.ndarray, float]:
    """(levels, mass, peak) -- `massTable`, step for step.

    256 quantiles of the descending cell values rather than the whole sorted
    grid; the interpolation error is far below anything the interface prints.
    """
    ordered = np.sort(np.asarray(values, dtype=np.float64))[::-1]
    levels = np.zeros(TABLE_STEPS)
    mass = np.zeros(TABLE_STEPS)
    cumulative = np.cumsum(ordered)
    total = float(cumulative[-1]) if len(cumulative) else 0.0
    if total <= 0:
        return levels, mass, 0.0
    stride = len(ordered) / TABLE_STEPS
    filled = 0
    for i in range(len(ordered)):
        if filled >= TABLE_STEPS:
            break
        if i >= filled * stride:
            levels[filled] = ordered[i] / cell_area_km2
            mass[filled] = cumulative[i] / total
            filled += 1
    levels[filled:] = 0.0
    mass[filled:] = 1.0
    return levels, mass, float(ordered[0] / cell_area_km2)


def sample_density(frame: FieldFrame, lon: float, lat: float) -> float:
    """Bilinear sample, particles (or probability) per km2; 0 off the grid."""
    gx = (lon - frame.min_lon) / frame.d_lon
    gy = (lat - frame.min_lat) / frame.d_lat
    x0 = math.floor(gx)
    y0 = math.floor(gy)
    if x0 < 0 or y0 < 0 or x0 + 1 >= frame.nx or y0 + 1 >= frame.ny:
        return 0.0
    fx = gx - x0
    fy = gy - y0
    v = frame.values
    nx = frame.nx
    value = (
        v[y0 * nx + x0] * (1 - fx) * (1 - fy)
        + v[y0 * nx + x0 + 1] * fx * (1 - fy)
        + v[(y0 + 1) * nx + x0] * (1 - fx) * fy
        + v[(y0 + 1) * nx + x0 + 1] * fx * fy
    )
    return float(value / frame.cell_area_km2)


def mass_for_level(frame: FieldFrame, density: float) -> float:
    """The smallest credible region holding `density`, as a mass fraction."""
    if density <= 0:
        return 1.0
    # levels descend, so -levels ascend: the first level at or below `density`.
    i = int(np.searchsorted(-frame.levels, -density, side="left"))
    return float(frame.mass[i]) if i < len(frame.levels) else 1.0


def field_agreement(frames: dict[int, FieldFrame], hour: int, lon: float, lat: float) -> dict[str, float]:
    """`fieldAgreement`: centrality, informativeness, their product, the region and its area."""
    frame = frames.get(hour)
    if frame is None:
        return {"centrality": 0.0, "informativeness": 0.0, "value": 0.0, "credibleRegionPct": 100.0,
                "area90Km2": 0.0}
    mass = mass_for_level(frame, sample_density(frame, lon, lat))
    centrality = 1 - mass
    informativeness = min(1.0, math.sqrt(INFORMATIVE_AREA_KM2 / max(1e-6, frame.area90_km2)))
    return {
        "centrality": centrality,
        "informativeness": informativeness,
        "value": centrality * informativeness,
        "credibleRegionPct": mass * 100,
        "area90Km2": frame.area90_km2,
    }


def frames_from_origin_field(field: Any, acquired: datetime) -> dict[int, FieldFrame]:
    """The backend's `OriginField` as hourly `FieldFrame`s keyed by hours from `acquired`.

    Each slice is a probability per cell; divided by its cell's area it is a
    density per km2, which is what the table and the sampler read. Cell area is
    taken at the grid's middle latitude, as the console does for its own grids.
    A backward run's `times` descend (CLAUDE.md section 8); the key is the
    signed hour, so order does not matter here. Times compare as naive UTC (X10).

    ponytail: the slices are raw particle histograms; the console blurs its own
    fields before sampling. Smooth here if a current-forced run shows speckle.
    """
    from backend.drift.opendrift_runner import naive_utc

    acquired = naive_utc(acquired)
    lons = np.asarray(field.lons, dtype=np.float64)
    lats = np.asarray(field.lats, dtype=np.float64)
    d_lon = float(lons[1] - lons[0])
    d_lat = float(lats[1] - lats[0])
    mid = float(lats[len(lats) // 2])
    cell_area = (d_lon * _KM_PER_DEG_LAT * math.cos(math.radians(mid))) * (d_lat * _KM_PER_DEG_LAT)
    frames: dict[int, FieldFrame] = {}
    for index, when in enumerate(field.times):
        hour = math.floor((naive_utc(when) - acquired).total_seconds() / 3600 + 0.5)
        values = np.asarray(field.probability[index], dtype=np.float64).ravel()
        if not np.isfinite(values).all() or values.sum() <= 0:
            continue
        levels, mass, _ = mass_table(values, cell_area)
        ordered = np.sort(values)[::-1]
        cells90 = int(np.searchsorted(np.cumsum(ordered), 0.9 * ordered.sum(), side="left")) + 1
        frames[hour] = FieldFrame(
            values=values, nx=len(lons), ny=len(lats),
            # Cell centres to the grid's corner convention: `sample_density` puts
            # value i at min + i * step exactly, as the console's grids do.
            min_lon=float(lons[0]), min_lat=float(lats[0]), d_lon=d_lon, d_lat=d_lat,
            cell_area_km2=cell_area, area90_km2=cells90 * cell_area, levels=levels, mass=mass,
        )
    return frames
