"""CMEMS surface currents (ISSUES X2/X3): the requests, the credentials guard, and the reader.

Nothing here reaches Copernicus Marine. The one thing that matters most is the
guard: without credentials the toolbox PROMPTS on stdin, and inside the API's
pipeline subprocess that is a hang, not an error. So a missing credential must
end as a wind-only run with the reason stated, before the toolbox is touched.
"""

from __future__ import annotations

import logging
import warnings
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)

from backend.ingest.metocean.cmems import (  # noqa: E402
    DAILY_DATASET,
    HOURLY_DATASET,
    cmems_reader,
    currents_for,
    dataset_for,
    has_credentials,
    run_current_requests,
)

LON, LAT = -89.2254, 28.3589
T0 = datetime(2023, 5, 15, 0, 2)


def test_currents_are_asked_for_over_the_winds_box_and_windows() -> None:
    """A run's water and air must cover the same place and hours, or parcels leave one field early."""
    from backend.ingest.metocean.era5 import run_wind_requests

    bbox = (-90.1, 28.2, -89.0, 29.4)
    currents = run_current_requests(bbox, T0, hours=72, forward=72)
    winds = run_wind_requests(bbox, T0, hours=72, forward=72)
    for current, wind in zip(currents, winds, strict=True):
        assert (current.west, current.south, current.east, current.north, current.start, current.end) == (
            wind.west, wind.south, wind.east, wind.north, wind.start, wind.end)
        assert current.product == "cmems-currents" and current.variables == ("uo", "vo")


def test_hourly_currents_where_the_archive_has_them_daily_before() -> None:
    assert dataset_for(datetime(2023, 4, 6)) == HOURLY_DATASET
    assert dataset_for(datetime(2021, 12, 31)) == DAILY_DATASET


def test_no_credentials_means_wind_only_with_the_reason_never_a_prompt(monkeypatch, tmp_path) -> None:
    for name in ("COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD", "CDSE_USERNAME",
                 "CDSE_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("DEMO_OFFLINE", raising=False)
    monkeypatch.setenv("COPERNICUSMARINE_CREDENTIALS_DIRECTORY", str(tmp_path))

    def prompt(*_args, **_kwargs):  # the toolbox's stdin prompt; reaching it is the failure
        raise AssertionError("the toolbox was reached without credentials")

    import copernicusmarine

    monkeypatch.setattr(copernicusmarine, "subset", prompt)
    assert not has_credentials()
    back, ahead, why = currents_for((-90.0, 28.0, -89.0, 29.0), T0, hours=6, forward=6, cache_dir=tmp_path)
    assert back is None and ahead is None
    assert "COPERNICUSMARINE_SERVICE_USERNAME" in why and "copernicusmarine login" in why


def test_a_login_file_counts_as_credentials(monkeypatch, tmp_path) -> None:
    for name in ("COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD", "CDSE_USERNAME",
                 "CDSE_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("COPERNICUSMARINE_CREDENTIALS_DIRECTORY", str(tmp_path))
    (tmp_path / ".copernicusmarine-credentials").write_text("[credentials]\n", encoding="utf-8")
    assert has_credentials()


def test_the_cdse_pair_stands_in_for_the_marine_pair(monkeypatch, tmp_path) -> None:
    """A Marine account signed into through CDSE shares its login once it has a Marine password."""
    for name in ("COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("COPERNICUSMARINE_CREDENTIALS_DIRECTORY", str(tmp_path))
    monkeypatch.setenv("CDSE_USERNAME", "someone@example.org")
    monkeypatch.setenv("CDSE_PASSWORD", "not-a-real-password")
    assert has_credentials()


def test_offline_with_nothing_cached_is_wind_only_too(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("COPERNICUSMARINE_SERVICE_USERNAME", "someone")
    monkeypatch.setenv("COPERNICUSMARINE_SERVICE_PASSWORD", "not-used")
    monkeypatch.setenv("DEMO_OFFLINE", "1")
    back, _, why = currents_for((-90.0, 28.0, -89.0, 29.0), T0, hours=6, forward=6, cache_dir=tmp_path)
    assert back is None and "DEMO_OFFLINE" in why


def _cmems_file(path: Path, *, u: float, v: float) -> Path:
    """A file laid out as `cmems_mod_glo_phy_anfc_0.083deg_PT1H-m` delivers it: time, depth, lat, lon."""
    import xarray as xr

    times = [np.datetime64(T0 - timedelta(hours=2)) + np.timedelta64(h, "h") for h in range(20)]
    lats = np.arange(LAT - 1, LAT + 1, 1 / 12)
    lons = np.arange(LON - 1, LON + 1, 1 / 12)
    shape = (len(times), 1, len(lats), len(lons))
    xr.Dataset(
        {
            "uo": (("time", "depth", "latitude", "longitude"), np.full(shape, u, dtype=np.float32),
                   {"standard_name": "eastward_sea_water_velocity", "units": "m s-1"}),
            "vo": (("time", "depth", "latitude", "longitude"), np.full(shape, v, dtype=np.float32),
                   {"standard_name": "northward_sea_water_velocity", "units": "m s-1"}),
        },
        coords={
            "time": ("time", times, {"standard_name": "time"}),
            "depth": ("depth", [0.494025], {"standard_name": "depth", "units": "m", "positive": "down"}),
            "latitude": ("latitude", lats, {"standard_name": "latitude", "units": "degrees_north"}),
            "longitude": ("longitude", lons, {"standard_name": "longitude", "units": "degrees_east"}),
        },
    ).to_netcdf(path)
    return path


@pytest.mark.slow
def test_the_cmems_reader_moves_the_oil_with_the_current(tmp_path) -> None:
    """0.3 m/s east for 6 h is 6.5 km east. Getting the variable mapping wrong is silent: zero current."""
    from backend.drift.opendrift_runner import Forcing, run_drift

    reader = cmems_reader(_cmems_file(tmp_path / "currents.nc", u=0.3, v=0.0))
    assert {"x_sea_water_velocity", "y_sea_water_velocity"} <= set(reader.variables)

    result = run_drift(lon=LON, lat=LAT, start=T0, hours=6, backward=False, number=20,
                       readers=[reader, Forcing().as_reader()], horizontal_diffusivity=0.0)
    east_km = (float(np.mean(result.lon)) - LON) * 111.32 * np.cos(np.radians(LAT))
    north_km = (float(np.mean(result.lat)) - LAT) * 111.19
    assert east_km == pytest.approx(0.3 * 6 * 3.6, rel=0.05)
    assert abs(north_km) < 0.1
