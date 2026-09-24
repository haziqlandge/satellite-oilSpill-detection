"""The measurements a seed detection gets from its own scene: CFAR, damping, wind.

Moved here from `scripts/export_real_scenes.py` when the live pipeline
(`backend/pipeline`) became their second user; the script re-exports the names
it had. Each reads a processed sigma-0 raster (EPSG:4326, dB) or a cached ERA5
file and says what it did not measure rather than writing a number for it.

Band: `SCENE_BAND` (2, VV by the D5 assumption) when the raster has it, else
band 1 -- a single-band window cut from a scene carries that band alone.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

CFAR_RADIUS_KM = 15.0


def scene_band(count: int) -> int:
    from backend.detect.cfar.detector import SCENE_BAND

    return SCENE_BAND if count >= SCENE_BAND else 1


def cfar_near_seed(path: Path, seed: tuple[float, float], *, radius_km: float = CFAR_RADIUS_KM) -> dict[str, object]:
    """Bright targets within `radius_km` of the seed, in lon/lat, brightest first."""

    if not path.exists():
        return {"status": "not_run", "reason": f"the processed scene {path.name} is not on this machine", "targets": []}
    import rasterio
    from rasterio.windows import Window, from_bounds

    from backend.detect.cfar.detector import (
        DEFAULT_GUARD_PX,
        DEFAULT_MIN_AREA_PX,
        DEFAULT_PFA,
        DEFAULT_TRAIN_PX,
        detect_bright_targets,
    )

    dlat = radius_km / 110.574
    dlon = radius_km / (111.320 * math.cos(math.radians(seed[1])))
    with rasterio.open(path) as source:
        window = from_bounds(seed[0] - dlon, seed[1] - dlat, seed[0] + dlon, seed[1] + dlat, source.transform)
        window = window.round_offsets().round_lengths().intersection(Window(0, 0, source.width, source.height))
        transform = source.window_transform(window)
        band = scene_band(source.count)
        image = source.read(band, window=window)
    targets = detect_bright_targets(image, input_db=True)
    found = []
    for t in targets:
        lon, lat = transform * (t.col + 0.5, t.row + 0.5)
        found.append({
            "position": [round(float(lon), 6), round(float(lat), 6)],
            "peakDb": round(10.0 * math.log10(t.peak_linear), 2),
            "areaPx": t.area_px,
        })
    return {
        "status": "run",
        "radiusKm": radius_km,
        "band": band,
        "params": {"guard_px": DEFAULT_GUARD_PX, "train_px": DEFAULT_TRAIN_PX, "pfa": DEFAULT_PFA,
                   "min_area_px": DEFAULT_MIN_AREA_PX},
        "targets": found,
    }


def seed_damping(raster: Path, outline: Any, others: list[Any]) -> Any:
    """The damping ratio of `outline` on the processed scene, clean sea only (`backend/characterize/damping`)."""

    import rasterio
    from rasterio.features import rasterize
    from rasterio.windows import Window, from_bounds
    from roaring_landmask import RoaringLandmask

    from backend.characterize.damping import DEFAULT_ANNULUS_M, DEFAULT_STANDOFF_M, damping_ratio

    west, south, east, north = outline.bounds
    lat = (south + north) / 2
    margin_km = (DEFAULT_STANDOFF_M + DEFAULT_ANNULUS_M) / 1000 + 0.3
    dlat = margin_km / 110.574
    dlon = margin_km / (111.320 * math.cos(math.radians(lat)))
    with rasterio.open(raster) as source:
        window = from_bounds(west - dlon, south - dlat, east + dlon, north + dlat, source.transform)
        window = window.round_offsets().round_lengths().intersection(Window(0, 0, source.width, source.height))
        transform = source.window_transform(window)
        band = scene_band(source.count)
        image = source.read(band, window=window).astype(float)
        res_x, res_y = source.res
    image[image == 0] = np.nan  # SNAP's fill, not dark water
    shape = image.shape
    rows, cols = np.indices(shape)
    xs, ys = transform * (cols.ravel() + 0.5, rows.ravel() + 0.5)
    land = np.asarray(RoaringLandmask.new().contains_many(np.asarray(xs), np.asarray(ys)), dtype=bool).reshape(shape)
    slick = rasterize([outline], out_shape=shape, transform=transform, fill=0, default_value=1, dtype="uint8").astype(bool)
    near = [o for o in others if o.intersects(outline.buffer(2 * max(dlon, dlat)))]
    other = (rasterize(near, out_shape=shape, transform=transform, fill=0, default_value=1, dtype="uint8").astype(bool)
             if near else np.zeros(shape, dtype=bool))
    pixel_m = (res_y * 110_574.0, res_x * 111_320.0 * math.cos(math.radians(lat)))
    return damping_ratio(image, slick & ~land, pixel_m=pixel_m, exclude=land | other)


def wind_series(
    back_nc: Path,
    ahead_nc: Path,
    seed: tuple[float, float],
    acquired: datetime,
    *,
    hours: int,
    forward: int,
) -> dict[str, object]:
    """ERA5 10 m wind at the seed, hour by hour, from the files the drift ran on."""
    import xarray as xr

    hour_list, speed, from_deg = [], [], []
    grid: list[float] = []
    for nc, span in ((back_nc, range(-hours, 1)), (ahead_nc, range(1, forward + 1))):
        with xr.open_dataset(nc) as ds:
            time_name = "valid_time" if "valid_time" in ds.coords else "time"
            lat_name = "latitude" if "latitude" in ds.coords else "lat"
            lon_name = "longitude" if "longitude" in ds.coords else "lon"
            at = ds.sel({lat_name: seed[1], lon_name: seed[0]}, method="nearest")
            for h in span:
                instant = np.datetime64(acquired + timedelta(hours=h))
                row = at.sel({time_name: instant}, method="nearest")
                u, v = float(row["u10"]), float(row["v10"])
                hour_list.append(h)
                speed.append(round(math.hypot(u, v), 2))
                # Meteorological convention: the direction the wind blows FROM.
                from_deg.append(round((math.degrees(math.atan2(-u, -v)) + 360) % 360, 1))
            grid = grid or [round(float(at[lon_name]), 3), round(float(at[lat_name]), 3)]
    return {
        "source": "ERA5 10 m wind (u10, v10), the cached requests the drift ran on",
        "gridPoint": grid,
        "hours": hour_list,
        "ms": speed,
        "fromDeg": from_deg,
        "current": "none: no current field (CMEMS has no credentials, ISSUES X2); the drift is wind-driven",
    }


def characterise_seed_on(
    document: dict[str, Any],
    seed: Any,
    *,
    raster: Path,
    wind_nc: Path,
    acquired: datetime,
    detection_id: str,
) -> dict[str, object]:
    """The backend characterisation (PHASE-03) of a seed detection, as the views read it.

    Geometry from the unsimplified polygon, damping on the raster's own band
    against clean sea (every other detection kept out of the annulus), and the
    wind gate from the cached ERA5 at the seed at the pass. Without the raster
    the damping is written as not measured, never as a number.
    """
    from backend.characterize.characterise import characterise_outline
    from backend.characterize.windgate import sample_wind
    from backend.drift.seedrule import polygon_parts, seed_polygon_in

    outline = seed_polygon_in(document, seed)
    others = [polygon for fi, pi, polygon, _ in polygon_parts(document) if (fi, pi) != (seed.feature, seed.part)]
    damping = seed_damping(raster, outline, others) if raster.exists() else None
    wind = sample_wind(wind_nc, seed.centre[0], seed.centre[1], acquired)
    record = characterise_outline(outline, damping=damping, wind=wind).as_console(detection_id)
    band = None
    if damping is not None:
        import rasterio

        with rasterio.open(raster) as source:
            band = scene_band(source.count)
    record["source"] = ("backend/characterize (PHASE-03) on the unsimplified seed polygon; damping on "
                        + (f"{raster.name} band {band}" if damping is not None else
                           "nothing: the processed scene is not on this machine, so it is not measured"))
    return record
