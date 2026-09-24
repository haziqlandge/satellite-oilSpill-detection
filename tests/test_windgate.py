"""The wind gate (C9) and ERA5 sampling (PHASE-03)."""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from backend.characterize.windgate import (
    GATE_FALL_MS,
    GATE_RISE_MS,
    WindUnavailableError,
    sample_wind,
    wind_gate,
)

FIXTURES = Path(__file__).parent / "fixtures" / "characterise"


def test_gate_matches_the_console_exactly():
    # The console gates its scenarios with `sim/slick.ts` windGate; the two must never disagree.
    for row in json.loads((FIXTURES / "wind_gate.json").read_text())["gates"]:
        assert wind_gate(row["ms"]) == pytest.approx(row["gate"], abs=1e-12), row


def test_gate_bands():
    assert wind_gate(0.0) == 0.0 and wind_gate(GATE_RISE_MS[0]) == 0.0
    assert wind_gate(GATE_RISE_MS[1]) == 1.0 and wind_gate(6.0) == 1.0 and wind_gate(GATE_FALL_MS[0]) == 1.0
    assert wind_gate(GATE_FALL_MS[1]) == 0.0 and wind_gate(25.0) == 0.0
    assert 0.0 < wind_gate(2.1) < 0.1, "2.1 m/s carries visibly lower confidence, it does not vanish"


def test_gate_is_monotonic_on_each_side_and_continuous():
    speeds = np.linspace(0, 20, 20001)
    gates = np.array([wind_gate(float(v)) for v in speeds])
    rising = speeds <= GATE_RISE_MS[1]
    falling = speeds >= GATE_FALL_MS[0]
    assert np.all(np.diff(gates[rising]) >= 0)
    assert np.all(np.diff(gates[falling]) <= 0)
    # No jump anywhere: a 1 mm/s step never moves the gate by more than the ramp slope allows.
    steepest = 1 / min(GATE_RISE_MS[1] - GATE_RISE_MS[0], GATE_FALL_MS[1] - GATE_FALL_MS[0])
    assert np.max(np.abs(np.diff(gates))) <= steepest * (speeds[1] - speeds[0]) + 1e-12
    assert np.all((gates >= 0) & (gates <= 1))


def test_gate_refuses_a_non_finite_speed():
    with pytest.raises(ValueError):
        wind_gate(math.nan)


@pytest.fixture
def era5(tmp_path: Path) -> Path:
    """A small ERA5-shaped file: hourly, latitude descending, as CDS writes it."""
    import xarray as xr

    times = np.array([np.datetime64("2023-05-15T00:00") + np.timedelta64(h, "h") for h in range(-2, 3)])
    lats = np.array([29.0, 28.75, 28.5, 28.25])
    lons = np.array([-89.75, -89.5, -89.25, -89.0])
    shape = (times.size, lats.size, lons.size)
    u = np.full(shape, 3.0, dtype="float32")
    v = np.full(shape, 4.0, dtype="float32")
    u[2, 1, 2] = 0.0  # 00:00 at (-89.25, 28.75): a calm cell, to prove the lookup is nearest
    v[2, 1, 2] = 1.5
    ds = xr.Dataset(
        {"u10": (("valid_time", "latitude", "longitude"), u), "v10": (("valid_time", "latitude", "longitude"), v)},
        coords={"valid_time": times, "latitude": lats, "longitude": lons},
    )
    path = tmp_path / "era5-wind_test.nc"
    ds.to_netcdf(path)
    return path


def test_sample_reads_the_nearest_cell_and_hour_and_records_the_offset(era5: Path):
    s = sample_wind(era5, -89.27, 28.78, datetime(2023, 5, 15, 0, 20))
    assert (s.grid_lon, s.grid_lat) == (-89.25, 28.75)
    assert s.valid_time == datetime(2023, 5, 15, 0, 0)
    assert s.offset_s == -1200
    assert s.speed_ms == pytest.approx(1.5)
    assert s.gate == wind_gate(s.speed_ms) == 0.0
    elsewhere = sample_wind(era5, -89.5, 28.5, datetime(2023, 5, 15, 1, 0))
    assert elsewhere.speed_ms == pytest.approx(5.0)
    # u east, v north: the wind blows toward the north-east, so FROM the south-west.
    assert elsewhere.from_deg == pytest.approx(math.degrees(math.atan2(3, 4)) + 180)


def test_sample_takes_an_aware_datetime_as_the_same_instant(era5: Path):
    naive = sample_wind(era5, -89.5, 28.5, datetime(2023, 5, 15, 1, 0))
    aware = sample_wind(era5, -89.5, 28.5, datetime(2023, 5, 15, 6, 30, tzinfo=UTC) - timedelta(hours=5, minutes=30))
    assert aware == naive


def test_sample_refuses_rather_than_reaching(era5: Path):
    with pytest.raises(WindUnavailableError, match="outside"):
        sample_wind(era5, -89.5, 28.5, datetime(2023, 5, 15, 6, 0))
    with pytest.raises(WindUnavailableError, match="outside"):
        sample_wind(era5, -80.0, 28.5, datetime(2023, 5, 15, 0, 0))
