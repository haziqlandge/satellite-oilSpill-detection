"""The backend attribution engine against the console's, and PHASE-06's own term tests.

Fixtures: `tests/fixtures/scoring/*.json.gz`, written by
`cd frontDemo && npm run export:scoring-fixtures` -- the exact input the
console's `score()` receives for each authored scenario and what it returns
under both S_drift variants.
"""

from __future__ import annotations

import base64
import gzip
import json
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from backend.attribute import features
from backend.attribute.features import Vessel, s_drift, s_parity, s_proximity, s_temporality
from backend.attribute.field import (
    FieldFrame,
    field_agreement,
    frames_from_origin_field,
    mass_table,
)
from backend.attribute.scoring import Characterisation, DriftVariant, ScoringInput, score
from backend.attribute.weights import GATE_THRESHOLD, WEIGHTS

FIXTURES = Path(__file__).parent / "fixtures" / "scoring"
SCENARIOS = ("gom-moving", "gom-berthed", "gom-platform", "kutch-dark", "mumbai-null", "ennore-anchored", "paradip-spm")


def _f64(text: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(text), dtype=np.float64)


def _load(name: str) -> dict[str, Any]:
    fixture: dict[str, Any] = json.loads(gzip.decompress((FIXTURES / name).read_bytes()))
    return fixture


def _frame(raw: dict[str, Any], values: np.ndarray) -> FieldFrame:
    return FieldFrame(
        values=values, nx=raw["nx"], ny=raw["ny"], min_lon=raw["minLon"], min_lat=raw["minLat"],
        d_lon=raw["dLon"], d_lat=raw["dLat"], cell_area_km2=raw["cellAreaKm2"], area90_km2=raw["area90Km2"],
        levels=_f64(raw["table"]["levels"]), mass=_f64(raw["table"]["mass"]),
    )


def _input(fixture: dict[str, Any], variant: DriftVariant) -> ScoringInput:
    raw = fixture["input"]
    frames = {}
    for hour, f in raw["frames"].items():
        values = np.zeros(f["nx"] * f["ny"])
        values[np.frombuffer(base64.b64decode(f["cells"]), dtype=np.int32)] = _f64(f["values"])
        frames[int(hour)] = _frame(f, values)
    vessels = []
    for v in raw["vessels"]:
        columns = [_f64(v[k]).tolist() for k in ("t", "lon", "lat", "sog", "cog")]
        vessels.append(Vessel(
            mmsi=v["mmsi"], label=v["label"], kind=v["kind"], length_m=v["lengthM"], draft_m=v["draftM"],
            points=list(zip(*columns, strict=True)), length_assumed=v["lengthAssumed"], source=v["source"],
        ))
    c = raw["characterisation"]
    return ScoringInput(
        frames=frames,
        characterisation=Characterisation(
            head=tuple(c["head"]), tail=tuple(c["tail"]), length_km=c["lengthKm"], wind_speed_ms=c["windSpeedMs"],
            wind_gate_multiplier=c["windGateMultiplier"], damping_ratio_db=c["dampingRatioDb"],
            head_tail_resolved_by=c["headTailResolvedBy"],
        ),
        acquired_ms=raw["acquiredAt"], backward_hours=raw["drift"]["backwardHours"],
        area90_by_hour=[x["area90Km2"] for x in raw["drift"]["convergence"]],
        vessels=vessels, infrastructure=raw["infrastructure"], dark_targets=raw["darkTargets"],
        variant=variant, truth_id=raw["truthId"], infrastructure_coverage=raw["infrastructureCoverage"],
        drift_insufficient=raw["drift"]["insufficientEvidence"],
    )


