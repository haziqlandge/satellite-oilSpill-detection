"""The six scoring terms, each in [0, 1] and reported on its own (PHASE-06, stage 2).

The Python twin of the console's terms (`frontDemo/src/sim/scoring.ts`) and of
what they read from `sim/ais.ts` (`behaviour`, `vesselPrior`,
`unknownClassPrior`) and `sim/geo.ts`. The console's scenarios are the fixtures
PHASE-06 is accepted on, so this reproduces them to the last printed digit
(`tests/test_attribution.py`) rather than re-deriving anything.

| Term | Question it answers |
|---|---|
| `S_drift` | was the track inside the origin field at the matching backward hour? (ours) |
| `S_proximity` | how far is the slick head from the track? `exp(-d / 4 km)` (Cerulean) |
| `S_parity` | could the local track have laid a slick this long along this axis? (Cerulean) |
| `S_temporality` | how close to the pass was its best field agreement? (Cerulean) |
| `S_behaviour` | speed drops, standing still, turns, reception gaps -- each with its series (P003, GFW) |
| `S_prior` | vessel class and size (P004, domain) |
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from backend.attribute.field import FieldFrame, field_agreement
from backend.attribute.weights import DWELL_SATURATION_H, GATE_THRESHOLD, PROXIMITY_LAMBDA_KM

LngLat = tuple[float, float]

_R_EARTH_KM = 6371.0088
_DEG = math.pi / 180
KM_PER_DEG_LAT = 110.574


# ---- the console's number formatting, so evidence text is identical ----------


def js_round(x: float) -> int:
    """`Math.round`: halves go up, not to even."""
    return math.floor(x + 0.5)


def fixed(x: float, digits: int) -> str:
    """`Number.prototype.toFixed`: the exact binary value, halves away from zero."""
    if not math.isfinite(x):
        return "NaN" if math.isnan(x) else ("Infinity" if x > 0 else "-Infinity")
    if x == 0:
        x = 0.0  # (-0).toFixed() has no sign
    return str(Decimal(x).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def js_sum(values: Any) -> float:
    """Left to right, as `reduce((s, v) => s + v, 0)`; Python 3.12's `sum` compensates."""
    total = 0.0
    for v in values:
        total += v
    return total


