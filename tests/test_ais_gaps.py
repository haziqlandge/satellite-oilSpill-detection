"""AIS gap detection, normalised by expected reception (C7).

C7: **"A raw AIS gap is not evidence -- normalise by expected reception
density."** Reception varies enormously by region and vessel class, and GFW
(Welch et al. 2022) documents legitimate reasons to go dark, piracy avoidance
among them. Treating every silence as intent would manufacture suspects out of
satellite coverage.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from backend.ingest.ais.gaps import (
    ANOMALY_RATIO,
    assess_gaps,
    expected_interval_s,
    find_gaps,
)
from backend.ingest.ais.loader import AisRecord

START = datetime(2023, 12, 3, 12, 0, tzinfo=UTC)


def _base() -> AisRecord:
    return AisRecord(
        mmsi=367697440,
        base_date_time=START,
        lat=29.0,
        lon=-90.0,
        sog=8.0,
        cog=90.0,
        heading=90.0,
        vessel_name="TEST",
        imo=None,
        call_sign=None,
        vessel_type=80,
        status=None,
        length=100.0,
        width=20.0,
        draft=5.0,
        cargo=None,
        transceiver_class="A",
    )


def _track_at(minutes: list[float]) -> list[AisRecord]:
    base = _base()
    return [replace(base, base_date_time=START + timedelta(minutes=m)) for m in minutes]


# --- expected reception -----------------------------------------------------


def test_expected_interval_is_the_vessels_own_typical_cadence() -> None:
    """Every 1 minute -> a 1-minute expectation."""

    track = _track_at([0, 1, 2, 3, 4, 5])

    assert expected_interval_s(track) == pytest.approx(60.0)


def test_expected_interval_uses_the_median_not_the_mean() -> None:
    """One long outage must not inflate the baseline and mask later gaps."""

    track = _track_at([0, 1, 2, 3, 4, 120])

    assert expected_interval_s(track) == pytest.approx(60.0)


def test_expected_interval_of_a_sparse_reporter_is_large() -> None:
    """A vessel in poor coverage legitimately reports every 30 minutes."""

    track = _track_at([0, 30, 60, 90, 120])

    assert expected_interval_s(track) == pytest.approx(1800.0)


# --- finding gaps -----------------------------------------------------------


def test_find_gaps_returns_the_silent_interval() -> None:
    track = _track_at([0, 1, 2, 90, 91])

    gaps = find_gaps(track, min_gap_s=600)

    assert len(gaps) == 1
    assert gaps[0].duration_s == pytest.approx(88 * 60)


def test_a_regular_track_has_no_gaps() -> None:
    assert find_gaps(_track_at([0, 1, 2, 3, 4]), min_gap_s=600) == []


# --- the C7 requirement -----------------------------------------------------


def test_a_gap_explained_by_low_expected_reception_is_not_anomalous() -> None:
    """The test PHASE-05 names explicitly.

    A vessel that normally reports every 30 minutes going quiet for 45 is
    ordinary reception variation, not evidence of anything.
    """

    track = _track_at([0, 30, 60, 90, 135, 165])

    flagged = [a for a in assess_gaps(track) if a.is_anomalous]

    assert flagged == []


def test_the_same_absolute_gap_is_anomalous_for_a_dense_reporter() -> None:
    """45 minutes of silence from a 1-minute reporter is a real anomaly.

    The absolute duration is identical to the case above; only the expectation
    differs. That is exactly what C7 requires.
    """

    track = _track_at([0, 1, 2, 3, 4, 49, 50, 51])

    flagged = [a for a in assess_gaps(track) if a.is_anomalous]

    assert flagged, "a 45x expected-interval silence must be flagged"


def test_every_assessment_carries_the_raw_gap_and_the_expectation() -> None:
    """C7: surface the raw gap AND the expected rate on the evidence card."""

    track = _track_at([0, 1, 2, 3, 4, 60, 61])

    for assessment in assess_gaps(track):
        assert assessment.duration_s > 0
        assert assessment.expected_interval_s > 0
        assert assessment.ratio == pytest.approx(
            assessment.duration_s / assessment.expected_interval_s
        )
        assert assessment.explanation


def test_an_anomalous_gap_is_never_stated_as_intent() -> None:
    """GFW documents legitimate reasons to go dark. The wording must not accuse."""

    track = _track_at([0, 1, 2, 3, 4, 200, 201])

    for assessment in assess_gaps(track):
        lowered = assessment.explanation.lower()
        assert "went dark" not in lowered
        assert "deliberate" not in lowered


def test_anomaly_ratio_is_a_real_multiple_of_the_expectation() -> None:
    assert ANOMALY_RATIO > 1.0


def test_a_short_track_yields_no_assessments() -> None:
    assert assess_gaps(_track_at([0])) == []


# --- reporting rate is state-dependent --------------------------------------
# Found on 2026-08-30 against real data: BRANDON BORDELON (berthed for ~53 h)
# had 57 of 65 gaps flagged against a single whole-track median. That is exactly
# the over-flagging C7 exists to prevent. The AIS Class A standard transmits
# every 2-10 s under way but only about every 3 min at anchor, so one global
# expectation mis-judges any track that both moved and moored.


def _moving(minutes: list[float]) -> list[AisRecord]:
    base = _base()
    return [
        replace(base, base_date_time=START + timedelta(minutes=m), sog=9.0) for m in minutes
    ]


def _moored(minutes: list[float]) -> list[AisRecord]:
    base = _base()
    return [
        replace(base, base_date_time=START + timedelta(minutes=m), sog=0.0) for m in minutes
    ]


def test_a_moored_vessels_slow_cadence_is_not_judged_against_its_underway_rate() -> None:
    """The BRANDON BORDELON case.

    Under way at 1-minute reporting, then moored at 15-minute reporting. The
    moored intervals are normal for a moored vessel and must not be flagged
    merely because the same vessel reported faster while transiting.
    """

    track = _moving([0, 1, 2, 3, 4, 5, 6, 7]) + _moored(
        [20, 35, 50, 65, 80, 95, 110, 125]
    )

    flagged = [a for a in assess_gaps(track) if a.is_anomalous]

    assert flagged == [], f"over-flagged {len(flagged)} ordinary moored intervals"


def test_a_genuine_outage_while_moored_is_still_flagged() -> None:
    """Tolerating the moored cadence must not blind the detector entirely."""

    track = _moving([0, 1, 2, 3]) + _moored([20, 35, 50, 65, 80, 400, 415, 430])

    flagged = [a for a in assess_gaps(track) if a.is_anomalous]

    assert flagged, "a 5-hour silence is anomalous even for a moored vessel"


def test_expected_interval_can_be_scoped_to_a_movement_state() -> None:
    from backend.ingest.ais.gaps import expected_interval_for_state

    track = _moving([0, 1, 2, 3]) + _moored([20, 35, 50, 65])

    assert expected_interval_for_state(track, moored=False) == pytest.approx(60.0)
    assert expected_interval_for_state(track, moored=True) == pytest.approx(900.0)


# --- reception quality gates gap evidence entirely ---------------------------
# The deeper finding from real data (2026-08-30). BRANDON BORDELON reports every
# ~1.17 min when heard, in BOTH states -- so splitting by movement state changed
# nothing -- but is silent 26% of the time across 65 separate gaps of 10-113 min.
# Its median interval describes the cadence *within* a burst, not how often the
# vessel is actually heard. Flagging 57 "anomalies" there manufactures suspicion
# from patchy coverage, which is the precise thing C7 forbids.


def test_a_poorly_heard_vessel_yields_no_gap_evidence() -> None:
    """Bursty reception must disqualify gap evidence, not generate 57 events."""

    from backend.ingest.ais.gaps import reception_quality

    # Heard in 5-message bursts every ~1 min, then silent ~40 min. Repeatedly.
    minutes: list[float] = []
    t = 0.0
    for _ in range(6):
        minutes += [t + i for i in range(5)]
        t += 45.0

    track = _track_at(minutes)

    quality = reception_quality(track)
    assert quality.silent_fraction > 0.5
    assert not quality.gap_evidence_usable

    assert [a for a in assess_gaps(track) if a.is_anomalous] == []


def test_a_well_heard_vessel_still_produces_gap_evidence() -> None:
    """Suppression must not disable the detector for vessels heard reliably."""

    from backend.ingest.ais.gaps import reception_quality

    track = _track_at([float(m) for m in range(0, 300)] + [345.0, 346.0, 347.0])

    quality = reception_quality(track)
    assert quality.gap_evidence_usable

    assert [a for a in assess_gaps(track) if a.is_anomalous]


def test_reception_quality_is_reported_even_when_unusable() -> None:
    """C7: surface the expected rate. A suppressed verdict must say why."""

    from backend.ingest.ais.gaps import reception_quality

    minutes: list[float] = []
    t = 0.0
    for _ in range(6):
        minutes += [t + i for i in range(5)]
        t += 45.0

    quality = reception_quality(_track_at(minutes))

    assert 0.0 <= quality.silent_fraction <= 1.0
    assert quality.explanation
    assert "reception" in quality.explanation.lower()
