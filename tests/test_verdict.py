"""The backend verdict is the console's verdict (FUTURE_WORK §2.4, PHASE-03)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.characterize.verdict import (
    EndTarget,
    VerdictInputs,
    haversine_km,
    nearest_end_target,
    verdict_from,
)

FIXTURES = Path(__file__).parent / "fixtures" / "characterise"


def _inputs(raw: dict) -> VerdictInputs:
    target = raw["endTarget"]
    return VerdictInputs(
        elongation=raw["elongation"],
        length_km=raw["lengthKm"],
        width_profile_m=raw["widthProfileM"],
        end_target=None if target is None else EndTarget(
            end=target["end"], distance_km=target["distanceKm"], matched=target["matched"],
            installation=target["installation"]),
        wind_speed_ms=raw["windSpeedMs"],
        wind_gate=raw["windGate"],
        damping_ratio_db=raw["dampingRatioDb"],
        best_vessel_drift=raw["bestVesselDrift"],
    )


CASES = json.loads((FIXTURES / "verdict_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_same_verdict_as_the_console(case):
    v = verdict_from(_inputs(case["inputs"]))
    want = case["expected"]
    assert v.verdict == want["verdict"]
    assert v.support == pytest.approx(want["support"], abs=1e-12)
    assert v.caution == want["caution"]
    for term in v.terms:
        expected = want["terms"][term.key]
        assert (term.value is None) == (expected is None), term.key
        if expected is not None:
            assert term.value == pytest.approx(expected, abs=1e-12), term.key


def test_fixture_covers_every_branch():
    verdicts = {c["expected"]["verdict"] for c in CASES}
    assert verdicts == {"oos", "slick_unknown"}
    assert any(c["expected"]["caution"] for c in CASES), "a wake case"
    assert any(c["inputs"]["endTarget"] is None for c in CASES)
    assert any(c["inputs"]["dampingRatioDb"] is None for c in CASES)
    assert any(c["name"].startswith("scenario ") for c in CASES)


def test_haversine_matches_the_console_sphere():
    assert haversine_km((0.0, 0.0), (0.0, 1.0)) == pytest.approx(111.195, abs=1e-3)
    assert haversine_km((-89.4, 28.6), (-89.4, 28.6)) == 0.0


def test_nearest_end_target_takes_the_closest_end_and_knows_installations():
    head, tail = (-89.40, 28.60), (-89.30, 28.60)
    near_tail = ((-89.299, 28.60), True)
    far = ((-89.60, 28.70), False)
    t = nearest_end_target(head, tail, [far, near_tail])
    assert t is not None and t.end == "tail" and t.matched and not t.installation
    assert t.distance_km == pytest.approx(0.098, abs=0.002)
    on_platform = nearest_end_target(head, tail, [near_tail], installations=[(-89.2995, 28.6)])
    assert on_platform is not None and on_platform.installation
    assert nearest_end_target(head, tail, []) is None
