"""The wind and current grid a real run carries for the console's arrows (`backend/drift/flow.py`).

Sampled from files laid out as ERA5 and CMEMS deliver them: ERA5's latitude
descends and its time is `valid_time`; CMEMS has a depth axis and NaN on land.
The console reads the grid as rows of [u, v] per node, south row first
(`sim/flow.ts`), so the layout is what is pinned here, with the values.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

from backend.drift.flow import GRID_NODES, flow_grid

T0 = datetime(2023, 12, 5, 0, 2)
SEED = (-89.0, 29.0)


def _payload() -> dict:
    ring = [[-89.1, 28.9], [-88.9, 28.9], [-88.9, 29.1], [-89.1, 29.1], [-89.1, 28.9]]
    return {"acquiredAtIso": T0.isoformat() + "Z", "seed": list(SEED),
            "frames": [{"hour": h, "contour90": [ring]} for h in range(-3, 4)]}


def _era5(path: Path, u: float, v: float) -> Path:
    import xarray as xr

    times = np.datetime64(T0.replace(minute=0)) + np.arange(-6, 8).astype("timedelta64[h]")
    lats = np.arange(30.0, 28.0 - 0.01, -0.25)  # descending, as CDS writes it
    lons = np.arange(-90.0, -88.0 + 0.01, 0.25)
    shape = (len(times), len(lats), len(lons))
    xr.Dataset({"u10": (("valid_time", "latitude", "longitude"), np.full(shape, u, np.float32)),
                "v10": (("valid_time", "latitude", "longitude"), np.full(shape, v, np.float32))},
               coords={"valid_time": times, "latitude": lats, "longitude": lons}).to_netcdf(path)
    return path


def _cmems(path: Path, u: float, v: float) -> Path:
    import xarray as xr

    times = np.datetime64(T0.replace(minute=0)) + np.arange(-6, 8).astype("timedelta64[h]")
    lats = np.arange(28.0, 30.0 + 0.01, 1 / 12)
    lons = np.arange(-90.0, -88.0 + 0.01, 1 / 12)
    uo = np.full((len(times), 1, len(lats), len(lons)), u, np.float32)
    vo = np.full_like(uo, v)
    land = (lats[:, None] > 29.05) & (lons[None, :] < -89.05)  # the north-west corner is land
    uo[:, :, land] = np.nan
    vo[:, :, land] = np.nan
    xr.Dataset({"uo": (("time", "depth", "latitude", "longitude"), uo),
                "vo": (("time", "depth", "latitude", "longitude"), vo)},
               coords={"time": times, "depth": [0.494], "latitude": lats, "longitude": lons}).to_netcdf(path)
    return path


def test_the_grid_is_laid_out_as_the_console_reads_it(tmp_path) -> None:
    wind = _era5(tmp_path / "era5.nc", 3.0, -4.0)
    current = _cmems(tmp_path / "cmems.nc", 0.2, 0.1)
    grid = flow_grid(_payload(), back_wind=wind, ahead_wind=wind, back_current=current, ahead_current=current,
                     current_source="CMEMS hourly (Copernicus Marine)")
    assert grid["hours"] == list(range(-3, 4))
    assert (grid["nx"], grid["ny"]) == (GRID_NODES, GRID_NODES)
    assert all(len(row) == 2 * GRID_NODES * GRID_NODES for row in grid["wind"] + grid["current"])
    # The box is the event's, padded: the seed and every ring inside it.
    east = grid["minLon"] + grid["dLon"] * (GRID_NODES - 1)
    north = grid["minLat"] + grid["dLat"] * (GRID_NODES - 1)
    assert grid["minLon"] < -89.1 and east > -88.9 and grid["minLat"] < 28.9 and north > 29.1
    # Constant fields come back as themselves, u then v, at every node.
    assert grid["wind"][0][:4] == [3.0, -4.0, 3.0, -4.0]
    assert grid["current"][0][:2] == [0.2, 0.1]
    # South row first: node 0 is the south-west corner (sea), the last row's first node the north-west (land).
    north_west = (GRID_NODES - 1) * GRID_NODES * 2
    assert grid["current"][0][north_west] is None and grid["current"][0][0] == 0.2
    assert grid["windSource"].startswith("ERA5") and grid["currentSource"].startswith("CMEMS")


def test_a_wind_only_run_carries_no_current_and_no_source(tmp_path) -> None:
    wind = _era5(tmp_path / "era5.nc", 1.0, 1.0)
    grid = flow_grid(_payload(), back_wind=wind, ahead_wind=wind, current_source="CMEMS hourly")
    assert grid["current"] is None and grid["currentSource"] is None
    # The console then simulates a current and tags it SIM (`sim/flow.ts` completeFlow); nothing is invented here.


def test_hours_after_the_pass_read_the_forecast_file(tmp_path) -> None:
    back = _era5(tmp_path / "back.nc", 1.0, 0.0)
    ahead = _era5(tmp_path / "ahead.nc", 5.0, 0.0)
    grid = flow_grid(_payload(), back_wind=back, ahead_wind=ahead)
    by_hour = dict(zip(grid["hours"], grid["wind"], strict=True))
    assert by_hour[0][0] == pytest.approx(1.0) and by_hour[1][0] == pytest.approx(5.0)
