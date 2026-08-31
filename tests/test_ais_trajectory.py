"""Tests for time-aware AIS trajectory construction."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from backend.ingest.ais.loader import AisRecord
from backend.ingest.ais.trajectory import build_trajectories


def _record(
    *, mmsi: int = 123456789, minutes: int = 0, lon: float = -90.0, name: str | None = "TEST"
) -> AisRecord:
    return AisRecord(
        mmsi=mmsi,
        base_date_time=datetime(2023, 5, 15, tzinfo=UTC) + timedelta(minutes=minutes),
        lat=29.0,
        lon=lon,
        sog=8.0,
        cog=90.0,
        heading=90.0,
        vessel_name=name,
        imo=None,
        call_sign=None,
        vessel_type=70,
        status=0,
        length=None,
        width=None,
        draft=None,
        cargo=None,
        transceiver_class="A",
    )


def test_build_trajectories_sorts_points_and_preserves_epoch_m() -> None:
    later = _record(minutes=10, lon=-89.9)
    first = _record(minutes=0, lon=-90.0)

    trajectory = build_trajectories([later, first])[0]

    assert trajectory.started_at == first.base_date_time
    assert trajectory.ended_at == later.base_date_time
    assert trajectory.points == (first, later)
    assert trajectory.ewkt == (
        "SRID=4326;LINESTRING M (-90.00000000 29.00000000 1684108800.000, "
        "-89.90000000 29.00000000 1684109400.000)"
    )


def test_build_trajectories_excludes_singletons_and_retains_vessel_name() -> None:
    first = _record(mmsi=111111111, name=None)
    second = _record(mmsi=111111111, minutes=1, lon=-89.99, name="LATER NAME")
    singleton = _record(mmsi=222222222)

    trajectories = build_trajectories([singleton, first, second])

    assert len(trajectories) == 1
    assert trajectories[0].mmsi == 111111111
    assert trajectories[0].vessel_name == "LATER NAME"
    assert trajectories[0].as_db_values()["source"] == "real"


def test_build_trajectories_rejects_invalid_source_and_line_size() -> None:
    with pytest.raises(ValueError, match="source"):
        build_trajectories([], source="unknown")
    with pytest.raises(ValueError, match="min_points"):
        build_trajectories([], min_points=1)
