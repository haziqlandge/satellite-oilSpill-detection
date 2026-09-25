"""Gate, score, collate and explain: the attribution engine (PHASE-06, stages 1, 3 and 4).

The Python twin of the console's `score()` (`frontDemo/src/sim/scoring.ts`),
which the five authored scenarios are accepted on (`check:scenarios`);
`tests/test_attribution.py` holds this to it on every term, total, rank and
line of evidence. Four properties are not stylistic:

  * `S_drift` is the term nothing else in the reviewed literature computes;
    `rankWithoutDrift` is the ablation that makes that claim checkable;
  * the weights are hand-set and printed, never fitted (`weights.py`);
  * a total never travels without its six terms, weights and geometry (C4);
  * a field too diffuse to discriminate, a wind too low to trust the slick, or
    two candidates the weighting cannot separate return insufficient evidence,
    not a forced ranking (C3). Dark contacts are ranked, never named.

Output is plain dicts in the console's own shape (camelCase), because the API
and the console read it as-is.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Literal

from backend.attribute.features import (
    LngLat,
    Vessel,
    behaviour,
    distance_km,
    fixed,
    hour_of,
    js_num,
    js_sum,
    s_drift,
    s_parity,
    s_proximity,
    s_temporality,
    unknown_class_prior,
    vessel_prior,
)
from backend.attribute.field import FieldFrame, field_agreement
from backend.attribute.weights import (
    GATE_THRESHOLD,
    PROXIMITY_LAMBDA_KM,
    SEPARABILITY_FLOOR,
    WEIGHTS,
    WIND_GATE_REFUSE,
)

DriftVariant = Literal["integral", "max"]


@dataclass(slots=True)
class Characterisation:
    """What the scorer reads of the slick (PHASE-03, `backend/characterize`)."""

    head: LngLat
    tail: LngLat
    length_km: float
    wind_speed_ms: float
    wind_gate_multiplier: float
    damping_ratio_db: float
    head_tail_resolved_by: str = "drift_field"


@dataclass(slots=True)
class ScoringInput:
    frames: dict[int, FieldFrame]
    characterisation: Characterisation
    acquired_ms: float
    backward_hours: int
    #: Area of the 90% region at each backward hour; the tightest is what a refusal quotes.
    area90_by_hour: list[float]
    vessels: list[Vessel]
    infrastructure: list[dict[str, Any]] = field(default_factory=list)  # {id, label, position}
    dark_targets: list[dict[str, Any]] = field(default_factory=list)  # {id, position, lengthM}
    variant: DriftVariant = "integral"
    #: The id authored ground truth names (C10); None outside a fixture.
    truth_id: str | None = None
    infrastructure_coverage: Literal["complete", "partial"] = "partial"
    #: The drift run's own refusal, if it already made one (convergence, C3).
    drift_insufficient: dict[str, Any] | None = None


def _fmt_hour(hour: int) -> str:
    return "acquisition" if hour == 0 else f"T{'-' if hour < 0 else '+'}{abs(hour)}h"


def _combine(terms: dict[str, float], wind_gate: float) -> float:
    """Weighted sum, scaled by the wind gate (C9): a confidence multiplier, not a filter."""
    return js_sum(terms[k] * w for k, w in WEIGHTS.items()) * wind_gate


def _combine_without(terms: dict[str, float], drop: str, wind_gate: float) -> float:
    """Renormalised over the remaining weights, so the ablation is a fair comparison."""
    keys = [k for k in WEIGHTS if k != drop]
    return js_sum(terms[k] * WEIGHTS[k] for k in keys) / js_sum(WEIGHTS[k] for k in keys) * wind_gate


def _base_caveats(inp: ScoringInput) -> list[str]:
    c = inp.characterisation
    out = []
    if c.wind_gate_multiplier < 0.75:
        out.append(f"Wind {fixed(c.wind_speed_ms, 1)} m/s at the detection centroid. Gate multiplier "
                   f"{fixed(c.wind_gate_multiplier, 2)}, so this detection carries reduced confidence.")
    if c.head_tail_resolved_by == "ambiguous":
        out.append("Head and tail could not be separated from geometry alone. Proximity was computed against both "
                   "ends and the better is reported.")
    out.append(f"Damping ratio {fixed(c.damping_ratio_db, 1)} dB is a relative contrast index. It is not a thickness "
               "and no volume follows from it.")
    out.append("Forcing resolution is coarser than the slick. That widens the origin field and is reflected in the "
               "interval, not hidden.")
    return out


def _term(key: str, value: float, detail: str, geometry: Any) -> dict[str, Any]:
    return {"key": key, "value": value, "weight": WEIGHTS[key], "detail": detail, "geometry": geometry}


def _row(kind: str, cid: str, label: str, detail: str, terms: dict[str, float], inp: ScoringInput,
         track: list[LngLat] | None, position: LngLat, evidence: dict[str, Any]) -> dict[str, Any]:
    gate = inp.characterisation.wind_gate_multiplier
    return {
        "id": cid, "kind": kind, "label": label, "detail": detail,
        "total": _combine(terms, gate), "rank": 0, "terms": terms, "weights": dict(WEIGHTS),
        "totalWithoutDrift": _combine_without(terms, "drift", gate), "rankWithoutDrift": 0,
        "isTruth": inp.truth_id == cid, "track": track, "position": position, "evidence": evidence,
    }


def _origin_window(inp: ScoringInput) -> list[float]:
    return [inp.acquired_ms - inp.backward_hours * 3_600_000, inp.acquired_ms]


def _matched_segment(vessel: Vessel, inp: ScoringInput) -> list[LngLat] | None:
    """The stretch of track that sat inside the field."""
    seg = []
    for t, lon, lat, _, _ in vessel.points:
        hour = hour_of(t, inp.acquired_ms)
        if hour > 0 or hour < -inp.backward_hours:
            continue
        if field_agreement(inp.frames, hour, lon, lat)["value"] >= GATE_THRESHOLD:
            seg.append((lon, lat))
    return seg if len(seg) >= 2 else [seg[0], seg[0]] if seg else None


def _score_vessel(vessel: Vessel, inp: ScoringInput) -> dict[str, Any]:
    c = inp.characterisation
    track = vessel.path()
    drift = s_drift(vessel, inp.frames, inp.acquired_ms, inp.backward_hours)
    drift_value = drift.max if inp.variant == "max" else drift.integral
    prox, prox_km, prox_index = s_proximity(c.head, track)
    parity, projected, alignment = s_parity(c.head, c.tail, track, c.length_km)
    nearest = abs(drift.best_hour)
    temporality = s_temporality(nearest, inp.backward_hours)
    beh, flags = behaviour(vessel, inp.acquired_ms)
    prior = vessel_prior(vessel.kind, vessel.length_m)
    terms = {"drift": drift_value, "proximity": prox, "parity": parity, "temporality": temporality,
             "behaviour": beh, "prior": prior}
    matched = _matched_segment(vessel, inp)
    dwell = f" It stayed inside the field for {fixed(drift.dwell_hours, 1)} h of the window." \
        if inp.variant == "integral" else ""
    explanations = [
        _term("drift", drift_value,
              f"At {_fmt_hour(drift.best_hour)} this track sat inside the {fixed(drift.best['credibleRegionPct'], 0)}% "
              f"credible region of the origin field, which covered {fixed(drift.best['area90Km2'], 0)} km2 at that "
              f"hour.{dwell}", matched),
        _term("proximity", prox,
              f"Slick head {fixed(prox_km, 2)} km from the nearest track point. Decay "
              f"exp(-d/{fixed(PROXIMITY_LAMBDA_KM, 1)}).",
              [c.head, track[prox_index] if prox_index < len(track) else c.head]),
        _term("parity", parity,
              "Track projects nothing onto the slick axis. A stationary vessel cannot satisfy this term, and a low "
              "value here is not exculpatory." if projected < 0.2 else
              f"Local track projects {fixed(projected, 1)} km onto a {fixed(c.length_km, 1)} km slick axis, "
              f"{fixed(alignment, 0)} degrees off it.",
              [c.head, c.tail]),
        _term("temporality", temporality, f"Closest field agreement {fixed(nearest, 0)} h before acquisition.", None),
        _term("behaviour", beh,
              f"{len(flags)} rule-based flag{'s' if len(flags) > 1 else ''}, each with its raw series." if flags
              else "No behavioural flag raised on this track.", None),
        _term("prior", prior,
              f"{vessel.kind}, {js_num(vessel.length_m)} m"
              f"{' (length not reported; typical for the class)' if vessel.length_assumed else ''}"
              f"{f', {js_num(vessel.draft_m)} m draught' if vessel.draft_m > 0 else ', draught not reported'}.", None),
    ]
    caveats = _base_caveats(inp)
    if any(f["code"] == "reception_gap" for f in flags):
        caveats.append("A reception gap appears in this track. Gaps are normalised against expected reception "
                       "density before they count, and the raw series is on the card.")
    if inp.infrastructure_coverage == "partial":
        caveats.append("Infrastructure coverage for this AOI is partial. A missing installation would inflate every "
                       "vessel score here.")
    recorded = " · recorded AIS track" if vessel.source == "real" else " · simulated track"
    return _row("ais_vessel", vessel.mmsi, vessel.label, f"{vessel.kind}, {js_num(vessel.length_m)} m{recorded}",
                terms, inp, track, track[-1], {
                    "terms": explanations, "matchedSegment": matched, "originWindow": _origin_window(inp),
                    "originOverlap": matched, "anomalies": flags, "caveats": caveats,
                })


def _best_hour(inp: ScoringInput, position: LngLat) -> tuple[float, int, dict[str, float]]:
    """A fixed position is present at every hour: sweep the window, keep the best."""
    peak, best_hour = 0.0, 0
    best = field_agreement(inp.frames, 0, *position)
    for h in range(-inp.backward_hours, 1):
        agreement = field_agreement(inp.frames, h, *position)
        if agreement["value"] > peak:
            peak, best, best_hour = agreement["value"], agreement, h
    return peak, best_hour, best


def _score_infrastructure(infra: dict[str, Any], inp: ScoringInput) -> dict[str, Any]:
    head = inp.characterisation.head
    position = tuple(infra["position"])
    peak, best_hour, best = _best_hour(inp, position)
    km = distance_km(head, position)
    proximity = math.exp(-km / PROXIMITY_LAMBDA_KM)
    temporality = s_temporality(abs(best_hour), inp.backward_hours)
    # A platform has no track: parity and behaviour are inapplicable, reported as
    # zero and stated as such so they cannot be read as a score against it.
    terms = {"drift": peak, "proximity": proximity, "parity": 0.0, "temporality": temporality, "behaviour": 0.0,
             "prior": 0.86}
    explanations = [
        _term("drift", peak, f"At {_fmt_hour(best_hour)} the origin field placed this installation inside its "
                             f"{fixed(best['credibleRegionPct'], 0)}% credible region, over "
                             f"{fixed(best['area90Km2'], 0)} km2.", [position]),
        _term("proximity", proximity, f"Slick head {fixed(km, 2)} km from the installation.", [head, position]),
        _term("parity", 0.0, "Not applicable. Fixed infrastructure has no track to be parallel to.", None),
        _term("temporality", temporality, f"Present at every timestep. Best field agreement "
                                          f"{fixed(abs(best_hour), 0)} h before acquisition.", None),
        _term("behaviour", 0.0, "Not applicable to fixed infrastructure.", None),
        _term("prior", 0.86, "Production platform. Leak and routine discharge are both plausible.", None),
    ]
    coverage = ("Infrastructure coverage for this AOI is partial. A missing installation would push its share of "
                "the score onto vessels." if inp.infrastructure_coverage == "partial" else
                "Infrastructure coverage for this AOI is complete in the reference dataset.")
    return _row("infrastructure", infra["id"], infra["label"], "Fixed installation", terms, inp, None, position, {
        "terms": explanations, "matchedSegment": None, "originWindow": _origin_window(inp),
        "originOverlap": [position], "anomalies": [], "caveats": [coverage, *_base_caveats(inp)],
    })


def _score_dark(dark: dict[str, Any], inp: ScoringInput) -> dict[str, Any]:
    """A radar contact with no AIS: the same fixed-point sweep an installation gets. Never named."""
    head = inp.characterisation.head
    position = tuple(dark["position"])
    length = dark["lengthM"]
    peak, best_hour, best = _best_hour(inp, position)
    km = distance_km(head, position)
    proximity = math.exp(-km / PROXIMITY_LAMBDA_KM)
    prior = unknown_class_prior(length)
    terms = {"drift": peak, "proximity": proximity, "parity": 0.0, "temporality": 1.0, "behaviour": 0.45,
             "prior": prior}
    explanations = [
        _term("drift", peak, f"At {_fmt_hour(best_hour)} the origin field placed this contact inside its "
                             f"{fixed(best['credibleRegionPct'], 0)}% credible region, over "
                             f"{fixed(best['area90Km2'], 0)} km2. Without a track this is the field tested against "
                             "one fixed position, the same treatment an installation gets.", [position]),
        _term("proximity", proximity, f"Slick head {fixed(km, 2)} km from the radar contact.", [head, position]),
        _term("parity", 0.0, "Unavailable. No AIS track exists for this contact.", None),
        _term("temporality", 1.0, "Contact detected in the acquisition itself.", None),
        _term("behaviour", 0.45, "Absence of AIS is scored against the regional reception expectation, not as a raw "
                                 "gap. It is suggestive, not conclusive.", None),
        _term("prior", prior, f"Radar-estimated length {js_num(length)} m. Vessel class unknown, so the class term "
                              "is the mean over the classes that length admits rather than a size-only score.", None),
    ]
    return _row("dark_vessel", dark["id"], "Unlit contact", f"Radar bright target, {js_num(length)} m estimated",
                terms, inp, None, position, {
                    "terms": explanations, "matchedSegment": None, "originWindow": _origin_window(inp),
                    "originOverlap": [position],
                    "anomalies": [{
                        "code": "no_ais", "label": "No AIS association",
                        "detail": "Radar bright target with no AIS report within the matching tolerance. Reception "
                                  "in this AOI supports roughly 92% of Class A traffic, so the absence is not "
                                  "explained by coverage alone.",
                        "series": [], "seriesLabel": "", "expected": 0.92,
                    }],
                    "caveats": ["This candidate carries no identity and is not resolvable to a vessel. It is ranked "
                                "as a hypothesis only.", *_base_caveats(inp)],
                })


def _rank(rows: list[dict[str, Any]], by: str, into: str) -> None:
    for i, row in enumerate(sorted(rows, key=lambda r: -r[by])):
        row[into] = i + 1
    rows.sort(key=lambda r: r["rank"])


def score(inp: ScoringInput) -> dict[str, Any]:
    """Suspects ranked on one collation scale, the gate's count, separability, or a refusal."""
    # Stage 1: the spatiotemporal gate -- a track survives only if it was inside
    # the origin field at the matching backward hour.
    admitted = []
    for vessel in inp.vessels:
        peak = 0.0
        for t, lon, lat, _, _ in vessel.points:
            hour = hour_of(t, inp.acquired_ms)
            if hour > 0 or hour < -inp.backward_hours:
                continue
            peak = max(peak, field_agreement(inp.frames, hour, lon, lat)["value"])
        if peak >= GATE_THRESHOLD:
            admitted.append(vessel)
    gate = {
        "considered": len(inp.vessels), "admitted": len(admitted),
        "reason": f"Tracks retained where P(lat, lon, t) exceeded {fixed(GATE_THRESHOLD, 2)} of the field peak at "
                  "the matching backward hour.",
    }

    # Stages 2-4: terms, collation onto one scale (a platform can outrank a tanker
    # with no special case -- P004 Case 1), evidence cards.
    rows = [_score_vessel(v, inp) for v in admitted]
    rows += [_score_infrastructure(i, inp) for i in inp.infrastructure]
    rows += [_score_dark(d, inp) for d in inp.dark_targets]
    _rank(rows, "total", "rank")
    _rank(rows, "totalWithoutDrift", "rankWithoutDrift")
    separability = rows[0]["total"] - rows[1]["total"] if len(rows) >= 2 else None

    # C3. The number a refusal quotes is the TIGHTEST the backward field gets:
    # if even that spans this much, nothing inside it is separable.
    tightest = min(inp.area90_by_hour) if inp.area90_by_hour else 0.0
    c = inp.characterisation
    insufficient = None
    if c.wind_gate_multiplier < WIND_GATE_REFUSE:
        insufficient = {"area90Km2": tightest, "reason": (
            f"Wind {fixed(c.wind_speed_ms, 1)} m/s at the detection centroid puts the gate multiplier at "
            f"{fixed(c.wind_gate_multiplier, 2)}. At this wind the sea is dark whether or not there is oil on it, so "
            "no ranking here would mean anything.")}
    elif inp.drift_insufficient:
        insufficient = inp.drift_insufficient
    elif not rows:
        insufficient = {"area90Km2": tightest,
                        "reason": "No candidate intersected the origin field anywhere inside the backward horizon."}
    elif separability is not None and separability < SEPARABILITY_FLOOR:
        insufficient = {"area90Km2": tightest, "reason": (
            f"Top two candidates separated by {fixed(separability, 3)}. That is inside the noise of the weighting, "
            "so neither is distinguished from the other.")}
    return {"suspects": rows, "gate": gate, "separability": separability, "insufficientEvidence": insufficient}