def _same(got: Any, want: Any, where: str = "") -> None:
    """Equal, with floats to 1e-9 relative: the last bit of `Math.sin` is the platform's."""
    if isinstance(want, float) or (isinstance(want, int) and isinstance(got, float)):
        assert math.isclose(got, want, rel_tol=1e-9, abs_tol=1e-12), f"{where}: {got!r} != {want!r}"
    elif isinstance(want, dict):
        missing = set(want) - set(got)
        assert not missing, f"{where}: missing {sorted(missing)}"
        for key in want:
            _same(got[key], want[key], f"{where}.{key}")
    elif isinstance(want, list):
        assert len(got) == len(want), f"{where}: length {len(got)} != {len(want)}"
        for i, (g, w) in enumerate(zip(got, want, strict=True)):
            _same(g, w, f"{where}[{i}]")
    else:
        assert got == want, f"{where}: {got!r} != {want!r}"


@pytest.mark.parametrize("variant", ["integral", "max"])
@pytest.mark.parametrize("scenario", SCENARIOS)
def test_backend_scores_every_authored_scenario_exactly_as_the_console(scenario: str, variant: DriftVariant) -> None:
    fixture = _load(f"{scenario}.json.gz")
    want = fixture["expected"][variant]

    got = json.loads(json.dumps(score(_input(fixture, variant))))

    _same(got["gate"]["admitted"], want["gate"]["admitted"], "gate.admitted")
    assert got["gate"]["considered"] + fixture["input"]["vesselsOmitted"] == want["gate"]["considered"]
    assert got["gate"]["reason"] == want["gate"]["reason"]
    _same(got["separability"], want["separability"], "separability")
    _same(got["insufficientEvidence"], want["insufficientEvidence"], "insufficientEvidence")
    _same(got["suspects"], want["suspects"], "suspects")


def test_weights_are_the_consoles() -> None:
    fixture = _load("gom-moving.json.gz")
    suspect = fixture["expected"]["integral"]["suspects"][0]
    assert {t["key"]: t["weight"] for t in suspect["evidence"]["terms"]} == WEIGHTS
    assert math.isclose(sum(WEIGHTS.values()), 1.0)


def test_mass_table_and_sampling_match_the_console_on_a_whole_frame() -> None:
    raw = _load("frame.json.gz")
    frame = _frame(raw, _f64(raw["values"]))
    levels, mass, peak = mass_table(frame.values, frame.cell_area_km2)

    np.testing.assert_allclose(levels, frame.levels, rtol=1e-12)
    np.testing.assert_allclose(mass, frame.mass, rtol=1e-12)
    assert math.isclose(peak, raw["table"]["peak"], rel_tol=1e-12)
    for probe in raw["probes"]:
        got = field_agreement({raw["hour"]: frame}, raw["hour"], *probe["p"])["value"]
        assert math.isclose(got, probe["value"], rel_tol=1e-9, abs_tol=1e-12), probe


# ---- PHASE-06's term tests: bounded, monotonic, sane at degenerate inputs ----

T0 = datetime(2023, 12, 5, tzinfo=UTC)
T0_MS = T0.timestamp() * 1000


def _blob_frames(centre: tuple[float, float], hours: int = 12, area90: float = 25.0) -> dict[int, FieldFrame]:
    """A Gaussian origin field, the same at every hour, peaked on `centre`."""
    n = 64
    step = 0.01
    xs = centre[0] + (np.arange(n) - n / 2) * step
    ys = centre[1] + (np.arange(n) - n / 2) * step
    gx, gy = np.meshgrid(xs, ys)
    values = np.exp(-(((gx - centre[0]) / 0.05) ** 2 + ((gy - centre[1]) / 0.05) ** 2)).ravel()
    cell = step * 111.0 * step * 111.0
    levels, mass, _ = mass_table(values, cell)
    frame = FieldFrame(values=values, nx=n, ny=n, min_lon=float(xs[0]), min_lat=float(ys[0]), d_lon=step,
                       d_lat=step, cell_area_km2=cell, area90_km2=area90, levels=levels, mass=mass)
    return {-h: frame for h in range(hours + 1)}


