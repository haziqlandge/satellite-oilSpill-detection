"""CMEMS surface currents, fetched from the Copernicus Marine Service (ISSUES X2/X3).

The second forcing the drift engine needs, beside ERA5 wind (`era5.py`). Until
this existed every real run was wind-only and could not carry a ranking; the
fetcher plugs into the same cache (`cache.fetch_with_cache`) so a run forced by
it is offline-capable once warmed.

WHICH DATASET, AND WHY IT IS NOT THE ONE `PHASE-04.md` NAMES. The plan names
`GLOBAL_MULTIYEAR_PHY_001_030` for the 2023 fixtures, because when it was
written the analysis/forecast archive did not reach back that far. It now does
(2022-06-01 on, checked with `copernicusmarine.describe` on 2026-09-25), and the
multi-year product is DAILY means: over a 72 h hindcast a daily mean flattens
the inertial and tidal swing that moves a surface parcel hour by hour. So:

  * `cmems_mod_glo_phy_anfc_0.083deg_PT1H-m` (GLOBAL_ANALYSISFORECAST_PHY_001_024):
    hourly mean surface `uo`/`vo`, 1/12 degree, on the same hourly clock as
    ERA5. Used for any window it covers.
  * `cmems_mod_glo_phy_my_0.083deg_P1D-m` (the plan's product): daily, used only
    for a window before the hourly archive starts, and the forcing note says so.

Eulerian current only -- not the `merged-uv` product, whose `utotal` adds Stokes
drift: OpenOil already moves the oil with 3% of the wind (`wind_drift_factor`),
and adding Stokes on top would count the wave-driven drift twice.

CREDENTIALS. `COPERNICUSMARINE_SERVICE_USERNAME`/`_PASSWORD` from the
environment (the scripts load `.env` into it); failing those, the
`CDSE_USERNAME`/`CDSE_PASSWORD` pair, because a Marine account signed into
through CDSE is given the same login once it has a Marine password of its own;
failing both, the file `copernicusmarine login` writes. A browser login is not
enough: the toolbox does a password grant, which a CDSE-brokered account with
no Marine password fails ("Invalid user credentials"). Nothing here stores or
prints them.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .cache import DEFAULT_CACHE_DIR, ForcingRequest

PRODUCT = "cmems-currents"
CURRENT_VARIABLES = ("uo", "vo")
HOURLY_DATASET = "cmems_mod_glo_phy_anfc_0.083deg_PT1H-m"
DAILY_DATASET = "cmems_mod_glo_phy_my_0.083deg_P1D-m"
HOURLY_FROM = datetime(2022, 6, 1)
# The top model level is 0.494 m; asking for 0-1 m keeps exactly that level.
SURFACE_DEPTH_M = (0.0, 1.0)


class CmemsError(RuntimeError):
    """The currents could not be fetched. The caller falls back to wind-only and says so."""


def dataset_for(start: datetime) -> str:
    return HOURLY_DATASET if start >= HOURLY_FROM else DAILY_DATASET


def source_label(start: datetime) -> str:
    """What the console's panels say the current is sourced from, for a run whose window starts at `start`."""
    return f"CMEMS {'hourly' if dataset_for(start) == HOURLY_DATASET else 'daily'} (Copernicus Marine)"


def current_request(
    *, west: float, south: float, east: float, north: float, start: datetime, end: datetime, pad_deg: float = 1.0
) -> ForcingRequest:
    """Surface currents over an area and window, padded like the wind (`era5.wind_request`)."""
    if end < start:
        raise CmemsError(f"end {end} is before start {start}")
    return ForcingRequest(
        product=PRODUCT,
        west=west - pad_deg, south=south - pad_deg, east=east + pad_deg, north=north + pad_deg,
        start=start, end=end, variables=CURRENT_VARIABLES,
    )


def run_current_requests(
    bbox: tuple[float, float, float, float], acquired: datetime, *, hours: int, forward: int
) -> tuple[ForcingRequest, ForcingRequest]:
    """The two requests a run's currents come from: the same box and windows as its wind."""
    from .era5 import PAD_H

    west, south, east, north = bbox
    box = dict(west=west, south=south, east=east, north=north)
    back = current_request(**box, start=acquired - timedelta(hours=hours + PAD_H), end=acquired + timedelta(hours=PAD_H))
    ahead = current_request(**box, start=acquired - timedelta(hours=PAD_H),
                            end=acquired + timedelta(hours=forward + PAD_H))
    return back, ahead


