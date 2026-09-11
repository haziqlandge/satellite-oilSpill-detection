"""Per-track behavioural features for the attribution scorer (PHASE-05).

The feature set follows P003 (`SOG, COG, ROT, Heading, Draught` plus position and
time), with one structural difference that `PLAN/CONSTRAINTS.md` C4 requires:
**every quantity here is named and inspectable.** The output of this pipeline is
an accusation of a crime, so a bare anomaly score is not admissible evidence --
"a raw isolation score alone is not inspectable evidence" (PHASE-05).

An Isolation Forest over these features is the intended unsupervised baseline,
because labelled polluter behaviour does not exist. It belongs *alongside* these
explicit terms, never in place of them.

Note on ROT: marinecadastre's schema carries no rate-of-turn column, so it is
derived here from successive COG values and the time between them.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import pairwise

from backend.ingest.ais.loader import AisRecord

# A moored or anchored vessel still reports small non-zero SOG from GPS jitter,
# so the loiter threshold is a berthing speed rather than exactly zero.
LOITER_SOG_KNOTS = 0.5

# Above this a vessel is under way rather than manoeuvring or holding station.
TRANSIT_SOG_KNOTS = 3.0

# Fraction of a track below LOITER_SOG_KNOTS for the track to read as loitering.
LOITER_FRACTION_THRESHOLD = 0.7


@dataclass(frozen=True, slots=True)
class TrackBehaviour:
    """Named behavioural terms for one vessel track, plus readable reasoning."""

    is_loitering: bool
    is_transiting: bool
    terms: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)


def _sogs(track: Sequence[AisRecord]) -> list[float]:
    return [point.sog for point in track if point.sog is not None]


def speed_drop_knots(track: Sequence[AisRecord]) -> float:
    """Largest deceleration between consecutive reports.

    Only decreases count: slowing to discharge is the signature of interest,
    while accelerating away is not, and folding both into one magnitude would
    make a departing vessel look like a discharging one.
    """

    speeds = _sogs(track)
    if len(speeds) < 2:
        return 0.0
    # Clamped at zero: a track that only ever accelerates has no drop, and
    # returning the negative would rank a departing vessel like a slowing one.
    return max(
        0.0,
        max(
            (before - after for before, after in pairwise(speeds)),
            default=0.0,
        ),
    )


def _angular_difference(first: float, second: float) -> float:
    """Smallest absolute angle between two bearings, in degrees.

    350 -> 10 is a 20 degree turn. Subtracting directly gives 340 and would make
    an ordinary course correction across north look like a violent manoeuvre.
    """

    delta = abs(second - first) % 360.0
    return min(delta, 360.0 - delta)


def course_deviation_deg(track: Sequence[AisRecord]) -> float:
    """Largest course change between consecutive reports."""

    courses = [point.cog for point in track if point.cog is not None]
    if len(courses) < 2:
        return 0.0
    return max(
        _angular_difference(before, after)
        for before, after in pairwise(courses)
    )


def derived_rot_deg_per_min(track: Sequence[AisRecord]) -> float:
    """Largest rate of turn, degrees per minute, derived from COG over time."""

    usable = [point for point in track if point.cog is not None]
    if len(usable) < 2:
        return 0.0

    fastest = 0.0
    for before, after in pairwise(usable):
        minutes = (after.base_date_time - before.base_date_time).total_seconds() / 60.0
        if minutes <= 0:
            continue
        fastest = max(fastest, _angular_difference(before.cog, after.cog) / minutes)  # type: ignore[arg-type]
    return fastest


def loiter_fraction(track: Sequence[AisRecord]) -> float:
    """Fraction of reports below `LOITER_SOG_KNOTS`."""

    speeds = _sogs(track)
    if not speeds:
        return 0.0
    return sum(1 for speed in speeds if speed < LOITER_SOG_KNOTS) / len(speeds)


def draught_change_m(track: Sequence[AisRecord]) -> float:
    """Difference between the largest and smallest reported draught.

    A change across a track is discharge-adjacent evidence: a vessel that has
    offloaded sits higher. It is weak on its own -- draught is manually entered
    and frequently stale -- so it is reported as a term, never used as a gate.
    """

    drafts = [point.draft for point in track if point.draft is not None]
    if len(drafts) < 2:
        return 0.0
    return max(drafts) - min(drafts)


def describe(track: Sequence[AisRecord]) -> TrackBehaviour:
    """Compute every behavioural term for one track, with its reasoning."""

    speeds = _sogs(track)
    drop = speed_drop_knots(track)
    deviation = course_deviation_deg(track)
    loiter = loiter_fraction(track)
    rot = derived_rot_deg_per_min(track)
    draught = draught_change_m(track)
    mean_sog = sum(speeds) / len(speeds) if speeds else 0.0

    terms: dict[str, float] = {
        "speed_drop_knots": round(drop, 3),
        "course_deviation_deg": round(deviation, 3),
        "rot_deg_per_min": round(rot, 3),
        "loiter_fraction": round(loiter, 3),
        "draught_change_m": round(draught, 3),
        "mean_sog_knots": round(mean_sog, 3),
        "report_count": float(len(track)),
    }

    is_loitering = loiter >= LOITER_FRACTION_THRESHOLD and bool(speeds)
    is_transiting = mean_sog >= TRANSIT_SOG_KNOTS and not is_loitering

    reasons: list[str] = []
    if is_loitering:
        reasons.append(
            f"{loiter:.0%} of reports below {LOITER_SOG_KNOTS} kn: holding station, "
            "berthed or anchored rather than under way"
        )
    if is_transiting:
        reasons.append(f"mean SOG {mean_sog:.1f} kn: under way")
    if drop > 0:
        reasons.append(f"largest deceleration {drop:.1f} kn between consecutive reports")
    if deviation > 0:
        reasons.append(f"largest course change {deviation:.0f} deg")
    if draught > 0:
        reasons.append(f"reported draught changed by {draught:.1f} m across the track")
    if not reasons:
        reasons.append("no behavioural change detected across this track")

    return TrackBehaviour(
        is_loitering=is_loitering,
        is_transiting=is_transiting,
        terms=terms,
        reasons=reasons,
    )


def as_storage_payload(track: Sequence[AisRecord]) -> dict[str, object]:
    """JSON-safe behavioural summary for ``ais_tracks.behaviour``.

    Carries the reception quality alongside the behavioural terms because **C7
    requires the raw gap and the expected rate to be surfaced together** -- a
    silence figure without the cadence it is judged against invites reading an
    ordinary coverage gap as evasion.

    Nothing here asserts intent. The terms are observations; PHASE-06 weighs
    them and the evidence card shows the weighing.
    """

    from backend.ingest.ais.gaps import reception_quality

    described = describe(track)
    quality = reception_quality(track)

    return {
        "is_loitering": described.is_loitering,
        "is_transiting": described.is_transiting,
        "terms": {name: round(float(value), 6) for name, value in described.terms.items()},
        "reasons": list(described.reasons),
        "reception": {
            "silent_fraction": round(float(quality.silent_fraction), 6),
            "median_interval_s": round(float(quality.median_interval_s), 3),
            "gap_count": int(quality.gap_count),
            # C7: whether the gaps mean anything at all, and why. Storing the
            # verdict without its explanation would let a downstream reader use
            # the number and lose the caveat attached to it.
            "gap_evidence_usable": bool(quality.gap_evidence_usable),
            "explanation": quality.explanation,
        },
    }