def _vessel(points: list[tuple[float, float]], mmsi: str = "1", sog: float = 10.0,
            cadence_min: float = 10.0) -> Vessel:
    n = len(points)
    return Vessel(mmsi=mmsi, label=mmsi, kind="Tanker", length_m=180, draft_m=0, points=[
        (T0_MS - (n - 1 - i) * cadence_min * 60_000, lon, lat, sog, 90.0) for i, (lon, lat) in enumerate(points)
    ])


def test_proximity_decays_as_exp_minus_d_over_four() -> None:
    head = (-89.0, 29.0)
    for km in (0.0, 1.0, 4.0, 10.0):
        east = head[0] + km / features.km_per_deg_lon(head[1])
        value, measured, _ = s_proximity(head, [(east, head[1]), (east, head[1] + 0.001)])
        assert math.isclose(measured, km, abs_tol=1e-9)
        assert math.isclose(value, math.exp(-km / 4.0), rel_tol=1e-9)
    assert s_proximity(head, []) == (0.0, math.inf, 0)


def test_terms_are_bounded_monotonic_and_sane_when_degenerate() -> None:
    centre = (-89.0, 29.0)
    frames = _blob_frames(centre)
    near = s_drift(_vessel([centre] * 4), frames, T0_MS, 12)
    far = s_drift(_vessel([(centre[0] + 0.1, centre[1])] * 4), frames, T0_MS, 12)
    assert 0 <= far.max < near.max <= 1 and 0 <= near.integral <= near.max
    # Lingering raises the integral, never the max.
    linger = s_drift(_vessel([centre] * 40), frames, T0_MS, 12)
    assert linger.max == near.max and linger.integral > near.integral
    # A track wholly outside the window scores nothing; one point is not an error.
    stale = _vessel([centre])
    stale.points = [(T0_MS - 30 * 3_600_000, *centre, 0.0, 0.0)]
    assert s_drift(stale, frames, T0_MS, 12).integral == 0
    assert s_drift(_vessel([centre]), frames, T0_MS, 12).max > 0
    # An empty field agrees with nothing.
    assert field_agreement({}, 0, *centre)["value"] == 0

    head, tail = (-89.0, 29.0), (-88.9, 29.0)
    along = s_parity(head, tail, [head, tail], 9.7)[0]
    across = s_parity(head, tail, [head, (head[0], head[1] + 0.09)], 9.7)[0]
    assert 0 <= across < along <= 1
    assert s_parity(head, tail, [head], 9.7)[0] == 0 and s_parity(head, tail, [head, head], 9.7)[0] == 0

    temporal = [s_temporality(h, 24) for h in (0, 3, 12, 24)]
    assert temporal == sorted(temporal, reverse=True) and temporal[0] == 1 and s_temporality(math.inf, 24) == 0


def _characterisation(head: tuple[float, float], wind_gate: float = 1.0) -> Characterisation:
    return Characterisation(head=head, tail=(head[0] + 0.05, head[1]), length_km=4.9, wind_speed_ms=6.0,
                            wind_gate_multiplier=wind_gate, damping_ratio_db=-5.0)


def test_gate_admits_exactly_the_tracks_that_were_inside_the_field() -> None:
    centre = (-89.0, 29.0)
    through = _vessel([(centre[0] - 0.2 + 0.02 * i, centre[1]) for i in range(21)], "through")
    beside = _vessel([(centre[0] - 0.2 + 0.02 * i, centre[1] + 0.3) for i in range(21)], "beside")
    too_early = _vessel([centre] * 3, "early")
    too_early.points = [(T0_MS - 20 * 3_600_000 + i, *centre, 0.0, 0.0) for i in range(3)]
    result = score(ScoringInput(
        frames=_blob_frames(centre), characterisation=_characterisation(centre), acquired_ms=T0_MS,
        backward_hours=12, area90_by_hour=[25.0], vessels=[through, beside, too_early],
    ))
    assert result["gate"]["considered"] == 3 and result["gate"]["admitted"] == 1
    assert [s["id"] for s in result["suspects"]] == ["through"]