def js_num(x: float) -> str:
    """A number interpolated into a template literal: 140, not 140.0."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))


# ---- geometry (sim/geo.ts) -----------------------------------------------------


def km_per_deg_lon(lat: float) -> float:
    return 111.32 * math.cos(lat * _DEG)


def distance_km(a: LngLat, b: LngLat) -> float:
    d_lat = (b[1] - a[1]) * _DEG
    d_lon = (a[0] - b[0]) * _DEG
    lat1 = a[1] * _DEG
    lat2 = b[1] * _DEG
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 2 * _R_EARTH_KM * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(a: LngLat, b: LngLat) -> float:
    lat1 = a[1] * _DEG
    lat2 = b[1] * _DEG
    d_lon = (b[0] - a[0]) * _DEG
    y = math.sin(d_lon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lon)
    return math.fmod(math.atan2(y, x) / _DEG + 360, 360)


def path_length_km(path: list[LngLat]) -> float:
    return js_sum(distance_km(path[i - 1], path[i]) for i in range(1, len(path)))


def _segment_km(p: LngLat, a: LngLat, b: LngLat, kx: float) -> float:
    px, py = p[0] * kx, p[1] * KM_PER_DEG_LAT
    ax, ay = a[0] * kx, a[1] * KM_PER_DEG_LAT
    bx, by = b[0] * kx, b[1] * KM_PER_DEG_LAT
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    if length2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distance_to_path_km(p: LngLat, path: list[LngLat]) -> tuple[float, int]:
    """Shortest distance to a polyline, and the index of the segment it is on."""
    if len(path) == 1:
        return distance_km(p, path[0]), 0
    best, index = math.inf, 0
    kx = km_per_deg_lon(p[1])
    for i in range(1, len(path)):
        d = _segment_km(p, path[i - 1], path[i], kx)
        if d < best:
            best, index = d, i - 1
    return best, index


# ---- candidates' tracks ---------------------------------------------------------


@dataclass(slots=True)
class Vessel:
    """An AIS track. Points are (t ms since epoch, lon, lat, SOG kn, COG deg), time-ordered."""

    mmsi: str
    label: str
    kind: str
    length_m: float
    draft_m: float
    points: list[tuple[float, float, float, float, float]]
    length_assumed: bool = False
    source: str | None = None  # "real" for recorded AIS

    def path(self) -> list[LngLat]:
        return [(p[1], p[2]) for p in self.points]


def hour_of(t: float, acquired_ms: float) -> int:
    return js_round((t - acquired_ms) / 3_600_000)


# ---- the six terms --------------------------------------------------------------


@dataclass(slots=True)
class DriftTerm:
    max: float
    integral: float
    best_hour: int
    best_point: LngLat
    dwell_hours: float
    best: dict[str, float] = field(default_factory=dict)


def s_drift(vessel: Vessel, frames: dict[int, FieldFrame], acquired_ms: float, backward_hours: int) -> DriftTerm:
    """Agreement between a track and the origin field at matching times, both ways.

    `max` is the single best moment: it rewards passing through the dense core,
    which is what a moving discharge looks like. `integral` scales that peak by
    how long the track stayed inside the field, saturating at six hours: it
    rewards lingering, which is what a berthed discharge looks like.
    """
    peak = 0.0
    best_hour = 0
    best = {"centrality": 0.0, "informativeness": 0.0, "value": 0.0, "credibleRegionPct": 100.0, "area90Km2": 0.0}
    points = vessel.points
    best_point: LngLat = (points[0][1], points[0][2]) if points else (0.0, 0.0)
    inside = window = 0
    span_ms = 0.0
    for i, (t, lon, lat, _, _) in enumerate(points):
        hour = hour_of(t, acquired_ms)
        if hour > 0 or hour < -backward_hours:
            continue
        window += 1
        if i > 0:
            span_ms = max(span_ms, t - points[i - 1][0])
        agreement = field_agreement(frames, hour, lon, lat)
        if agreement["value"] >= GATE_THRESHOLD:
            inside += 1
        if agreement["value"] > peak:
            peak, best, best_hour, best_point = agreement["value"], agreement, hour, (lon, lat)
    cadence_h = span_ms / 3_600_000 if span_ms > 0 else 1 / 30
    dwell_hours = inside * cadence_h
    dwell = min(1.0, dwell_hours / DWELL_SATURATION_H)
    return DriftTerm(
        max=peak,
        integral=peak * (0.55 + 0.45 * dwell) if window else 0.0,
        best_hour=best_hour, best_point=best_point, dwell_hours=dwell_hours, best=best,
    )


def s_proximity(head: LngLat, track: list[LngLat]) -> tuple[float, float, int]:
    """(value, km, segment index): slick head to the nearest track point, `exp(-d / 4)`."""
    if not track:
        return 0.0, math.inf, 0
    km, index = distance_to_path_km(head, track)
    return math.exp(-km / PROXIMITY_LAMBDA_KM), km, index


def s_parity(head: LngLat, tail: LngLat, track: list[LngLat], slick_length_km: float) -> tuple[float, float, float]:
    """(value, projected km, alignment deg): how much of the slick the local track could have laid.

    Measured on the stretch of track within a slick length and a half of either
    end, so a long transit clipping the scene does not score as the ribbon. A
    vessel that never moved scores zero -- the right answer to this term's
    question and the wrong one to who did it, which is why no total is shown
    without its terms.
    """
    if len(track) < 2 or slick_length_km <= 0:
        return 0.0, 0.0, 90.0
    reach = max(6.0, slick_length_km * 1.5)
    local = [p for p in track if distance_km(p, head) <= reach or distance_km(p, tail) <= reach]
    if len(local) < 2:
        return 0.0, 0.0, 90.0
    local_length = path_length_km(local)
    if local_length < 0.05:
        return 0.0, 0.0, 90.0
    axis = bearing_deg(head, tail)
    course = bearing_deg(local[0], local[-1])
    delta = abs(math.fmod(course - axis + 540, 360) - 180)
    align = abs(math.cos(delta * math.pi / 180))
    projected = local_length * align
    agreement = min(projected, slick_length_km) / max(projected, slick_length_km)
    return align * agreement, projected, min(delta, 180 - delta)


def s_temporality(nearest_hours_before: float, backward_hours: int) -> float:
    if not math.isfinite(nearest_hours_before):
        return 0.0
    return math.exp(-abs(nearest_hours_before) / (backward_hours * 0.55))


# ---- priors (sim/ais.ts) --------------------------------------------------------

_VESSEL_KINDS = (
    ("Product tanker", 140, 190, 0.9),
    ("Crude tanker", 210, 275, 0.92),
    ("Bulk carrier", 170, 230, 0.62),
    ("Container feeder", 120, 180, 0.48),
    ("Offshore supply", 55, 90, 0.7),
    ("Tug", 22, 38, 0.35),
    ("Fishing", 18, 34, 0.22),
    ("General cargo", 90, 140, 0.5),
)

# AIS reports "Tanker" or "Cargo", not "Product tanker": the coarse classes, on
# the same scale, assumed rather than fitted.
_AIS_CLASS_PRIOR = {"Tanker": 0.9, "Cargo": 0.53, "Passenger": 0.3, "Service vessel": 0.25, "Pleasure craft": 0.08}


def vessel_prior(kind: str, length_m: float) -> float:
    if kind in ("Other", "Unknown"):
        return unknown_class_prior(length_m)
    base = next((p for k, _, _, p in _VESSEL_KINDS if k == kind), _AIS_CLASS_PRIOR.get(kind, 0.4))
    size = min(1.0, length_m / 260)
    return min(1.0, base * 0.78 + size * 0.22)


def unknown_class_prior(length_m: float) -> float:
    """The prior for a contact whose class nobody knows: the mean over the classes its length admits.

    Running dark does not raise it; absence of AIS is scored once, with its
    reception caveat, in `behaviour`.
    """
    admitted = [k for k in _VESSEL_KINDS if k[1] <= length_m <= k[2]]
    if not admitted:
        def gap(k: tuple[str, int, int, float]) -> float:
            return max(k[1] - length_m, length_m - k[2], 0)
        nearest = _VESSEL_KINDS[0]
        for k in _VESSEL_KINDS:
            if gap(k) < gap(nearest):
                nearest = k
        admitted = [nearest]
    base = js_sum(k[3] for k in admitted) / len(admitted)
    size = min(1.0, length_m / 260)
    return min(1.0, base * 0.78 + size * 0.22)


# ---- behaviour (sim/ais.ts) -----------------------------------------------------


def _thin(items: list[Any]) -> list[Any]:
    step = max(1, len(items) // 90)
    return [x for i, x in enumerate(items) if i % step == 0]


def _rolling_min_of_max(values: list[float], width: int) -> float:
    best = math.inf
    for i in range(len(values) - width + 1):
        best = min(best, max(values[i:i + width]))
    return min(values) if best == math.inf else best


def behaviour(vessel: Vessel, acquired_ms: float) -> tuple[float, list[dict[str, Any]]]:
    """Rules plus a composite, never a bare anomaly number: every flag carries its series (C4, C7)."""
    flags: list[dict[str, Any]] = []
    pts = vessel.points
    if len(pts) < 6:
        return 0.0, flags
    sog_series = [{"t": p[0], "v": p[3]} for p in _thin(pts)]
    speeds = [p[3] for p in pts]
    mean = js_sum(speeds) / len(speeds)
    min_run = _rolling_min_of_max(speeds, 8)
    score = 0.0

    # A sustained 15% drop against the vessel's own mean: ~21 sigma clear of
    # AIS speed noise averaged over eight reports (see sim/ais.ts for the census).
    if mean > 2 and min_run < mean * 0.85:
        score += min(0.42, (1 - min_run / mean) * 0.6)
        flags.append({
            "code": "speed_drop", "label": "Sustained speed reduction",
            "detail": f"Held {fixed(min_run, 1)} kn against a {fixed(mean, 1)} kn transit mean for at least 8 reports.",
            "series": sog_series, "seriesLabel": "SOG, knots",
        })

    stationary = sum(1 for s in speeds if s < 0.5) / len(speeds)
    if stationary > 0.5:
        score += 0.3
        hours = ((pts[-1][0] - pts[0][0]) * stationary) / 3_600_000
        flags.append({
            "code": "stationary", "label": "Stationary through the origin window",
            "detail": f"Speed below 0.5 kn for roughly {fixed(hours, 0)} h of the window, including the modelled "
                      "release time.",
            "series": sog_series, "seriesLabel": "SOG, knots",
        })

    turns = [math.fmod(pts[i][4] - pts[i - 1][4] + 540, 360) - 180 for i in range(1, len(pts))]
    max_turn = max(abs(t) for t in turns)
    if max_turn > 28:
        score += 0.1
        flags.append({
            "code": "course_change", "label": "Course deviation",
            "detail": f"Largest single-report heading change {fixed(max_turn, 0)} degrees.",
            "series": [{"t": p[0], "v": p[4]} for p in _thin(pts)], "seriesLabel": "COG, degrees",
        })

    # Reception gaps, normalised against what the region supports (C7).
    nominal = pts[1][0] - pts[0][0]
    gaps = []
    longest = 0.0
    missing = 0
    for i in range(1, len(pts)):
        dt_min = (pts[i][0] - pts[i - 1][0]) / 60_000
        gaps.append({"t": pts[i][0], "v": dt_min})
        longest = max(longest, dt_min)
        if pts[i][0] - pts[i - 1][0] > nominal * 1.5:
            missing += js_round((pts[i][0] - pts[i - 1][0]) / nominal) - 1
    expected_rate = 0.92
    if longest > 24:
        observed = 1 - missing / max(1, len(pts) + missing)
        shortfall = max(0.0, expected_rate - observed)
        if shortfall > 0.06:
            score += min(0.18, shortfall)
            flags.append({
                "code": "reception_gap", "label": "Reception below the regional expectation",
                "detail": f"Longest gap {fixed(longest, 0)} min. Observed reception {fixed(observed * 100, 0)}% against "
                          f"{fixed(expected_rate * 100, 0)}% expected for this class and region.",
                "series": _thin(gaps), "seriesLabel": "Minutes since previous report", "expected": expected_rate,
            })

    nearest = min(abs(p[0] - acquired_ms) / 3_600_000 for p in pts)
    recency = math.exp(-nearest / 12)
    return min(1.0, score * (0.55 + 0.45 * recency)), flags
