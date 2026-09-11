"""Slick age from backward-drift convergence (PHASE-04).

Two independent signals, as PHASE-04 specifies:

1. **Convergence minimum** — the backward timestep at which the particle cloud
   is most spatially concentrated. If a slick was released from a point, running
   it backwards should re-focus it around that point before diffusion wins.
2. **Source coincidence** — the timestep at which the high-probability region
   first intersects a candidate source. This is the operationally meaningful
   one, because it names a *place* as well as a time.

**The honest part, and the reason this module is mostly about refusal.**

Diffusion is irreversible. Running a diffusive process backwards spreads the
cloud, so for many real slicks there is **no convergence minimum at all** — the
spread simply increases monotonically and the "most concentrated" timestep is
just `t=0`, which says nothing. `SYNTHESIS.md` §9 Q2 names this the main risk to
the age deliverable, and PHASE-04 names it a known failure condition: *"the
convergence minimum may be shallow or absent for older slicks. This is physics,
not a bug."*

So this module reports what it found rather than always producing a number:

* `converged` — a genuine interior minimum, deep enough to be meaningful
* `beyond_horizon` — the field is too diffuse to discriminate (C3)
* `monotonic` — spread never turned; no age can be read from convergence alone

**C1 is structural here.** An age is never a bare scalar: `AgeEstimate` carries
`low`, `best`, `high` and the `method` that produced it, and the interval comes
from the ensemble's own spread rather than from a guess. A caller cannot
accidentally store a point estimate because there is no field to put one in.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from backend.drift.origin_field import OriginField, highest_density_mask

AgeMethod = Literal["convergence_minimum", "source_coincidence", "none"]
AgeStatus = Literal["converged", "beyond_horizon", "monotonic", "insufficient_evidence"]

# A minimum must be at least this much below the surrounding spread to count as
# real rather than as noise in the binning. 5% is deliberately modest: the aim
# is to reject flat curves, not to demand a sharp one.
MIN_RELATIVE_DEPTH = 0.05

# Past this spread the 90% region is larger than any useful search area, and a
# named suspect drawn from it would be an accusation the physics cannot support.
# 50 km at the Gulf fixture scale is already most of a scene.
MAX_USEFUL_SPREAD_KM = 50.0

# An interior minimum in the first or last few steps is usually an edge effect
# of the run window rather than a physical convergence.
EDGE_MARGIN_STEPS = 2


class ConvergenceError(RuntimeError):
    """Age could not be estimated as specified."""


@dataclass(frozen=True, slots=True)
class AgeEstimate:
    """Slick age as an interval plus its provenance. Never a bare scalar (C1)."""

    low_hours: float
    best_hours: float
    high_hours: float
    method: AgeMethod
    status: AgeStatus
    spread_km: float
    explanation: str

    @property
    def is_usable(self) -> bool:
        return self.status == "converged"

    def as_dict(self) -> dict[str, object]:
        return {
            "age_hours": {
                "low": round(self.low_hours, 2),
                "best": round(self.best_hours, 2),
                "high": round(self.high_hours, 2),
            },
            "age_method": self.method,
            "status": self.status,
            "spread_km": round(self.spread_km, 3),
            "explanation": self.explanation,
        }


def spread_profile(field: OriginField) -> np.ndarray:
    """Spread in km at each timestep — the curve a minimum is sought in."""

    return np.array([field.spread_km(i) for i in range(field.shape[0])], dtype=float)


def _hours_between(field: OriginField, index: int) -> float:
    """Absolute hours from the observation to `index`. Backward times descend."""

    delta = field.times[index] - field.times[0]
    return abs(delta.total_seconds()) / 3600.0


def estimate_age(
    field: OriginField,
    *,
    min_relative_depth: float = MIN_RELATIVE_DEPTH,
    max_spread_km: float = MAX_USEFUL_SPREAD_KM,
    edge_margin: int = EDGE_MARGIN_STEPS,
) -> AgeEstimate:
    """Age from the convergence minimum, or an honest refusal.

    The interval is the range of timesteps whose spread is within the minimum's
    own depth — i.e. the times the field cannot distinguish from the best one.
    That makes the uncertainty the ensemble's, not a chosen tolerance.
    """

    profile = spread_profile(field)
    if profile.size < 2 * edge_margin + 3:
        raise ConvergenceError(f"need more than {2 * edge_margin + 2} timesteps, got {profile.size}")

    usable = np.isfinite(profile)
    if not usable.any():
        raise ConvergenceError("spread profile is entirely undefined")

    interior = profile[edge_margin:-edge_margin]
    if interior.size == 0 or not np.isfinite(interior).any():
        raise ConvergenceError("no interior timesteps to search")

    local_index = int(np.nanargmin(interior))
    index = local_index + edge_margin
    minimum = float(profile[index])
    surrounding = float(np.nanmax(profile))
    best_hours = _hours_between(field, index)

    # C3 first: if the field is this diffuse, nothing else is worth reporting.
    if minimum > max_spread_km:
        return AgeEstimate(
            low_hours=float("nan"),
            best_hours=float("nan"),
            high_hours=float("nan"),
            method="none",
            status="beyond_horizon",
            spread_km=minimum,
            explanation=(
                f"minimum spread {minimum:.1f} km exceeds the {max_spread_km:.0f} km "
                "usable limit; the origin field cannot discriminate a source"
            ),
        )

    depth = (surrounding - minimum) / surrounding if surrounding > 0 else 0.0

    # A minimum at the very first interior step means the curve never turned:
    # spread grew from the observation onwards, which is what pure diffusion
    # does and what most real slicks will show.
    turned = local_index > 0
    if not turned or depth < min_relative_depth:
        # Two distinct causes, and conflating them in the message would mislead:
        # a curve that never turned is monotonic spreading, whereas a shallow
        # interior dip is a minimum too weak to trust.
        reason = (
            "spread grew from the observation onwards and never re-focused"
            if not turned
            else f"the interior minimum is only {depth:.1%} below the maximum, "
            f"under the {min_relative_depth:.0%} floor"
        )
        return AgeEstimate(
            low_hours=float("nan"),
            best_hours=float("nan"),
            high_hours=float("nan"),
            method="none",
            status="monotonic",
            spread_km=minimum,
            explanation=(
                f"{reason}; diffusion is irreversible, so no age can be read from "
                "convergence alone. This is physics, not a failure"
            ),
        )

    # The interval: every timestep the field cannot distinguish from the best.
    tolerance = minimum + (surrounding - minimum) * min_relative_depth
    within = [i for i, value in enumerate(profile) if np.isfinite(value) and value <= tolerance]
    low_hours = min(_hours_between(field, i) for i in within)
    high_hours = max(_hours_between(field, i) for i in within)

    return AgeEstimate(
        low_hours=low_hours,
        best_hours=best_hours,
        high_hours=high_hours,
        method="convergence_minimum",
        status="converged",
        spread_km=minimum,
        explanation=(
            f"cloud most concentrated {best_hours:.1f} h before observation at "
            f"{minimum:.2f} km spread, {depth:.1%} below its maximum; interval spans the "
            f"timesteps within {tolerance:.2f} km"
        ),
    )


def age_from_source_coincidence(
    field: OriginField,
    source_lon: float,
    source_lat: float,
    *,
    level: float = 0.9,
) -> AgeEstimate:
    """Age from when the `level` region first covers a candidate source.

    The operationally meaningful signal: it names a place as well as a time, so
    an attribution can be checked against something. Returns
    `insufficient_evidence` when the region never reaches the source — which is
    a real answer, and a better one than the nearest timestep.
    """

    hits = [
        index
        for index in range(field.shape[0])
        if field.contains(index, source_lon, source_lat, level)
    ]
    if not hits:
        return AgeEstimate(
            low_hours=float("nan"),
            best_hours=float("nan"),
            high_hours=float("nan"),
            method="none",
            status="insufficient_evidence",
            spread_km=float(np.nanmin(spread_profile(field))),
            explanation=(
                f"the {level:.0%} origin region never reaches ({source_lon:.4f}, "
                f"{source_lat:.4f}); this source is not supported by the drift field"
            ),
        )

    first, last = min(hits), max(hits)
    # The *first* time the region covers the source is the earliest release
    # consistent with the physics, and the natural point estimate.
    best = _hours_between(field, first)
    return AgeEstimate(
        low_hours=_hours_between(field, first),
        best_hours=best,
        high_hours=_hours_between(field, last),
        method="source_coincidence",
        status="converged",
        spread_km=field.spread_km(first),
        explanation=(
            f"the {level:.0%} origin region first covers the source {best:.1f} h before "
            f"observation and still covers it at {_hours_between(field, last):.1f} h"
        ),
    )


def temporal_state(age: AgeEstimate, *, ongoing_h: float = 6.0, recent_h: float = 24.0) -> str:
    """Map an age onto P004's proposed temporal states.

    `indeterminate` is returned whenever the age is not usable, rather than
    guessing from a partial signal — the states are meant to summarise a
    conclusion, not to manufacture one.
    """

    if not age.is_usable:
        return "indeterminate"
    if age.best_hours <= ongoing_h:
        return "ongoing"
    if age.best_hours <= recent_h:
        return "recent"
    return "legacy"


def coverage_fraction(field: OriginField, index: int, level: float = 0.9) -> float:
    """Share of the grid the `level` region occupies — a diffuseness measure.

    Useful to the evidence card: "the 90% region covers 4% of the search area"
    is legible in a way a spread in kilometres is not.
    """

    mask = highest_density_mask(field.probability[index], level)
    return float(mask.sum() / mask.size)
