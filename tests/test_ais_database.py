"""PHASE-05's acceptance criteria, asserted against the real database.

The behaviour and gap modules are unit-tested elsewhere against fixtures. What
was **not** covered until now is the half of PHASE-05 that is database-shaped:
"`BOCHEM LONDON` queryable by name", "`BRANDON BORDELON` queryable and its
mooring visible", and "spatiotemporal query over a full fixture day returns in
< 2 s". Those cannot be shown by a unit test — they need rows in `ais_tracks`.

Marked `integration`: they skip cleanly when the database is unreachable or has
not been ingested, so CI without a database still passes rather than failing
misleadingly. Populate with:

    .venv/Scripts/python.exe scripts/ingest_ais_fixture.py --case 2 --insert
    .venv/Scripts/python.exe scripts/ingest_ais_fixture.py --case 3 --insert
"""

from __future__ import annotations

import time

import pytest
from sqlalchemy import func, select, text

from backend.db.models import AisTrack
from backend.db.session import get_engine, session_scope

pytestmark = pytest.mark.integration


def _track_count() -> int:
    try:
        with session_scope() as session:
            return int(session.scalar(select(func.count()).select_from(AisTrack)) or 0)
    except Exception:
        return -1


@pytest.fixture(scope="module", autouse=True)
def _require_ingested_tracks() -> None:
    count = _track_count()
    if count < 0:
        pytest.skip("database unreachable")
    if count == 0:
        pytest.skip("ais_tracks is empty; run scripts/ingest_ais_fixture.py --insert")


def test_bochem_london_is_queryable_by_name() -> None:
    """PHASE-05 acceptance: the Case 2 vessel, found by name, not by MMSI.

    Querying by name is the criterion because that is what an operator has --
    P004 names the vessel, it does not give the MMSI.
    """

    with session_scope() as session:
        track = session.scalar(select(AisTrack).where(AisTrack.vessel_name.ilike("%BOCHEM LONDON%")))

    assert track is not None, "BOCHEM LONDON not in ais_tracks -- ingest case 2"
    assert track.mmsi == 477636500
    assert track.started_at < track.ended_at


def test_brandon_bordelon_is_queryable_and_reads_as_loitering() -> None:
    """PHASE-05 acceptance: the Case 3 vessel, and its berth must be visible.

    Case 3 is the adversarial fixture -- the vessel was moored from 3 Dec while
    the slick was imaged on the 5th. If the stored behaviour does not record it
    as loitering, the attribution engine has nothing to work with.
    """

    with session_scope() as session:
        track = session.scalar(
            select(AisTrack).where(AisTrack.vessel_name.ilike("%BRANDON BORDELON%"))
        )

    assert track is not None, "BRANDON BORDELON not in ais_tracks -- ingest case 3"
    assert track.mmsi == 367697440
    assert track.behaviour, "behaviour must be stored, not recomputed at query time"
    assert track.behaviour.get("is_loitering") is True


def test_a_track_carries_time_in_the_m_ordinate() -> None:
    """LINESTRING M is what makes the spatiotemporal gate one PostGIS call.

    A track stored as plain LINESTRING would force a separate time join and the
    < 2 s criterion below would not hold.
    """

    with session_scope() as session:
        geom_type = session.scalar(
            text("SELECT GeometryType(geom) FROM ais_tracks WHERE geom IS NOT NULL LIMIT 1")
        )

    assert geom_type is not None
    assert "M" in geom_type.upper(), f"expected a measured geometry, got {geom_type}"


def test_a_spatiotemporal_query_returns_within_two_seconds() -> None:
    """PHASE-05 acceptance, and the query PHASE-06 runs per detection.

    A bounding box plus a time window, which is the shape of the drift-field
    gate. Timed on a warm connection; the criterion is about the index being
    usable, not about cold-start latency.
    """

    query = text(
        """
        SELECT count(*) FROM ais_tracks
        WHERE geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)
          AND started_at <= :end AND ended_at >= :start
        """
    )
    params = {
        "west": -91.2,
        "south": 28.0,
        "east": -88.1,
        "north": 29.9,
        "start": "2023-05-13 00:00:00+00",
        "end": "2023-05-15 01:00:00+00",
    }

    with get_engine().connect() as connection:
        connection.execute(query, params)  # warm the plan
        started = time.perf_counter()
        matched = connection.execute(query, params).scalar()
        elapsed = time.perf_counter() - started

    assert matched is not None
    assert elapsed < 2.0, f"spatiotemporal query took {elapsed:.2f} s, criterion is < 2 s"


def test_only_tracks_are_stored_not_points() -> None:
    """The storage decision recorded in CONSTRAINTS.md.

    Measured for Case 2: 2,234 tracks (~70 MB) against 3,044,735 point rows
    (~726 MB with indexes) -- against a 500 MB free-tier ceiling. If a later
    change starts writing `ais_points` for real AIS, this catches it before the
    dashboard does.
    """

    with session_scope() as session:
        points = session.scalar(text("SELECT count(*) FROM ais_points"))

    assert points == 0, f"{points} rows in ais_points; real AIS must be stored as tracks only"
