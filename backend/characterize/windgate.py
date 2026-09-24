"""The wind gate (C9) and the wind it is read from (PHASE-03).

SAR sees oil because oil damps the centimetre waves wind raises (Bragg
scattering). Below about 3 m/s there is too little roughness for oil to
suppress, so the sea is already dark and a dark patch means little. Above about
10-12 m/s wind mixes the oil down and re-roughens the surface. Espedal 1999
(*Satellite SAR oil spill detection using wind history information*) is the
foundational reference.

**A continuous multiplier in [0,1], never a hard cut.** The band edges are soft
and regionally variable, and P002 warns against assuming they transfer, so a
detection at 2.1 m/s carries visibly lower confidence instead of silently
vanishing, and `wind_speed_ms` travels with the multiplier to the evidence card.
The ramps are the console's own (`frontDemo/src/sim/slick.ts` `windGate`),
kept identical so the backend and the console can never disagree about a gate;
`tests/test_windgate.py` pins the two together.

**The wind is ERA5 10 m wind at the detection, nearest in time.** Hourly
reanalysis against an acquisition instant: nearest-neighbour in time is
adequate (PHASE-03), and the offset is recorded rather than hidden. A request
more than `MAX_OFFSET_HOURS` outside the file is refused instead of answered
with the nearest hour a day away.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np

from backend.drift.opendrift_runner import naive_utc

# Zero at or below the first speed, full at or above the second (m/s).
GATE_RISE_MS = (2.0, 3.6)
# Full at or below the first speed, zero at or above the second (m/s).
GATE_FALL_MS = (9.5, 13.0)
# Hourly data: an instant inside the file is never more than half an hour off.
MAX_OFFSET_HOURS = 1.0


class WindUnavailableError(RuntimeError):
    """No wind can honestly be read for this place and time."""


def _ramp(value: float, low: float, high: float) -> float:
    return max(0.0, min(1.0, (value - low) / (high - low)))


def wind_gate(speed_ms: float) -> float:
    """The confidence multiplier at a 10 m wind speed: continuous, monotonic on each side."""

    if not math.isfinite(speed_ms):
        raise ValueError(f"wind speed must be finite, got {speed_ms}")
    return _ramp(speed_ms, *GATE_RISE_MS) * (1.0 - _ramp(speed_ms, *GATE_FALL_MS))


@dataclass(frozen=True, slots=True)
class WindSample:
    """The wind at a detection, and exactly where and when it was read."""

    speed_ms: float
    #: Meteorological convention: the direction the wind blows FROM.
    from_deg: float
    u_ms: float
    v_ms: float
    grid_lon: float
    grid_lat: float
    valid_time: datetime
    #: valid_time minus the requested instant, seconds.
    offset_s: float
    source: str

    @property
    def gate(self) -> float:
        return wind_gate(self.speed_ms)


def sample_wind(path: Path, lon: float, lat: float, when: datetime) -> WindSample:
    """ERA5 10 m wind nearest to (`lon`, `lat`) and `when`, from one NetCDF file."""

    import xarray as xr

    instant = naive_utc(when)
    with xr.open_dataset(path) as ds:
        time_name = "valid_time" if "valid_time" in ds.coords else "time"
        lat_name = "latitude" if "latitude" in ds.coords else "lat"
        lon_name = "longitude" if "longitude" in ds.coords else "lon"
        for name in ("u10", "v10"):
            if name not in ds:
                raise WindUnavailableError(f"{path.name} has no {name}")
        lons = ds[lon_name].values
        query_lon = lon + 360.0 if lons.max() > 180.0 and lon < 0 else lon
        if not (lons.min() - 0.5 <= query_lon <= lons.max() + 0.5 and
                ds[lat_name].values.min() - 0.5 <= lat <= ds[lat_name].values.max() + 0.5):
            raise WindUnavailableError(f"({lon:.3f}, {lat:.3f}) is outside {path.name}")
        times = ds[time_name].values
        wanted = np.datetime64(instant, "ns")
        k = int(np.abs(times - wanted).argmin())
        offset_s = float((times[k] - wanted) / np.timedelta64(1, "s"))
        if abs(offset_s) > MAX_OFFSET_HOURS * 3600:
            raise WindUnavailableError(
                f"{path.name} spans {str(times.min())[:16]} to {str(times.max())[:16]}; "
                f"{instant.isoformat()} is {abs(offset_s) / 3600:.1f} h outside it"
            )
        at = ds.isel({time_name: k}).sel({lat_name: lat, lon_name: query_lon}, method="nearest")
        u, v = float(at["u10"]), float(at["v10"])
        grid_lon = float(at[lon_name])
        grid_lat = float(at[lat_name])
    if not (math.isfinite(u) and math.isfinite(v)):
        raise WindUnavailableError(f"{path.name} has no wind at ({grid_lon}, {grid_lat})")
    valid = datetime.fromisoformat(str(np.datetime_as_string(times[k], unit="s")))
    return WindSample(
        speed_ms=math.hypot(u, v),
        from_deg=(math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0,
        u_ms=u,
        v_ms=v,
        grid_lon=grid_lon if grid_lon <= 180.0 else grid_lon - 360.0,
        grid_lat=grid_lat,
        valid_time=valid,
        offset_s=offset_s,
        source=f"ERA5 10 m wind (u10, v10), {path.name}, nearest grid point and hour",
    )
