"""The live pipeline's candidates, in the scorer's terms (PHASE-06, stage 1).

`vessels_from_traffic` is the console's `toVessel` (`frontDemo/src/sim/realAis.ts`):
a real track from `export_ais_traffic`'s simplified JSON, resampled onto one
global 5-minute grid within each continuous segment. `behaviour` takes the first
step as the nominal cadence, so a grid is what keeps a gap a gap and a straight
simplified leg from reading as silence. `tests/test_attribution.py` checks the
port against the tracks the console scored.

`attribution_input` assembles a run's `ScoringInput`. Two things it does not do,
on purpose:

  * **No dark candidates from CFAR.** An unmatched bright target is a dark ship
    or an installation, CFAR cannot tell which, it carries no length estimate,
    and no infrastructure dataset is on this machine. Ranking platforms as dark
    ships is the false accusation PHASE-06 warns of, so they are counted, not
    scored, and coverage is reported partial.
  * **No infrastructure.** For the same reason; the card says so.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

from backend.attribute.features import Vessel, bearing_deg, distance_km, js_round
from backend.attribute.field import frames_from_origin_field
from backend.attribute.scoring import Characterisation, ScoringInput

#: The console's `REAL_CADENCE_S`.
CADENCE_S = 300

# AIS often has no length; the size term gets the middle of the class, flagged,
# rather than a zero that would mark the vessel down for a missing field.
_TYPICAL_LENGTH_M = {"Tanker": 180, "Cargo": 170, "Passenger": 150, "Fishing": 25, "Tug": 30, "Pleasure craft": 12,
                     "Service vessel": 40, "Other": 60, "Unknown": 60}


def mask_mmsi(mmsi: str) -> str:
    """Country prefix and check digit only, the way the console shows it."""
    return f"MMSI {mmsi[:3]}{'•' * 5}{mmsi[-1:]}"


def to_vessel(v: dict[str, Any], t0_ms: float) -> Vessel:
    """One exported track as the scorer's `Vessel`: `toVessel`, step for step."""
    t, lon, lat = v["t"], v["lon"], v["lat"]
    n = len(t)

    def derived(i: int) -> tuple[float, float]:
        a = i - 1 if i > 0 else i
        b = i if i > 0 else min(n - 1, i + 1)
        if a == b:
            return 0.0, 0.0
        km = distance_km((lon[a], lat[a]), (lon[b], lat[b]))
        hours = max(1, t[b] - t[a]) / 3600
        return km / 1.852 / hours, bearing_deg((lon[a], lat[a]), (lon[b], lat[b]))

    # A blank speed or course is derived from the neighbours, never filled with 0:
    # a zero speed would read as a stop that did not happen.
    def sog(i: int) -> float:
        value = v["sog"][i] if i < len(v["sog"]) else None
        return derived(i)[0] if value is None else value

    def cog(i: int) -> float:
        value = v["cog"][i] if i < len(v["cog"]) else None
        return derived(i)[1] if value is None else value

    points = []
    a = 0
    for end in [*v["breaks"], n]:
        b = end - 1
        if b < a:
            continue
        j = a
        s = math.ceil(t[a] / CADENCE_S) * CADENCE_S
        while s <= t[b]:
            while j < b and t[j + 1] < s:
                j += 1
            k = min(b, j + 1)
            span = t[k] - t[j]
            f = (s - t[j]) / span if span > 0 else 0
            turn = math.fmod(cog(k) - cog(j) + 540, 360) - 180
            points.append((
                t0_ms + s * 1000,
                lon[j] + (lon[k] - lon[j]) * f,
                lat[j] + (lat[k] - lat[j]) * f,
                sog(j) + (sog(k) - sog(j)) * f,
                math.fmod(cog(j) + turn * f + 360, 360),
            ))
            s += CADENCE_S
        a = end
    length = v.get("lengthM")
    if length is None:
        length = _TYPICAL_LENGTH_M.get(v["kind"], 60)
    return Vessel(mmsi=v["id"], label=mask_mmsi(v["id"]), kind=v["kind"], length_m=js_round(length),
                  draft_m=v.get("draftM") or 0, points=points, length_assumed=v.get("lengthM") is None, source="real")


def vessels_from_traffic(traffic: dict[str, Any]) -> list[Vessel]:
    """Every exported track, on the acquisition's clock (`acquiredAt`, UTC)."""
    t0 = datetime.fromisoformat(traffic["acquiredAt"].replace("Z", "+00:00")).timestamp() * 1000
    return [to_vessel(v, t0) for v in traffic["vessels"]]


def attribution_input(*, field: Any, acquired: datetime, character: dict[str, Any], payload: dict[str, Any],
                      traffic: dict[str, Any], backward_hours: int) -> ScoringInput:
    """A live run's scorer input: its own origin field, seed, AIS and hindcast frames."""
    from backend.drift.opendrift_runner import naive_utc

    head, tail = tuple(character["head"]), tuple(character["tail"])
    return ScoringInput(
        frames=frames_from_origin_field(field, acquired),
        characterisation=Characterisation(
            head=head, tail=tail, length_km=float(character["lengthKm"]),
            wind_speed_ms=float(character["windSpeedMs"]),
            wind_gate_multiplier=float(character["windGateMultiplier"] or 0.0),
            damping_ratio_db=float(character["dampingRatioDb"]),
            head_tail_resolved_by=character.get("headTailResolvedBy", "ambiguous"),
        ),
        acquired_ms=naive_utc(acquired).replace(tzinfo=UTC).timestamp() * 1000,
        backward_hours=backward_hours,
        area90_by_hour=[float(f["area90Km2"]) for f in payload["frames"] if f["hour"] <= 0],
        vessels=[v for v in vessels_from_traffic(traffic) if v.points],
        infrastructure_coverage="partial",
    )