def test_every_suspect_carries_six_terms_with_weights_and_geometry() -> None:
    centre = (-89.0, 29.0)
    result = score(ScoringInput(
        frames=_blob_frames(centre), characterisation=_characterisation(centre), acquired_ms=T0_MS,
        backward_hours=12, area90_by_hour=[25.0],
        vessels=[_vessel([(centre[0] - 0.1 + 0.01 * i, centre[1]) for i in range(21)], "v")],
        infrastructure=[{"id": "p1", "label": "Platform", "position": [centre[0] + 0.01, centre[1]]}],
        dark_targets=[{"id": "dark-01", "position": [centre[0], centre[1] + 0.01], "lengthM": 60}],
    ))
    kinds = {s["kind"] for s in result["suspects"]}
    assert kinds == {"ais_vessel", "infrastructure", "dark_vessel"}
    for suspect in result["suspects"]:
        assert set(suspect["terms"]) == set(WEIGHTS)
        assert [t["key"] for t in suspect["evidence"]["terms"]] == list(WEIGHTS)
        assert all(0 <= v <= 1 for v in suspect["terms"].values())
        assert all(t["weight"] == WEIGHTS[t["key"]] for t in suspect["evidence"]["terms"])
        assert suspect["evidence"]["terms"][0]["geometry"]  # S_drift names where it was measured
    dark = next(s for s in result["suspects"] if s["kind"] == "dark_vessel")
    assert dark["label"] == "Unlit contact"  # ranked, never named


def test_a_diffuse_field_or_a_calm_sea_refuses_to_rank() -> None:
    centre = (-89.0, 29.0)
    vessel = _vessel([centre] * 20, "v")
    diffuse = {"area90Km2": 900.0, "reason": "the field is too wide to discriminate"}
    refused = score(ScoringInput(
        frames=_blob_frames(centre), characterisation=_characterisation(centre), acquired_ms=T0_MS,
        backward_hours=12, area90_by_hour=[900.0], vessels=[vessel], drift_insufficient=diffuse,
    ))
    assert refused["insufficientEvidence"] == diffuse
    calm = score(ScoringInput(
        frames=_blob_frames(centre), characterisation=_characterisation(centre, wind_gate=0.0), acquired_ms=T0_MS,
        backward_hours=12, area90_by_hour=[25.0], vessels=[vessel],
    ))
    assert "gate multiplier at 0.00" in calm["insufficientEvidence"]["reason"]
    assert all(s["total"] == 0 for s in calm["suspects"])
    nobody = score(ScoringInput(
        frames=_blob_frames(centre), characterisation=_characterisation(centre), acquired_ms=T0_MS,
        backward_hours=12, area90_by_hour=[25.0], vessels=[],
    ))
    assert nobody["insufficientEvidence"]["reason"].startswith("No candidate intersected")


def test_the_backend_origin_field_scores_like_any_other() -> None:
    """`frames_from_origin_field`: a backward OpenDrift-shaped field gates and ranks the vessel in it."""
    from backend.drift.origin_field import build_origin_field

    rng = np.random.default_rng(0)
    centre = (-89.0, 29.0)
    times = tuple(T0 - timedelta(hours=h) for h in range(13))  # descending, as a backward run's
    lon = centre[0] + rng.normal(0, 0.02, (13, 2000))
    lat = centre[1] + rng.normal(0, 0.02, (13, 2000))
    frames = frames_from_origin_field(build_origin_field(lon, lat, times), T0)

    assert sorted(frames) == list(range(-12, 1))
    assert 0 < frames[0].area90_km2 < 100
    inside = _vessel([centre] * 30, "inside")
    outside = _vessel([(centre[0] + 0.5, centre[1])] * 30, "outside")
    result = score(ScoringInput(
        frames=frames, characterisation=_characterisation(centre), acquired_ms=T0_MS, backward_hours=12,
        area90_by_hour=[f.area90_km2 for f in frames.values()], vessels=[inside, outside],
    ))
    assert [s["id"] for s in result["suspects"]] == ["inside"]
    assert result["suspects"][0]["terms"]["drift"] >= GATE_THRESHOLD


