"""AIS reception gaps, normalised by expected reception density (C7).

`PLAN/CONSTRAINTS.md` C7: **"A raw AIS gap is not evidence -- normalise by
expected reception density."** The failure it guards against is flagging every
silence as intent. Reception varies enormously by region, vessel class and
transceiver type, and Global Fishing Watch (Welch et al. 2022) documents
legitimate reasons a vessel goes quiet -- piracy avoidance among them.

The method here follows GFW's shape: establish **how often this vessel's signal
is actually received**, then judge a silence against that rather than against an
absolute threshold. A 45-minute gap from a vessel that reports every 30 minutes
is ordinary; the same 45 minutes from a vessel reporting every minute is not.

Two deliberate limitations, both honest:

* The expectation is derived from the vessel's **own** observed cadence within
  the window, not from a fitted regional reception model. That is weaker than
  GFW's approach and is the right next step if gap evidence ever carries real
  weight in the score.
* Nothing here concludes intent. Every explanation is phrased as an observation,
  because the evidence card must let a human draw that conclusion (C4).
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise

from backend.ingest.ais.loader import AisRecord

# A silence must exceed this multiple of the vessel's own expected reporting
# interval before it is worth surfacing at all.
ANOMALY_RATIO = 10.0

# Silences shorter than this are never interesting, whatever the ratio: a vessel
# reporting every 2 s makes a 60 s gap a 30x ratio and pure noise.
MIN_GAP_S = 600

# Below this a vessel is holding station. AIS Class A reports every 2-10 s under
# way but only about every 3 min moored, so the two states need separate
# expectations or a berthed vessel looks like it is hiding.
MOORED_SOG_KNOTS = 0.5

# Above this share of the observed span spent silent, the vessel is too poorly
# heard for any individual gap to be evidence. See `reception_quality`.
MAX_SILENT_FRACTION = 0.20

# A vessel with at least this many gaps has a reception *pattern*, so a gap is
# judged against its own gap distribution rather than against its message cadence.
MIN_GAPS_FOR_PATTERN = 5

# Within such a pattern, a gap must exceed this multiple of the vessel's typical
# gap before it reads as a discrete event rather than more of the same coverage.
GAP_OUTLIER_MULTIPLE = 3.0


@dataclass(frozen=True, slots=True)
class Gap:
    """A silent interval between two consecutive received messages."""

    start: datetime
    end: datetime
    duration_s: float


@dataclass(frozen=True, slots=True)
class GapAssessment:
    """A gap, the expectation it was judged against, and the resulting ratio.

    Both the raw gap and the expected interval are carried so the evidence card
    can show them together, which is what C7 requires -- a ratio alone hides
    whether the vessel was in poor coverage.
    """

    start: datetime
    end: datetime
    duration_s: float
    expected_interval_s: float
    ratio: float
    is_anomalous: bool
    explanation: str


def _intervals(track: Sequence[AisRecord]) -> list[float]:
    ordered = sorted(track, key=lambda point: point.base_date_time)
    return [
        (after.base_date_time - before.base_date_time).total_seconds()
        for before, after in pairwise(ordered)
    ]


def expected_interval_s(track: Sequence[AisRecord]) -> float:
    """How often this vessel's signal is actually received, in seconds.

    The **median** interval, not the mean: a single long outage would drag a
    mean upwards and thereby raise the bar for detecting any later gap -- the
    outage would help conceal its own successors.
    """

    intervals = [value for value in _intervals(track) if value > 0]
    if not intervals:
        return 0.0
    return float(statistics.median(intervals))


def _is_moored(point: AisRecord) -> bool:
    """Whether a report was made while holding station rather than under way."""

    return point.sog is not None and point.sog < MOORED_SOG_KNOTS


def expected_interval_for_state(track: Sequence[AisRecord], *, moored: bool) -> float:
    """Median reporting interval for one movement state.

    The AIS Class A standard transmits every 2-10 s **under way** but only about
    every 3 minutes **at anchor or moored**, so a single whole-track median
    mis-judges any vessel that both moved and stopped. Measured against real data
    on 2026-08-30, the global median flagged 57 of BRANDON BORDELON's 65 gaps as
    anomalous while it sat berthed -- precisely the over-flagging C7 forbids.

    An interval is attributed to the state of the report that **opened** it.
    """

    ordered = sorted(track, key=lambda point: point.base_date_time)
    intervals = [
        (after.base_date_time - before.base_date_time).total_seconds()
        for before, after in pairwise(ordered)
        if _is_moored(before) is moored
    ]
    intervals = [value for value in intervals if value > 0]
    if not intervals:
        return 0.0
    return float(statistics.median(intervals))


@dataclass(frozen=True, slots=True)
class ReceptionQuality:
    """How reliably this vessel was heard, and whether gaps mean anything.

    This is the C7 gate. `silent_fraction` is the share of the observation span
    spent inside gaps: the direct measure of reception density, as opposed to the
    median interval, which only describes cadence *while* the vessel is audible.
    """

    silent_fraction: float
    median_interval_s: float
    gap_count: int
    gap_evidence_usable: bool
    explanation: str


def reception_quality(
    track: Sequence[AisRecord],
    *,
    min_gap_s: float = MIN_GAP_S,
    max_silent_fraction: float = MAX_SILENT_FRACTION,
) -> ReceptionQuality:
    """Decide whether this vessel is heard well enough for gaps to be evidence.

    Measured on real data 2026-08-30: BRANDON BORDELON reports every ~1.17 min
    when audible -- identically under way and moored -- yet is silent **26%** of
    the observed span across 65 gaps of 10-113 min. Judging each of those against
    the 1.17 min median produced 57 "anomalies" from what is plainly patchy
    coverage of an offshore supply vessel.

    So when a vessel is unheard for more than `max_silent_fraction` of the span,
    gap evidence is **suppressed entirely** rather than scaled down. A vessel this
    poorly covered cannot support an inference about intent either way, and C7 is
    explicit that a raw gap is not evidence.
    """

    ordered = sorted(track, key=lambda point: point.base_date_time)
    if len(ordered) < 2:
        return ReceptionQuality(0.0, 0.0, 0, False, "too few reports to judge reception")

    span_s = (ordered[-1].base_date_time - ordered[0].base_date_time).total_seconds()
    gaps = find_gaps(ordered, min_gap_s=min_gap_s)
    silent_s = sum(gap.duration_s for gap in gaps)
    fraction = silent_s / span_s if span_s > 0 else 0.0
    usable = fraction <= max_silent_fraction

    if usable:
        explanation = (
            f"heard reliably: silent {fraction:.0%} of the observed span across "
            f"{len(gaps)} gaps, so an individual gap carries reception-normalised meaning"
        )
    else:
        explanation = (
            f"poor reception: silent {fraction:.0%} of the observed span across "
            f"{len(gaps)} gaps, above the {max_silent_fraction:.0%} limit. Individual "
            "gaps are not treated as evidence for this vessel -- the pattern is "
            "coverage, not a discrete event."
        )

    return ReceptionQuality(
        silent_fraction=round(fraction, 4),
        median_interval_s=expected_interval_s(ordered),
        gap_count=len(gaps),
        gap_evidence_usable=usable,
        explanation=explanation,
    )


def find_gaps(track: Sequence[AisRecord], *, min_gap_s: float = MIN_GAP_S) -> list[Gap]:
    """Silences longer than `min_gap_s` between consecutive messages."""

    ordered = sorted(track, key=lambda point: point.base_date_time)
    gaps: list[Gap] = []
    for before, after in pairwise(ordered):
        duration = (after.base_date_time - before.base_date_time).total_seconds()
        if duration >= min_gap_s:
            gaps.append(
                Gap(
                    start=before.base_date_time,
                    end=after.base_date_time,
                    duration_s=duration,
                )
            )
    return gaps


def assess_gaps(
    track: Sequence[AisRecord],
    *,
    min_gap_s: float = MIN_GAP_S,
    anomaly_ratio: float = ANOMALY_RATIO,
) -> list[GapAssessment]:
    """Judge each gap against this vessel's own reception rate.

    This is the C7 boundary: a gap is reported with its expectation attached,
    and `is_anomalous` means only "long relative to how often this vessel is
    normally heard", never "the vessel switched off its transceiver".
    """

    overall = expected_interval_s(track)
    if overall <= 0:
        return []

    # Judge each gap against the cadence for the state it began in, falling back
    # to the whole-track median when that state has too little history.
    by_state = {
        state: expected_interval_for_state(track, moored=state) or overall
        for state in (False, True)
    }
    ordered = sorted(track, key=lambda point: point.base_date_time)
    # A gap is bounded by two reports that may be in different states -- a vessel
    # that slowed and moored *during* the silence. Treat such a straddling gap as
    # moored, the more permissive expectation: the vessel may have been stationary
    # for most of it, and C7 requires erring away from manufacturing suspicion.
    straddles_moored = {
        before.base_date_time: _is_moored(before) or _is_moored(after)
        for before, after in pairwise(ordered)
    }

    gaps = find_gaps(track, min_gap_s=min_gap_s)

    # C7's real discriminator, from the BRANDON BORDELON data: a vessel with many
    # gaps has a coverage *pattern*, and a gap of its typical length is more of
    # that pattern, not an event. Judge such a gap against its own gap
    # distribution instead of against the message cadence, which only describes
    # how fast it reports while audible.
    typical_gap_s = (
        statistics.median([gap.duration_s for gap in gaps])
        if len(gaps) >= MIN_GAPS_FOR_PATTERN
        else 0.0
    )

    assessments: list[GapAssessment] = []
    for gap in gaps:
        moored = straddles_moored.get(gap.start, False)
        expected = by_state[moored]
        ratio = gap.duration_s / expected
        anomalous = ratio >= anomaly_ratio
        if typical_gap_s and gap.duration_s <= GAP_OUTLIER_MULTIPLE * typical_gap_s:
            anomalous = False

        if anomalous:
            explanation = (
                f"no signal for {gap.duration_s / 60:.0f} min, {ratio:.0f}x this "
                f"vessel's usual {expected / 60:.1f} min interval while "
                f"{'moored' if moored else 'under way'}. "
                "Long relative to its own reception; coverage, transceiver faults "
                "and lawful reasons for silence are all still consistent with this."
            )
        elif typical_gap_s and gap.duration_s <= GAP_OUTLIER_MULTIPLE * typical_gap_s:
            explanation = (
                f"no signal for {gap.duration_s / 60:.0f} min. This vessel has "
                f"{len(gaps)} gaps averaging {typical_gap_s / 60:.0f} min, so a gap of "
                "this length is part of its reception pattern rather than a discrete event."
            )
        else:
            explanation = (
                f"no signal for {gap.duration_s / 60:.0f} min, only {ratio:.1f}x this "
                f"vessel's usual {expected / 60:.1f} min interval while "
                f"{'moored' if moored else 'under way'}: within normal "
                "reception variation for this vessel."
            )

        assessments.append(
            GapAssessment(
                start=gap.start,
                end=gap.end,
                duration_s=gap.duration_s,
                expected_interval_s=expected,
                ratio=ratio,
                is_anomalous=anomalous,
                explanation=explanation,
            )
        )

    return assessments
