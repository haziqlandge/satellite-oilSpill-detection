"""AOI + time-window clipping at AIS ingest.

`PLAN/CONSTRAINTS.md`: "AIS must be clipped at ingest -- Supabase free tier is
500 MB / Pro 8 GB. Clip to the AOI bbox and acquisition window *before* insert."
A marinecadastre national day is ~0.82 GB uncompressed and millions of rows, and
`ais_points` is the table that hits the ceiling first.

The subtle requirement is the **buffer**. Clipping tightly to the scene footprint
would discard exactly the vessels the system exists to find: backward drift means
the origin can lie outside the imaged area, so a discharger upstream of the scene
must survive the clip.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backend.ingest.ais.clip import (
    DEFAULT_BACKWARD_HOURS,
    DEFAULT_BUFFER_KM,
    GULF_OF_MEXICO,
    BoundingBox,
    clip_records,
    window_for_acquisition,
)
from backend.ingest.ais.loader import AisRecord


def _record(lat: float, lon: float, when: datetime, mmsi: int = 1) -> AisRecord:
    return AisRecord(
        mmsi=mmsi,
        base_date_time=when,
        lat=lat,
        lon=lon,
        sog=5.0,
        cog=90.0,
        heading=90.0,
        vessel_name="TEST",
        imo=None,
        call_sign=None,
        vessel_type=None,
        status=None,
        length=None,
        width=None,
        draft=None,
        cargo=None,
        transceiver_class=None,
    )


ACQUIRED = datetime(2023, 4, 9, 0, 2, 6, tzinfo=UTC)


# --- geometry ---------------------------------------------------------------


def test_bbox_contains_a_point_inside() -> None:
    box = BoundingBox(min_lon=-91.0, min_lat=28.0, max_lon=-89.0, max_lat=29.0)

    assert box.contains(lon=-90.0, lat=28.5)


def test_bbox_excludes_a_point_outside() -> None:
    box = BoundingBox(min_lon=-91.0, min_lat=28.0, max_lon=-89.0, max_lat=29.0)

    assert not box.contains(lon=-95.0, lat=28.5)
    assert not box.contains(lon=-90.0, lat=35.0)


def test_bbox_rejects_inverted_bounds() -> None:
    """A transposed lat/lon pair silently clips everything away otherwise."""

    with pytest.raises(ValueError):
        BoundingBox(min_lon=-89.0, min_lat=28.0, max_lon=-91.0, max_lat=29.0)


def test_buffering_widens_the_box_in_both_axes() -> None:
    box = BoundingBox(min_lon=-91.0, min_lat=28.0, max_lon=-89.0, max_lat=29.0)

    wide = box.buffered_km(100.0)

    assert wide.min_lon < box.min_lon
    assert wide.max_lon > box.max_lon
    assert wide.min_lat < box.min_lat
    assert wide.max_lat > box.max_lat


def test_longitude_buffer_accounts_for_convergence_of_meridians() -> None:
    """A degree of longitude is ~0.87 of a degree of latitude at 29 N.

    Applying the same degree offset to both axes would under-buffer longitude,
    which is the axis the Gulf scenes are widest in.
    """

    box = BoundingBox(min_lon=-91.0, min_lat=28.0, max_lon=-89.0, max_lat=29.0)

    wide = box.buffered_km(100.0)
    lat_pad = box.min_lat - wide.min_lat
    lon_pad = box.min_lon - wide.min_lon

    assert lon_pad > lat_pad
    assert lat_pad == pytest.approx(100.0 / 111.32, rel=0.01)


def test_buffer_is_clamped_to_valid_coordinates() -> None:
    box = BoundingBox(min_lon=-179.9, min_lat=-89.9, max_lon=179.9, max_lat=89.9)

    wide = box.buffered_km(500.0)

    assert wide.min_lon >= -180.0 and wide.max_lon <= 180.0
    assert wide.min_lat >= -90.0 and wide.max_lat <= 90.0


# --- time window ------------------------------------------------------------


def test_window_reaches_backward_from_acquisition() -> None:
    """The origin precedes the observation; the window must look back, not forward."""

    window = window_for_acquisition(ACQUIRED)

    assert window.end >= ACQUIRED
    assert window.start == ACQUIRED - timedelta(hours=DEFAULT_BACKWARD_HOURS)


def test_window_covers_the_phase_04_backward_horizon() -> None:
    """PHASE-04 runs backward drift over 0-48 h; the AIS must cover at least that."""

    assert DEFAULT_BACKWARD_HOURS >= 48


def test_window_contains_its_endpoints() -> None:
    window = window_for_acquisition(ACQUIRED, backward_hours=24)

    assert window.contains(ACQUIRED)
    assert window.contains(ACQUIRED - timedelta(hours=24))
    assert not window.contains(ACQUIRED - timedelta(hours=25))


def test_a_naive_timestamp_is_rejected() -> None:
    """marinecadastre timestamps are UTC; a naive one compared against an aware
    one raises deep inside the clip loop instead of here."""

    with pytest.raises(ValueError, match=r"(?i)utc|aware|timezone"):
        window_for_acquisition(datetime(2023, 4, 9, 0, 2, 6))


# --- clipping ---------------------------------------------------------------


def test_clip_keeps_a_record_inside_both_box_and_window() -> None:
    box = GULF_OF_MEXICO
    window = window_for_acquisition(ACQUIRED)
    inside = _record(28.9, -90.0, ACQUIRED - timedelta(hours=3))

    assert list(clip_records([inside], bbox=box, window=window)) == [inside]


def test_clip_drops_a_record_outside_the_box() -> None:
    window = window_for_acquisition(ACQUIRED)
    far_away = _record(40.7, -74.0, ACQUIRED - timedelta(hours=3))  # New York

    assert list(clip_records([far_away], bbox=GULF_OF_MEXICO, window=window)) == []


def test_clip_drops_a_record_outside_the_window() -> None:
    window = window_for_acquisition(ACQUIRED)
    stale = _record(28.9, -90.0, ACQUIRED - timedelta(days=30))

    assert list(clip_records([stale], bbox=GULF_OF_MEXICO, window=window)) == []


def test_clip_retains_a_vessel_upstream_of_the_scene() -> None:
    """The case the buffer exists for.

    A vessel that discharged outside the imaged footprint and drifted in is the
    origin. Clipping to the footprint alone would delete the answer.
    """

    footprint = BoundingBox(min_lon=-91.1022, min_lat=27.9531, max_lon=-88.1751, max_lat=29.8763)
    upstream = _record(28.9, -91.6, ACQUIRED - timedelta(hours=20))

    assert not footprint.contains(lon=upstream.lon, lat=upstream.lat)
    assert footprint.buffered_km(DEFAULT_BUFFER_KM).contains(
        lon=upstream.lon, lat=upstream.lat
    )


def test_clip_is_lazy() -> None:
    """A national day is millions of rows; the clip must stream, not materialise."""

    window = window_for_acquisition(ACQUIRED)

    def _explode():
        yield _record(28.9, -90.0, ACQUIRED)
        raise AssertionError("consumed past the first record")

    result = clip_records(_explode(), bbox=GULF_OF_MEXICO, window=window)
    assert next(iter(result)) is not None


def test_gulf_aoi_covers_the_real_case_1_footprint() -> None:
    """Measured from the terrain-corrected Case 1 product on 2026-08-30."""

    for lon, lat in ((-91.1022, 27.9531), (-88.1751, 29.8763)):
        assert GULF_OF_MEXICO.contains(lon=lon, lat=lat)


# --- selecting the daily files a window spans -------------------------------
# A 48 h window starting at 00:02 spans THREE marinecadastre daily files. Loading
# only the acquisition day silently yields ~2 minutes of overlap, which presents
# as "hardly any traffic in the AOI" rather than as an error. Measured on
# 2026-08-30: the Apr 9 file alone gave 2,330 rows; the correct three-file set
# gave 2,955,407.


def test_window_spanning_midnight_needs_every_day_it_touches() -> None:
    from backend.ingest.ais.clip import daily_files_for_window

    window = window_for_acquisition(ACQUIRED)  # 2023-04-07 00:02 .. 2023-04-09 00:02

    assert daily_files_for_window(window) == [
        "AIS_2023_04_07",
        "AIS_2023_04_08",
        "AIS_2023_04_09",
    ]


def test_a_window_inside_one_day_needs_one_file() -> None:
    from backend.ingest.ais.clip import daily_files_for_window

    window = window_for_acquisition(
        datetime(2023, 4, 9, 12, 0, tzinfo=UTC), backward_hours=2
    )

    assert daily_files_for_window(window) == ["AIS_2023_04_09"]


def test_resolving_against_a_directory_reports_missing_days(tmp_path: Path) -> None:
    """A missing day must be named, not quietly under-load the window."""

    from backend.ingest.ais.clip import MissingAisDayError, resolve_daily_files

    (tmp_path / "AIS_2023_04_07.zip").write_text("")
    (tmp_path / "AIS_2023_04_09.zip").write_text("")  # 08 absent

    with pytest.raises(MissingAisDayError, match="AIS_2023_04_08"):
        resolve_daily_files(tmp_path, window_for_acquisition(ACQUIRED))


def test_resolving_returns_paths_in_chronological_order(tmp_path: Path) -> None:
    from backend.ingest.ais.clip import resolve_daily_files

    for day in (7, 8, 9):
        (tmp_path / f"AIS_2023_04_0{day}.zip").write_text("")

    paths = resolve_daily_files(tmp_path, window_for_acquisition(ACQUIRED))

    assert [p.stem for p in paths] == ["AIS_2023_04_07", "AIS_2023_04_08", "AIS_2023_04_09"]