def has_credentials() -> bool:
    """Whether the toolbox will find credentials, checked first because without them it PROMPTS on stdin.

    A prompt inside the API's pipeline subprocess would hang the run instead of
    failing it, so no fetch is attempted without the environment pair or the
    file `copernicusmarine login` writes.
    """
    if _login() is not None:
        return True
    base = os.environ.get("COPERNICUSMARINE_CREDENTIALS_DIRECTORY") or Path.home() / ".copernicusmarine"
    return (Path(base) / ".copernicusmarine-credentials").is_file()


def _login() -> tuple[str, str] | None:
    """The username and password pair to hand the toolbox, or None to let it read its own file."""
    for user, password in (("COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD"),
                           ("CDSE_USERNAME", "CDSE_PASSWORD")):
        if os.environ.get(user) and os.environ.get(password):
            return os.environ[user], os.environ[password]
    return None


def currents_for(
    bbox: tuple[float, float, float, float], acquired: datetime, *, hours: int, forward: int,
    cache_dir: Path = DEFAULT_CACHE_DIR,
) -> tuple[Path | None, Path | None, str]:
    """A run's backward and forward current files, or (None, None, why) and the run goes wind-only.

    Cache first (`cache.resolve`), so a warmed run needs neither credentials nor
    network; `DEMO_OFFLINE=1` forbids the fetch.
    """
    from .cache import CacheMissError, resolve

    try:
        (back, how_back), (ahead, how_ahead) = (
            resolve(request, fetch_cmems_currents, fetched_from="Copernicus Marine", cache_dir=cache_dir)
            for request in run_current_requests(bbox, acquired, hours=hours, forward=forward)
        )
    except (CmemsError, CacheMissError) as error:
        return None, None, str(error)
    return back, ahead, "; ".join(dict.fromkeys((how_back, how_ahead)))


def fetch_cmems_currents(request: ForcingRequest, destination: Path) -> None:
    """Write CMEMS surface `uo`/`vo` for `request` to `destination` (the `cache` fetcher signature)."""
    if not has_credentials():
        raise CmemsError(
            "no Copernicus Marine credentials: set COPERNICUSMARINE_SERVICE_USERNAME and _PASSWORD in .env, "
            "or run `copernicusmarine login` once (ISSUES X2)"
        )
    try:
        import copernicusmarine
    except ImportError as error:  # pragma: no cover - environment dependent
        raise CmemsError("copernicusmarine is not installed (the `drift` extra)") from error

    login = _login()
    # The toolbox names its own output; write into a scratch directory and move
    # it, so the cache's staging path is the only file that ever appears.
    with tempfile.TemporaryDirectory() as scratch:
        try:
            copernicusmarine.subset(
                dataset_id=dataset_for(request.start),
                variables=list(request.variables),
                minimum_longitude=request.west, maximum_longitude=request.east,
                minimum_latitude=request.south, maximum_latitude=request.north,
                minimum_depth=SURFACE_DEPTH_M[0], maximum_depth=SURFACE_DEPTH_M[1],
                # A daily file is stamped at 00:00: widen to the enclosing days so
                # the reader brackets the whole window.
                start_datetime=request.start - timedelta(days=1),
                end_datetime=request.end + timedelta(days=1),
                coordinates_selection_method="outside",
                output_directory=scratch, output_filename="currents.nc",
                disable_progress_bar=True, overwrite=True,
                username=login[0] if login else None, password=login[1] if login else None,
            )
        except Exception as error:
            # The toolbox's auth exceptions carry no message; their names say what failed.
            message = f"{type(error).__name__}: {error}"
            if any(word in message.lower() for word in ("credential", "login", "authentication")):
                raise CmemsError(
                    "Copernicus Marine refused the credentials. An account signed into through CDSE needs a "
                    "Marine password of its own; set COPERNICUSMARINE_SERVICE_USERNAME and _PASSWORD in .env, "
                    "or run `copernicusmarine login` once."
                ) from error
            raise CmemsError(f"CMEMS fetch failed: {message}") from error
        produced = Path(scratch) / "currents.nc"
        if not produced.exists() or produced.stat().st_size == 0:
            raise CmemsError("CMEMS returned no data")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(produced), destination)


def cmems_reader(path: Path) -> Any:
    """An OpenDrift reader over a fetched CMEMS file; `uo`/`vo` named explicitly, as `era5_reader` does."""
    from opendrift.readers import reader_netCDF_CF_generic

    return reader_netCDF_CF_generic.Reader(
        str(path),
        standard_name_mapping={
            "uo": "x_sea_water_velocity",
            "vo": "y_sea_water_velocity",
            "eastward_sea_water_velocity": "x_sea_water_velocity",
            "northward_sea_water_velocity": "y_sea_water_velocity",
        },
    )
