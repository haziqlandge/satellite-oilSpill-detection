"""Wind and surface current on a coarse grid around a run: the console's arrows and flow cards.

The Python half of `frontDemo/src/sim/flow.ts`, which draws a few small arrows
on and around the event and a card each for wind, current and drift. Sampled
from the very files the drift ran on -- ERA5 before and after the pass, CMEMS
when the run had currents -- on GRID_NODES x GRID_NODES nodes over the box
every hour's 90% region and the seed fall in (padded as the console pads it),
at every hour the run plays.

Vectors are where the air or water goes, east and north, m/s. A current node on
land is None. With no current file `current` is None and the console simulates
one and labels it SIM; nothing here invents a value.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

GRID_NODES = 10
PAD_RATIO = 0.15
MIN_PAD_DEG = 0.02


def event_bbox(payload: dict[str, Any]) -> tuple[float, float, float, float]:
    """Every frame's 90% region and the seed, padded (`ringsBbox` in `sim/flow.ts`)."""
    xs = [float(payload["seed"][0])]
    ys = [float(payload["seed"][1])]
    for frame in payload["frames"]:
        for ring in frame["contour90"]:
            for x, y in ring:
                xs.append(x)
                ys.append(y)
    west, east, south, north = min(xs), max(xs), min(ys), max(ys)
    pad_lon = max((east - west) * PAD_RATIO, MIN_PAD_DEG)
    pad_lat = max((north - south) * PAD_RATIO, MIN_PAD_DEG)
    return west - pad_lon, south - pad_lat, east + pad_lon, north + pad_lat


def _sample(path: Path, u: str, v: str, times: list[datetime], lons: np.ndarray, lats: np.ndarray) -> np.ndarray:
    """(time, lat, lon, 2) of `u`, `v` interpolated from `path`; NaN where it has none."""
    import xarray as xr

    with xr.open_dataset(path) as ds:
        time_name = "valid_time" if "valid_time" in ds.coords else "time"
        lat_name = "latitude" if "latitude" in ds.coords else "lat"
        lon_name = "longitude" if "longitude" in ds.coords else "lon"
        if "depth" in ds.dims:
            ds = ds.isel(depth=0)
        ds = ds.sortby(lat_name).sortby(lon_name)
        where = {time_name: np.array(times, dtype="datetime64[ns]"), lat_name: lats, lon_name: lons}
        out = np.stack([ds[u].interp(where).values, ds[v].interp(where).values], axis=-1)
    return np.asarray(out, dtype=np.float64)


def _rows(values: np.ndarray) -> list[list[float | None]]:
    """Per hour, [u0, v0, u1, v1, ...] row-major from the south: the console's layout."""
    return [[None if not np.isfinite(x) else round(float(x), 2) for x in hour.reshape(-1)] for hour in values]


def flow_grid(
    payload: dict[str, Any],
    *,
    back_wind: Path,
    ahead_wind: Path,
    back_current: Path | None = None,
    ahead_current: Path | None = None,
    current_source: str | None = None,
) -> dict[str, Any]:
    """The `flow` block of a run's `scene.json` (`FlowGrid` in `sim/types.ts`)."""
    acquired = datetime.fromisoformat(payload["acquiredAtIso"].replace("Z", ""))
    hours = sorted({int(frame["hour"]) for frame in payload["frames"]})
    west, south, east, north = event_bbox(payload)
    lons = np.linspace(west, east, GRID_NODES)
    lats = np.linspace(south, north, GRID_NODES)
    before = [h for h in hours if h <= 0]
    after = [h for h in hours if h > 0]

    def both(back: Path, ahead: Path, u: str, v: str) -> np.ndarray:
        parts = []
        if before:
            parts.append(_sample(back, u, v, [acquired + timedelta(hours=h) for h in before], lons, lats))
        if after:
            parts.append(_sample(ahead, u, v, [acquired + timedelta(hours=h) for h in after], lons, lats))
        return np.concatenate(parts, axis=0)

    wind = both(back_wind, ahead_wind, "u10", "v10")
    current = (both(back_current, ahead_current, "uo", "vo")
               if back_current is not None and ahead_current is not None else None)
    return {
        "minLon": round(west, 6), "minLat": round(south, 6),
        "dLon": round((east - west) / (GRID_NODES - 1), 8), "dLat": round((north - south) / (GRID_NODES - 1), 8),
        "nx": GRID_NODES, "ny": GRID_NODES,
        "hours": hours,
        "wind": _rows(wind),
        "current": None if current is None else _rows(current),
        "windSource": "ERA5 (Copernicus CDS)",
        "currentSource": current_source if current is not None else None,
    }
