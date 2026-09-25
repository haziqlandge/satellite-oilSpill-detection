"""Offline-first cache for met-ocean forcing (PHASE-04).

**Disk first, network second, always.** `CONSTRAINTS.md` names CMEMS auth and
quota as the single most likely way a live demo dies, and PHASE-09 requires the
whole pipeline run with networking disabled. A cache that checks the network
first and falls back to disk would still fail at demo time when the network is
present but the credentials have expired -- which is the realistic failure, not
a clean disconnection.

So the order here is not a performance optimisation. It is the thing that makes
the demo survivable, and `DEMO_OFFLINE=1` turns the network off entirely so the
offline path can be *tested* rather than hoped for.

**A cache entry is keyed by what was asked for, not by when.** Met-ocean
forcing for a fixed historical window never changes -- CMEMS reanalysis for
May 2023 is the same tomorrow -- so the key is the product, the bounding box,
the time window and the variables. Including a timestamp would make every run
a miss and quietly restore the network dependency this exists to remove.

**Writes go through a temporary file.** A NetCDF truncated by an interrupted
download is worse than a missing one: it loads, it has the right dimensions, and
its values are wrong at the end. Same discipline as the SNAP output and the
Zenodo archives.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_CACHE_DIR = Path("data/cache/metocean")

# Set to 1 to forbid every network fetch. PHASE-09's `verify_offline.py` runs the
# whole demo with this on, so the offline path is exercised rather than assumed.
OFFLINE_ENV = "DEMO_OFFLINE"


class CacheMissError(RuntimeError):
    """Nothing cached, and the network is unavailable or forbidden."""


def is_offline() -> bool:
    return os.environ.get(OFFLINE_ENV, "0").strip().lower() in {"1", "true", "yes"}


@dataclass(frozen=True, slots=True)
class ForcingRequest:
    """What a reader needs. Hashable, and stable across runs."""

    product: str
    west: float
    south: float
    east: float
    north: float
    start: datetime
    end: datetime
    variables: tuple[str, ...]

    def key(self) -> str:
        """A stable digest of the request.

        Rounded to 4 decimal places (~11 m) so that a bounding box differing
        only by floating-point noise still hits the same entry -- otherwise a
        recomputed AOI would miss its own cache.
        """

        payload = json.dumps(
            {
                "product": self.product,
                "bbox": [round(v, 4) for v in (self.west, self.south, self.east, self.north)],
                "start": self.start.isoformat(),
                "end": self.end.isoformat(),
                "variables": sorted(self.variables),
            },
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:32]

    def path(self, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
        return cache_dir / f"{self.product}_{self.key()}.nc"


def cached_path(request: ForcingRequest, *, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path | None:
    """The cached file for `request`, or None. Never touches the network."""

    path = request.path(cache_dir)
    return path if path.exists() and path.stat().st_size > 0 else None


# CDS snaps a requested area to its grid, inward: a file fetched for exactly a
# request can stop up to one ERA5 step (0.25 degrees) short of the box it asked
# for. A covering file is held to the same standard, no stricter.
GRID_TOLERANCE_DEG = 0.25


def covering_path(request: ForcingRequest, *, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path | None:
    """A cached file of the same product whose box and window contain `request`'s, or None.

    Reanalysis for a fixed place and time never changes, so a file fetched for a
    larger box or a longer window answers a smaller request exactly -- the
    reader subsets it by position and time. This is what lets a window cut from
    a processed scene run offline on the scene's own cached wind: its detections
    span a smaller box, so its exact key is new. Each file is opened to read
    its extent; the key is a digest and says nothing about coverage. Never
    touches the network.
    """

    import numpy as np
    import xarray as xr

    start, end = np.datetime64(request.start), np.datetime64(request.end)
    for path in sorted(cache_dir.glob(f"{request.product}_*.nc")):
        if path.stat().st_size == 0:
            continue
        try:
            with xr.open_dataset(path) as ds:
                time_name = "valid_time" if "valid_time" in ds.coords else "time"
                lat_name = "latitude" if "latitude" in ds.coords else "lat"
                lon_name = "longitude" if "longitude" in ds.coords else "lon"
                lons, lats, times = ds[lon_name].values, ds[lat_name].values, ds[time_name].values
        except (OSError, KeyError, ValueError):
            continue
        tol = GRID_TOLERANCE_DEG
        if (
            lons.min() <= request.west + tol and lons.max() >= request.east - tol
            and lats.min() <= request.south + tol and lats.max() >= request.north - tol
            and times.min() <= start and times.max() >= end
        ):
            return path
    return None


def fetch_with_cache(
    request: ForcingRequest,
    fetcher: Callable[[ForcingRequest, Path], None] | None = None,
    *,
    cache_dir: Path = DEFAULT_CACHE_DIR,
) -> Path:
    """Return a local NetCDF for `request`, fetching only if it is not cached.

    `fetcher` writes the data to the path it is given. It is never called when
    a cache entry exists, and never called at all when `DEMO_OFFLINE=1` -- so a
    run that should be offline fails loudly here rather than silently reaching
    the network.
    """

    existing = cached_path(request, cache_dir=cache_dir)
    if existing is not None:
        return existing

    if is_offline():
        raise CacheMissError(
            f"{OFFLINE_ENV} is set and {request.product} is not cached for "
            f"{request.start:%Y-%m-%d}..{request.end:%Y-%m-%d}. Warm the cache before "
            "running offline."
        )
    if fetcher is None:
        raise CacheMissError(f"no cache entry for {request.product} and no fetcher supplied")

    target = request.path(cache_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_suffix(".nc.partial")
    staging.unlink(missing_ok=True)

    try:
        fetcher(request, staging)
        if not staging.exists() or staging.stat().st_size == 0:
            raise CacheMissError(f"fetcher produced no data for {request.product}")
    except BaseException:
        # A truncated NetCDF loads, has the right dimensions and wrong values.
        staging.unlink(missing_ok=True)
        raise

    staging.replace(target)
    return target


def resolve(
    request: ForcingRequest,
    fetcher: Callable[[ForcingRequest, Path], None],
    *,
    fetched_from: str,
    cache_dir: Path = DEFAULT_CACHE_DIR,
) -> tuple[Path, str]:
    """The file for `request` and how it was found: exact hit, a covering cached file, or a fetch.

    A window cut from a processed scene asks for a smaller box than the scene's
    own runs did, so its exact key is new; the scene's cached file covers it,
    which keeps such a run offline-capable. Only a true miss reaches the
    network, and `DEMO_OFFLINE=1` forbids even that.
    """
    exact = cached_path(request, cache_dir=cache_dir)
    if exact is not None:
        return exact, "cached"
    covering = covering_path(request, cache_dir=cache_dir)
    if covering is not None:
        return covering, f"cached in a covering request ({covering.name})"
    return fetch_with_cache(request, fetcher, cache_dir=cache_dir), f"fetched from {fetched_from}"


def warm(
    requests: Sequence[ForcingRequest],
    fetcher: Callable[[ForcingRequest, Path], None],
    *,
    cache_dir: Path = DEFAULT_CACHE_DIR,
) -> dict[str, Any]:
    """Fetch everything needed ahead of time, for a later offline run.

    Returns a report rather than raising on the first failure: warming is a
    preparation step, and knowing that three of twenty windows failed is more
    useful than stopping at the first.
    """

    fetched, cached, failed = [], [], {}
    for request in requests:
        if cached_path(request, cache_dir=cache_dir) is not None:
            cached.append(request.key())
            continue
        try:
            fetch_with_cache(request, fetcher, cache_dir=cache_dir)
            fetched.append(request.key())
        except (CacheMissError, OSError) as error:
            failed[request.key()] = str(error)

    return {
        "fetched": fetched,
        "already_cached": cached,
        "failed": failed,
        "complete": not failed,
    }
