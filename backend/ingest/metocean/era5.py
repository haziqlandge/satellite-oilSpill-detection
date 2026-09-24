"""ERA5 10 m wind, fetched from the Copernicus Climate Data Store.

`cache.py` has been a complete caching layer with no fetcher behind it since it
was written -- `fetch_with_cache` takes a callable and nothing in the repository
supplied one, so the only forcing the drift engine could ever use was a
constant. This is that callable.

It was not written earlier because it could not be tested: the CDS account
authenticated but had never accepted the ERA5 licence, and every request came
back 403. That was cleared on 2026-09-22 and a probe returned `accepted` with a
job id, so this is now exercisable end to end.

WHY THIS MATTERS MORE THAN IT LOOKS. Under constant forcing the backward
ensemble has nothing to converge on: every member drifts the same way, the
cloud only diffuses, and `estimate_age` correctly reports `monotonic` or
`indeterminate` because there is no convergence minimum to find. That is right
behaviour, not a bug -- but it means the age estimate, which is one of the
system's three answers, can never be anything but a refusal. A time-varying
wind field is what gives the hindcast structure to converge on.

WHAT IT DOES NOT DO. Currents. CMEMS has no credentials in this repository
(ISSUES X2), so a run using this reader is wind-forced only, and any run built
on it should say so rather than implying a full metocean field.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .cache import ForcingRequest

# The CDS name for what OpenDrift wants as x_wind / y_wind at 10 m.
ERA5_WIND_VARIABLES = ("10m_u_component_of_wind", "10m_v_component_of_wind")
ERA5_DATASET = "reanalysis-era5-single-levels"


class Era5Error(RuntimeError):
    """The fetch could not be made. Never raised for an ordinary cache hit."""


def wind_request(
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    start: datetime,
    end: datetime,
    pad_deg: float = 1.0,
) -> ForcingRequest:
    """A request for 10 m wind over an area and window.

    The box is padded because a backward ensemble leaves the scene: parcels
    reconstructed 72 h upstream can be a long way outside the detection's own
    bounding box, and a reader that stops at the box edge silently stops forcing
    them. A degree is about 111 km, comfortably beyond what a surface parcel
    covers in three days.
    """
    if end < start:
        raise Era5Error(f"end {end} is before start {start}")
    return ForcingRequest(
        product="era5-wind",
        west=west - pad_deg,
        south=south - pad_deg,
        east=east + pad_deg,
        north=north + pad_deg,
        start=start,
        end=end,
        variables=ERA5_WIND_VARIABLES,
    )


def run_wind_requests(
    bbox: tuple[float, float, float, float],
    acquired: datetime,
    *,
    hours: int,
    forward: int,
) -> tuple[ForcingRequest, ForcingRequest]:
    """The two ERA5 requests a scene's runs are forced by: before the pass, and after it.

    One place, because the real-run export, the live pipeline and the wind the
    views show all read the same cached files, and a series fetched separately
    would not be the wind the parcels felt. `bbox` is every detection ring's
    extent; `acquired` is naive UTC. One hour past each end, so the reader
    brackets the run rather than ending on it.
    """
    west, south, east, north = bbox
    box = dict(west=west, south=south, east=east, north=north)
    back = wind_request(**box, start=acquired - timedelta(hours=hours + 1), end=acquired + timedelta(hours=1))
    ahead = wind_request(**box, start=acquired - timedelta(hours=1), end=acquired + timedelta(hours=forward + 1))
    return back, ahead


def wind_only_readers(wind_path: Path) -> list[Any]:
    """The readers a wind-forced OpenOil run needs: ERA5 wind, the coast, and zero current.

    OpenOil needs more than wind. It requires currents and a land mask, and
    refuses to start without a reader for each -- "every ensemble member
    failed" is what a missing one looks like.

    Order is priority: ERA5 answers the wind, OpenDrift's own global landmask
    answers the coast, and the constant reader answers what is left, which is
    the currents. Those are ZERO, because CMEMS has no credentials (ISSUES X2)
    -- so this is a wind-driven reconstruction and every artifact says so rather
    than implying a full metocean field.

    The landmask is OpenDrift's own, not the frontend's: hand-rolling coastline
    handling inside the physics is exactly what C6 forbids.
    """
    from opendrift.readers import reader_global_landmask

    from backend.drift.opendrift_runner import Forcing

    return [era5_reader(wind_path), reader_global_landmask.Reader(), Forcing().as_reader()]


def _hours_between(start: datetime, end: datetime) -> list[datetime]:
    """Every whole hour covering the window, inclusive of both ends."""
    first = start.replace(minute=0, second=0, microsecond=0)
    out: list[datetime] = []
    step = first
    while step <= end:
        out.append(step)
        step += timedelta(hours=1)
    if not out or out[-1] < end:
        out.append((out[-1] if out else first) + timedelta(hours=1))
    return out


def fetch_era5_wind(request: ForcingRequest, destination: Path) -> None:
    """Write ERA5 10 m wind for `request` to `destination` as NetCDF.

    Matches the `fetcher` signature `cache.fetch_with_cache` expects, so it is
    only ever called on a cache miss.
    """
    try:
        import cdsapi
    except ImportError as error:  # pragma: no cover - environment dependent
        raise Era5Error("cdsapi is not installed") from error

    url = os.environ.get("CDSAPI_URL", "").strip()
    key = os.environ.get("CDSAPI_KEY", "").strip()
    if not url or not key:
        raise Era5Error("CDSAPI_URL and CDSAPI_KEY must be set to fetch ERA5")

    hours = _hours_between(request.start, request.end)
    if not hours:
        raise Era5Error("empty time window")

    # CDS takes the request as the cross product of year/month/day/time, so a
    # window spanning a month boundary asks for more than it needs and is
    # trimmed by the reader. Correct, and cheaper than one request per day.
    payload = {
        "product_type": ["reanalysis"],
        "variable": list(request.variables),
        "year": sorted({f"{h.year:04d}" for h in hours}),
        "month": sorted({f"{h.month:02d}" for h in hours}),
        "day": sorted({f"{h.day:02d}" for h in hours}),
        "time": sorted({f"{h.hour:02d}:00" for h in hours}),
        # CDS order is North, West, South, East.
        "area": [request.north, request.west, request.south, request.east],
        "data_format": "netcdf",
        "download_format": "unarchived",
    }

    client = cdsapi.Client(url=url, key=key, quiet=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        client.retrieve(ERA5_DATASET, payload, str(destination))
    except Exception as error:
        message = str(error)
        if "licence" in message.lower():
            raise Era5Error(
                "The CDS account has not accepted the ERA5 licence. Accept it once at "
                "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels"
                "?tab=download#manage-licences"
            ) from error
        raise Era5Error(f"ERA5 fetch failed: {message}") from error

    if not destination.exists() or destination.stat().st_size == 0:
        raise Era5Error("ERA5 returned no data")


def era5_reader(path: Path):
    """An OpenDrift reader over a fetched ERA5 file.

    ERA5 names its wind `u10`/`v10`; OpenDrift wants `x_wind`/`y_wind`, so the
    mapping is stated here rather than left to the reader's guesswork. Getting
    it wrong is silent -- the run succeeds with no wind at all.
    """
    from opendrift.readers import reader_netCDF_CF_generic

    return reader_netCDF_CF_generic.Reader(
        str(path),
        standard_name_mapping={
            "u10": "x_wind",
            "v10": "y_wind",
            "10m_u_component_of_wind": "x_wind",
            "10m_v_component_of_wind": "y_wind",
        },
    )
