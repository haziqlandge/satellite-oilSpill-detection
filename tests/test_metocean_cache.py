"""Offline-first forcing cache (PHASE-04, and PHASE-09's offline guarantee).

`CONSTRAINTS.md` names CMEMS auth and quota as the most likely way a live demo
dies. The realistic failure is not a clean disconnection -- it is the network
being present while the credentials have expired -- so the cache must be
consulted **first**, unconditionally, and `DEMO_OFFLINE=1` must make a network
fetch impossible rather than merely unlikely.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from backend.ingest.metocean.cache import (
    OFFLINE_ENV,
    CacheMissError,
    ForcingRequest,
    cached_path,
    fetch_with_cache,
    is_offline,
    warm,
)


def _request(product: str = "cmems_currents", **overrides) -> ForcingRequest:
    base = dict(
        product=product, west=-92.0, south=27.0, east=-87.0, north=31.0,
        start=datetime(2023, 5, 13), end=datetime(2023, 5, 15),
        variables=("uo", "vo"),
    )
    base.update(overrides)
    return ForcingRequest(**base)  # type: ignore[arg-type]


def _writes(payload: bytes = b"netcdf"):
    def fetcher(request: ForcingRequest, path: Path) -> None:
        path.write_bytes(payload)
    return fetcher


# --- keying -----------------------------------------------------------------


def test_the_same_request_hits_the_same_key() -> None:
    """Forcing for a fixed historical window never changes."""

    assert _request().key() == _request().key()


def test_floating_point_noise_in_the_bbox_still_hits() -> None:
    """A recomputed AOI must not miss its own cache.

    Rounded to ~11 m: below that the difference cannot matter to a 9 km forcing
    grid, and treating it as a new request would restore the network dependency
    the cache exists to remove.
    """

    assert _request().key() == _request(west=-92.000001).key()


def test_a_different_window_is_a_different_entry() -> None:
    assert _request().key() != _request(end=datetime(2023, 5, 16)).key()


def test_variable_order_does_not_change_the_key() -> None:
    assert _request().key() == _request(variables=("vo", "uo")).key()


# --- disk first -------------------------------------------------------------


def test_a_cached_entry_is_returned_without_fetching(tmp_path: Path) -> None:
    request = _request()
    request.path(tmp_path).parent.mkdir(parents=True, exist_ok=True)
    request.path(tmp_path).write_bytes(b"cached")

    def explode(*_: object) -> None:
        raise AssertionError("network must not be consulted when cached")

    assert fetch_with_cache(request, explode, cache_dir=tmp_path).read_bytes() == b"cached"


def test_a_miss_fetches_and_stores(tmp_path: Path) -> None:
    request = _request()

    path = fetch_with_cache(request, _writes(), cache_dir=tmp_path)

    assert path.read_bytes() == b"netcdf"
    assert cached_path(request, cache_dir=tmp_path) == path


def test_an_empty_file_is_not_treated_as_cached(tmp_path: Path) -> None:
    """A zero-byte NetCDF is a failed download, not a cache hit."""

    request = _request()
    request.path(tmp_path).parent.mkdir(parents=True, exist_ok=True)
    request.path(tmp_path).write_bytes(b"")

    assert cached_path(request, cache_dir=tmp_path) is None


def test_a_failed_fetch_leaves_nothing_behind(tmp_path: Path) -> None:
    """A truncated NetCDF loads, has the right dimensions and wrong values."""

    def fails(request: ForcingRequest, path: Path) -> None:
        path.write_bytes(b"half")
        raise OSError("connection reset")

    with pytest.raises(OSError, match="connection reset"):
        fetch_with_cache(_request(), fails, cache_dir=tmp_path)

    assert cached_path(_request(), cache_dir=tmp_path) is None
    assert list(tmp_path.glob("*.partial")) == []


def test_a_fetcher_writing_nothing_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(CacheMissError, match="produced no data"):
        fetch_with_cache(_request(), lambda r, p: None, cache_dir=tmp_path)


# --- offline ----------------------------------------------------------------


def test_offline_mode_forbids_the_network(tmp_path: Path, monkeypatch) -> None:
    """PHASE-09 runs the demo with networking disabled; this must fail loudly.

    Reaching the network here would mean the offline guarantee was never
    actually tested.
    """

    monkeypatch.setenv(OFFLINE_ENV, "1")

    def explode(*_: object) -> None:
        raise AssertionError("network must not be reached in offline mode")

    with pytest.raises(CacheMissError, match=OFFLINE_ENV):
        fetch_with_cache(_request(), explode, cache_dir=tmp_path)


def test_offline_mode_still_serves_the_cache(tmp_path: Path, monkeypatch) -> None:
    """The point of warming it in the first place."""

    request = _request()
    request.path(tmp_path).parent.mkdir(parents=True, exist_ok=True)
    request.path(tmp_path).write_bytes(b"cached")
    monkeypatch.setenv(OFFLINE_ENV, "1")

    assert fetch_with_cache(request, None, cache_dir=tmp_path).read_bytes() == b"cached"


@pytest.mark.parametrize("value", ["1", "true", "YES"])
def test_offline_flag_accepts_the_obvious_spellings(value: str, monkeypatch) -> None:
    monkeypatch.setenv(OFFLINE_ENV, value)
    assert is_offline()


def test_offline_defaults_to_off(monkeypatch) -> None:
    monkeypatch.delenv(OFFLINE_ENV, raising=False)
    assert not is_offline()


# --- warming ----------------------------------------------------------------


def test_warming_reports_rather_than_stopping_at_the_first_failure(tmp_path: Path) -> None:
    """Knowing three of twenty windows failed beats stopping at the first."""

    good, bad = _request("good"), _request("bad")

    def selective(request: ForcingRequest, path: Path) -> None:
        if request.product == "bad":
            raise OSError("quota exceeded")
        path.write_bytes(b"data")

    report = warm([good, bad], selective, cache_dir=tmp_path)

    assert report["fetched"] == [good.key()]
    assert bad.key() in report["failed"]
    assert report["complete"] is False


def test_warming_an_already_complete_cache_fetches_nothing(tmp_path: Path) -> None:
    request = _request()
    request.path(tmp_path).parent.mkdir(parents=True, exist_ok=True)
    request.path(tmp_path).write_bytes(b"data")

    report = warm([request], lambda r, p: (_ for _ in ()).throw(AssertionError()), cache_dir=tmp_path)

    assert report["already_cached"] == [request.key()]
    assert report["complete"] is True
