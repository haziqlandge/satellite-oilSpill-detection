"""The real-AIS export: simplification that keeps time honest, gaps kept as gaps."""

from __future__ import annotations

import json

import numpy as np
import pytest

from scripts.export_ais_traffic import OUT, SCENES, TOLERANCE_KM, kind_for, segments, simplify


def _sed(t: np.ndarray, x: np.ndarray, y: np.ndarray, kept: np.ndarray) -> float:
    """Worst position error at any original timestamp, interpolating the kept points."""
    return float(np.max(np.hypot(np.interp(t, t[kept], x[kept]) - x, np.interp(t, t[kept], y[kept]) - y)))


def test_straight_constant_speed_run_collapses_to_its_ends() -> None:
    t = np.arange(0, 3600, 60, dtype=float)
    x = t * 0.004
    y = t * 0.001
    assert simplify(t, x, y, TOLERANCE_KM).tolist() == [0, t.size - 1]


def test_a_stop_on_a_straight_line_is_kept() -> None:
    """Path-only Douglas-Peucker would drop this: the path is a straight line.

    The vessel sat still for half the time, so interpolating between the ends
    puts it kilometres from where it actually was at the midpoint. That is
    exactly the error a spatiotemporal gate cannot tolerate.
    """
    t = np.arange(0, 7200, 60, dtype=float)
    x = np.where(t < 3600, t * 0.004, 3600 * 0.004)
    y = np.zeros_like(t)
    kept = simplify(t, x, y, TOLERANCE_KM)
    assert kept.size > 2
    assert _sed(t, x, y, kept) <= TOLERANCE_KM


def test_error_bound_holds_on_a_turning_track() -> None:
    rng = np.random.default_rng(3)
    t = np.cumsum(rng.integers(20, 180, 800)).astype(float)
    heading = np.cumsum(rng.normal(0, 0.05, t.size))
    speed = 0.004 + 0.002 * np.sin(t / 2000)
    dt = np.diff(t, prepend=t[0])
    x = np.cumsum(speed * dt * np.cos(heading))
    y = np.cumsum(speed * dt * np.sin(heading))
    kept = simplify(t, x, y, TOLERANCE_KM)
    assert kept[0] == 0 and kept[-1] == t.size - 1
    assert kept.size < t.size / 3
    assert _sed(t, x, y, kept) <= TOLERANCE_KM + 1e-9


def test_reception_gaps_split_the_track() -> None:
    t = np.array([0, 60, 120, 5000, 5060, 20000])
    assert segments(t, 1800) == [(0, 3), (3, 5), (5, 6)]


@pytest.mark.parametrize(
    ("code", "kind"),
    [(80, "Tanker"), (89, "Tanker"), (70, "Cargo"), (30, "Fishing"), (52, "Tug"), (31, "Tug"),
     (37, "Pleasure craft"), (60, "Passenger"), (55, "Service vessel"), (90, "Other"),
     (None, "Unknown"), (0, "Unknown")],
)
def test_ais_type_codes_map_to_scorer_classes(code: int | None, kind: str) -> None:
    assert kind_for(code) == kind


@pytest.mark.parametrize("scene", sorted(SCENES))
def test_exported_file_withholds_identities(scene: str) -> None:
    path = OUT / f"{scene}.json"
    if not path.exists():
        pytest.skip("run scripts/export_ais_traffic.py first")
    text = path.read_text(encoding="utf-8")
    payload = json.loads(text)
    published = SCENES[scene].published_mmsi
    if published is not None:
        assert str(published) not in text, "a real MMSI reached the static file"
        assert sum(v["published"] for v in payload["vessels"]) == 1
    for vessel in payload["vessels"]:
        assert len(vessel["id"]) == 9 and vessel["id"][3:].isdigit()
        assert vessel["t"] == sorted(vessel["t"])
    for banned in ("BOCHEM", "BORDELON", "vessel_name", "IMO"):
        assert banned not in text