# ---- the live pipeline's candidates (backend/attribute/candidates.py) ----------


@pytest.mark.parametrize("scenario", ["gom-moving", "gom-berthed", "gom-platform"])
def test_real_ais_is_resampled_exactly_as_the_console_does(scenario: str) -> None:
    """`to_vessel` against the tracks the console scored, from the same tracked AIS file."""
    from backend.attribute.candidates import vessels_from_traffic

    traffic = json.loads((Path(__file__).parents[1] / "frontDemo/public/ais" / f"{scenario}.json").read_text())
    ours = {v.mmsi: v for v in vessels_from_traffic(traffic)}
    stored = _input(_load(f"{scenario}.json.gz"), "integral").vessels
    assert stored
    for theirs in stored:
        mine = ours[theirs.mmsi]
        assert (mine.label, mine.kind, mine.length_m, mine.draft_m, mine.length_assumed, mine.source) == (
            theirs.label, theirs.kind, theirs.length_m, theirs.draft_m, theirs.length_assumed, theirs.source)
        np.testing.assert_allclose(np.array(mine.points), np.array(theirs.points), rtol=1e-12, atol=1e-9)


def test_a_live_run_becomes_a_scoring_input() -> None:
    """`attribution_input`: the run's own field, seed, frames and AIS, on one clock (naive UTC, X10)."""
    from backend.attribute.candidates import attribution_input
    from backend.drift.origin_field import build_origin_field

    rng = np.random.default_rng(1)
    acquired = datetime(2023, 12, 5, 0, 2, 14)  # naive UTC, as the pipeline holds it
    centre = (-89.0, 29.0)
    times = tuple(acquired - timedelta(hours=h) for h in range(7))
    origin = build_origin_field(centre[0] + rng.normal(0, 0.02, (7, 500)), centre[1] + rng.normal(0, 0.02, (7, 500)),
                                times)
    seconds = list(range(-6 * 3600, 1, 300))
    traffic = {"acquiredAt": "2023-12-05T00:02:14Z", "vessels": [{
        "id": "367000001", "kind": "Tanker", "lengthM": None, "draftM": None, "breaks": [], "t": seconds,
        "lon": [centre[0]] * len(seconds), "lat": [centre[1]] * len(seconds),
        "sog": [0.0] * len(seconds), "cog": [0.0] * len(seconds)}]}
    character = {"head": list(centre), "tail": [centre[0] + 0.05, centre[1]], "lengthKm": 4.9, "windSpeedMs": 6.2,
                 "windGateMultiplier": 1.0, "dampingRatioDb": -4.2, "headTailResolvedBy": "ambiguous"}
    payload = {"frames": [{"hour": -h, "area90Km2": 20.0 + h} for h in range(7)] + [{"hour": 3, "area90Km2": 99.0}]}

    inp = attribution_input(field=origin, acquired=acquired, character=character, payload=payload, traffic=traffic,
                            backward_hours=6)

    assert inp.acquired_ms == datetime(2023, 12, 5, 0, 2, 14, tzinfo=UTC).timestamp() * 1000
    assert sorted(inp.frames) == list(range(-6, 1)) and inp.area90_by_hour == [20.0 + h for h in range(7)]
    vessel = inp.vessels[0]
    assert vessel.label == "MMSI 367•••••1" and vessel.length_m == 180 and vessel.length_assumed
    assert vessel.points[-1][0] == inp.acquired_ms  # the last report is at the pass
    result = score(inp)
    assert result["gate"]["admitted"] == 1 and result["suspects"][0]["kind"] == "ais_vessel"
    assert not any(s["kind"] == "dark_vessel" for s in result["suspects"])  # CFAR returns are not ranked here
