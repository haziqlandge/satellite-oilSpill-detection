"""Per-track behavioural features (PHASE-05).

These feed the PHASE-06 scorer, whose output is an accusation, so **C4 applies**:
every feature is a named, inspectable quantity with the geometry that produced
it. There is deliberately no single opaque "anomaly score" here -- P003's
Isolation Forest is a later, additional signal, not a replacement for features a
human can read.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from backend.ingest.ais.behaviour import (
    LOITER_SOG_KNOTS,
    TrackBehaviour,
    course_deviation_deg,
    derived_rot_deg_per_min,
    describe,
    loiter_fraction,
    speed_drop_knots,
)
from backend.ingest.ais.loader import AisRecord

START = datetime(2023, 12, 3, 12, 0, tzinfo=UTC)


def _track(
    sogs: list[float],
    *,
    cogs: list[float] | None = None,
    step_minutes: int = 1,
    draft: float | None = 5.0,
) -> list[AisRecord]:
    cogs = cogs or [90.0] * len(sogs)
    return [
        AisRecord(
            mmsi=367000001,
            base_date_time=START + timedelta(minutes=index * step_minutes),
            lat=29.0 + index * 0.0001,
            lon=-90.0 + index * 0.0001,
            sog=sog,
            cog=cog,
            heading=cog,
            vessel_name="TEST VESSEL",
            imo=None,
            call_sign=None,
            vessel_type=80,
            status=None,
            length=100.0,
            width=20.0,
            draft=draft,
            cargo=None,
            transceiver_class="A",
        )
        for index, (sog, cog) in enumerate(zip(sogs, cogs, strict=True))
    ]


# --- individual features ----------------------------------------------------


def test_speed_drop_measures_the_largest_deceleration() -> None:
    assert speed_drop_knots(_track([12.0, 11.0, 3.0, 2.5])) == pytest.approx(8.0)


def test_speed_drop_is_zero_for_a_steady_transit() -> None:
    assert speed_drop_knots(_track([10.0, 10.0, 10.0])) == pytest.approx(0.0)


def test_speed_drop_ignores_acceleration() -> None:
    """Speeding up is not the discharge signature; only the drop counts."""

    assert speed_drop_knots(_track([2.0, 12.0])) == pytest.approx(0.0)


def test_course_deviation_takes_the_shorter_way_round_the_compass() -> None:
    """350 deg -> 10 deg is a 20 deg turn, not 340."""

    assert course_deviation_deg(_track([8.0, 8.0], cogs=[350.0, 10.0])) == pytest.approx(20.0)


def test_course_deviation_of_a_straight_run_is_zero() -> None:
    assert course_deviation_deg(_track([8.0, 8.0, 8.0])) == pytest.approx(0.0)


def test_rot_is_derived_from_course_over_time() -> None:
    """marinecadastre carries no ROT column, so it comes from COG and dt."""

    track = _track([8.0, 8.0], cogs=[0.0, 30.0], step_minutes=2)

    assert derived_rot_deg_per_min(track) == pytest.approx(15.0)


def test_loiter_fraction_counts_time_below_the_threshold() -> None:
    track = _track([0.1, 0.1, 0.1, 9.0])

    assert loiter_fraction(track) == pytest.approx(0.75)


def test_a_moving_vessel_does_not_loiter() -> None:
    assert loiter_fraction(_track([9.0, 9.0, 9.0])) == pytest.approx(0.0)


def test_loiter_threshold_is_a_berthing_speed_not_zero() -> None:
    """A moored vessel still reports small non-zero SOG from GPS jitter."""

    assert 0.0 < LOITER_SOG_KNOTS <= 1.0


# --- the aggregate ----------------------------------------------------------


def test_describe_returns_named_terms_not_a_bare_score() -> None:
    """C4: the score must decompose into terms a reviewer can inspect."""

    result = describe(_track([12.0, 1.0, 0.2, 0.2]))

    assert isinstance(result, TrackBehaviour)
    assert result.terms
    assert {"speed_drop_knots", "loiter_fraction", "course_deviation_deg"} <= set(result.terms)
    assert result.reasons


def test_describe_flags_a_berthed_vessel_as_loitering() -> None:
    """The Case 3 signature: BRANDON BORDELON, moored, not transiting."""

    result = describe(_track([0.1] * 30))

    assert result.is_loitering
    assert not result.is_transiting


def test_describe_flags_a_steady_transit_as_transiting() -> None:
    result = describe(_track([11.0] * 30))

    assert result.is_transiting
    assert not result.is_loitering


def test_describe_reports_draught_change() -> None:
    """A draught change across a track is a discharge-adjacent signal."""

    track = _track([8.0, 8.0], draft=5.0)
    deeper = _track([8.0, 8.0], draft=7.5)
    combined = [track[0], deeper[1]]

    assert describe(combined).terms["draught_change_m"] == pytest.approx(2.5)


def test_describe_handles_a_single_point_track() -> None:
    """One message cannot show change; it must not raise."""

    result = describe(_track([5.0]))

    assert result.terms["speed_drop_knots"] == 0.0


def test_describe_tolerates_missing_sog_and_cog() -> None:
    """Provider nulls are common; a None must not propagate into arithmetic."""

    from dataclasses import replace

    track = _track([8.0, 8.0])
    patched = [replace(track[0], sog=None, cog=None), track[1]]

    result = describe(patched)

    assert result.terms["speed_drop_knots"] >= 0.0


def test_describe_is_empty_safe() -> None:
    result = describe([])

    assert result.terms["speed_drop_knots"] == 0.0
    assert not result.is_loitering


# --- what actually gets persisted ------------------------------------------


def test_the_storage_payload_is_json_safe() -> None:
    """It goes into a JSONB column, so it must survive a round trip.

    A dataclass or a numpy float here would insert fine through some drivers and
    fail through others, which is the worst kind of bug to find in an ingest
    that takes three minutes to reach the write.
    """

    import json

    from backend.ingest.ais.behaviour import as_storage_payload

    payload = as_storage_payload(_track([0.1] * 40))

    assert json.loads(json.dumps(payload)) == payload


def test_the_storage_payload_carries_the_loitering_verdict() -> None:
    """PHASE-05: BRANDON BORDELON's mooring must be visible *in the database*.

    Caught by the integration test, which found tracks that were queryable but
    stored `{}` -- so PHASE-06 would have had no behavioural signal to read.
    """

    from backend.ingest.ais.behaviour import as_storage_payload

    payload = as_storage_payload(_track([0.1] * 40))

    assert payload["is_loitering"] is True
    assert payload["terms"]
    assert payload["reasons"]


def test_the_storage_payload_surfaces_gap_evidence_with_its_caveat() -> None:
    """C7: the raw gap and the expected rate must travel together.

    A silence figure without the cadence it is judged against invites reading an
    ordinary coverage gap as evasion.
    """

    from backend.ingest.ais.behaviour import as_storage_payload

    reception = as_storage_payload(_track([0.1] * 40))["reception"]

    assert "silent_fraction" in reception
    assert "median_interval_s" in reception
    assert "gap_evidence_usable" in reception
    assert reception["explanation"]
