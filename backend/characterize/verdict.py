"""oos or slick_unknown, decided after detection, with its terms (FUTURE_WORK §2.4).

The backend twin of `frontDemo/src/sim/verdict.ts`, which holds the full
rationale; read it there. In short: the release model has one class, `slick`,
and cannot tell an operational discharge from a natural film or a wake, so the
class is a verdict computed from evidence the model cannot see, rendered term
by term (C4):

    support = shape x vessel x (1 - diverge) x wind x contrast x drift

`oos` at 0.5 or more. An unmeasured term weighs nothing rather than a guess.
A linear slick at a vessel that opens in a V is flagged as a possible wake.

**The two must never disagree.** The constants are copied, not re-derived, and
`tests/fixtures/characterise/verdict_cases.json` pins both: `check:verdict`
asserts the TypeScript still produces the recorded outputs, and
`tests/test_verdict.py` asserts this module produces the same ones. Change a
rule in one place and a check fails until the other matches.

The thresholds are uncalibrated (`ISSUES.md` F19): there is no labelled
oos/wake set to calibrate against until a person works through the review
pack (B1).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

LINEAR = 6.0
COMPACT = 3.0
ADJACENT_FULL_KM = 0.3
ADJACENT_NONE_KM = 3.0
SPREAD_SLOPE = 0.03
V_SLOPE = 0.1
OOS_AT = 0.5
# A bright target this close to a listed installation is taken to be it.
INSTALLATION_KM = 0.5

WAKE_CAUTION = (
    "Linear, at a vessel, and opening in a V: the shape of a ship wake, which would be blamed on "
    "the ship that made it. Treated as a look-alike until a person looks."
)

End = Literal["head", "tail"]


@dataclass(frozen=True, slots=True)
class EndTarget:
    """The bright (CFAR) target nearest either end of the slick."""

    end: End
    distance_km: float
    #: An AIS vessel reported at it at the pass.
    matched: bool
    #: It sits on a listed installation.
    installation: bool


@dataclass(frozen=True, slots=True)
class VerdictInputs:
    elongation: float
    length_km: float
    #: Width along the medial axis, head to tail, metres.
    width_profile_m: Sequence[float]
    end_target: EndTarget | None
    wind_speed_ms: float
    wind_gate: float
    #: dB; None when not measured.
    damping_ratio_db: float | None
    #: Best drift term over vessel candidates; None when nothing was scored.
    best_vessel_drift: float | None


@dataclass(frozen=True, slots=True)
class VerdictTerm:
    key: str
    label: str
    #: In [0,1]; None when it could not be measured, in which case it carries no weight.
    value: float | None
    detail: str


@dataclass(frozen=True, slots=True)
class SlickVerdict:
    verdict: Literal["oos", "slick_unknown"]
    support: float
    caution: str | None
    terms: tuple[VerdictTerm, ...]
    summary: str


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def width_slope(widths: Sequence[float], length_km: float) -> float | None:
    """Least-squares slope of width against distance along the axis, metres per metre."""

    n = len(widths)
    if n < 3 or not length_km > 0:
        return None
    step = length_km * 1000.0 / (n - 1)
    sx = sy = sxx = sxy = 0.0
    for i, w in enumerate(widths):
        x = i * step
        sx += x
        sy += w
        sxx += x * x
        sxy += x * w
    denominator = n * sxx - sx * sx
    return (n * sxy - sx * sy) / denominator if denominator > 0 else None


def verdict_from(e: VerdictInputs) -> SlickVerdict:
    shape = _clamp((e.elongation - COMPACT) / (LINEAR - COMPACT))

    vessel = 0.0
    vessel_detail = "no bright target in the scene (CFAR), so nothing says a vessel was at the slick"
    vessel_end: End | None = None
    target = e.end_target
    if target is not None:
        vessel_end = target.end
        d = target.distance_km
        what = ("a listed installation" if target.installation
                else "an AIS vessel" if target.matched
                else "not an AIS vessel: a dark vessel or an unlisted installation")
        vessel = 0.0 if target.installation else _clamp(
            1 - (d - ADJACENT_FULL_KM) / (ADJACENT_NONE_KM - ADJACENT_FULL_KM))
        vessel_detail = f"nearest bright target {d:.2f} km from the {vessel_end} end, {what} " + (
            "-- a leak there is not a vessel's discharge" if target.installation
            else f"(full at {ADJACENT_FULL_KM} km, none past {ADJACENT_NONE_KM} km)")

    # Width measured away from the vessel's end; head-to-tail otherwise.
    profile = list(e.width_profile_m)[::-1] if vessel_end == "tail" else list(e.width_profile_m)
    slope = width_slope(profile, e.length_km)
    diverge = None if slope is None else _clamp((slope - SPREAD_SLOPE) / (V_SLOPE - SPREAD_SLOPE))
    diverge_detail = ("no width profile to measure" if slope is None else
                      f"width grows {slope:.3f} m per m away from the {vessel_end or 'head'} end "
                      f"({SPREAD_SLOPE} or less reads as spreading oil, {V_SLOPE} or more as a V; "
                      "this project's thresholds, uncalibrated)")

    damping = e.damping_ratio_db
    contrast = None if damping is None or not math.isfinite(damping) else _clamp(-damping / 3.0)
    drift = None if e.best_vessel_drift is None else _clamp(e.best_vessel_drift)
    gate = _clamp(e.wind_gate)

    terms = (
        VerdictTerm("shape", "linear", shape,
                    f"elongation {e.elongation:.1f} (compact at {COMPACT:g} or less, linear at {LINEAR:g} or more)"),
        VerdictTerm("vessel", "bright target at an end", vessel, vessel_detail),
        VerdictTerm("diverge", "opens in a V", diverge, diverge_detail),
        VerdictTerm("wind", "wind gate", gate,
                    f"{e.wind_speed_ms:.1f} m/s at the pass; a continuous multiplier, never a cut (C9)"),
        VerdictTerm("contrast", "contrast", contrast,
                    "damping ratio not measured for this detection; carries no weight" if contrast is None
                    else f"damping {damping:.1f} dB (full at 3 dB); a tiebreak only -- weak contrast argues a film"),
        VerdictTerm("drift", "vessel in the origin field", drift,
                    "no vessel candidate was scored against the origin field; carries no weight" if drift is None
                    else f"best vessel drift term {drift:.2f}"),
    )

    support = (shape * vessel * (1 - (diverge or 0.0)) * gate
               * (1.0 if contrast is None else 0.75 + 0.25 * contrast)
               * (1.0 if drift is None else 0.5 + 0.5 * drift))
    verdict: Literal["oos", "slick_unknown"] = "oos" if support >= OOS_AT else "slick_unknown"
    caution = WAKE_CAUTION if shape >= 0.5 and vessel >= 0.5 and (diverge or 0.0) >= 0.5 else None

    measured = [t for t in terms if t.value is not None and t.key != "diverge"]
    weakest = min(measured, key=lambda t: t.value if t.value is not None else 1.0) if measured else None
    if verdict == "oos":
        summary = (f"An operational discharge on this evidence (support {support:.2f}): linear, with a bright "
                   "target at its end, not opening in a V.")
        if target is not None and not target.matched:
            summary += (" That target is not an AIS vessel, so it is a dark vessel or an installation nobody "
                        "listed; CFAR cannot tell which.")
    elif caution:
        summary = f"Unknown origin: {caution}"
    else:
        summary = (f"Unknown origin (support {support:.2f}, under {OOS_AT}); the weakest term is "
                   f"{weakest.label if weakest else 'shape'}.")
    return SlickVerdict(verdict=verdict, support=support, caution=caution, terms=terms, summary=summary)


# The console's sphere (`sim/geo.ts` R_EARTH_KM), so a distance is the same number on both sides.
EARTH_RADIUS_KM = 6371.0088


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (lon, lat) points, as `sim/geo.ts` `distanceKm`."""

    d_lat = math.radians(b[1] - a[1])
    d_lon = math.radians(a[0] - b[0])
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a[1])) * math.cos(math.radians(b[1])) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def nearest_end_target(
    head: tuple[float, float],
    tail: tuple[float, float],
    targets: Iterable[tuple[tuple[float, float], bool]],
    installations: Sequence[tuple[float, float]] = (),
) -> EndTarget | None:
    """The (position, matched) target nearest either end, as `verdictFor` picks it."""

    best: EndTarget | None = None
    for position, matched in targets:
        for end, point in (("head", head), ("tail", tail)):
            d = haversine_km(point, position)
            if best is not None and d >= best.distance_km:
                continue
            best = EndTarget(
                end=end,  # type: ignore[arg-type]
                distance_km=d,
                matched=matched,
                installation=any(
                    haversine_km(i, position) <= INSTALLATION_KM for i in installations),
            )
    return best
