"""A morphology prior on slick age -- a sanity bound, not an age (PHASE-03).

The age this system reports comes from backward-drift convergence
(`backend/drift/convergence.py`, PHASE-04). There is no reliable SAR-to-age
regressor in the literature (`RESEARCH/topics/slick-age-estimation.md`), and
this module does not pretend to be one. It answers a narrower question: *how
long would oil take to spread this wide by Fay's surface-tension spreading?*

**Why that regime.** Fay's one-dimensional laws (Fay 1971) for oil spreading
across a line source are, for slick half-width `l`:

    gravity-inertia    l = 1.5  (delta g A t^2)^(1/3)
    gravity-viscous    l = 1.5  (delta g A^2 t^(3/2) / nu^(1/2))^(1/4)
    surface tension    l = 1.33 (sigma^2 t^3 / (rho_w^2 nu_w))^(1/4)

where `A` is the oil volume per unit length of slick. The first two need `A`,
which SAR cannot give (C2 forbids reading a thickness off the damping ratio).
The surface-tension law does not: it depends only on the net spreading
coefficient `sigma` and the water. Solving it for `t` at the observed width is
therefore the one Fay-consistent time that can be computed from a mask alone.
`k3 = 1.33` is Fay and Hoult's value, fitted to Garrett and Barger's
experiments.

**Why it is a loose ceiling, not an estimate.** Everything Fay's law leaves
out makes real oil spread FASTER: the earlier gravity stages, wind shear,
turbulent diffusion, Langmuir cells. So the time Fay needs to reach a width is
usually longer than the time the sea took. Read the triple as "oil this wide
has probably not been spreading for much longer than this", and only as a
cross-check on the drift age.

**Which width.** On a discharge trail the slick is a time series laid out in
space: the oldest oil is at the wide end (P004 Case 2's head/tail width
change). So the prior is read from the widest third of the width profile.

**The interval** spans the net spreading coefficient over 0.01-0.03 N/m
(10-30 dyn/cm, the range usually assumed for crude oil; it falls as oil
weathers, and the exact range is not verified here); `t` scales as
`sigma^(-2/3)`, so the interval is about 2.1x wide. It does not carry the
larger error of the regime assumption itself, which is why `confidence` is
"very_low" and why this never feeds `DriftRun.age_*` (those columns accept
only the drift methods, `backend/db/models.py`).

C1 is structural: there is no scalar to read, only `low_hours`, `best_hours`,
`high_hours` and the `method`.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

# Fay 1971, one-dimensional surface-tension spreading constant.
FAY_K3 = 1.33
SEAWATER_DENSITY = 1025.0  # kg/m^3
SEAWATER_VISCOSITY = 1.05e-6  # m^2/s, kinematic, about 20 C
# Net spreading coefficient, N/m: (high, best, low) -> (fastest, best, slowest).
SPREADING_COEFFICIENT = (0.03, 0.02, 0.01)


@dataclass(frozen=True, slots=True)
class MorphologyAgePrior:
    """Hours Fay's surface-tension spreading needs to reach the observed width. Never a bare scalar (C1)."""

    low_hours: float
    best_hours: float
    high_hours: float
    width_m: float
    method: Literal["morphology_prior"] = "morphology_prior"
    confidence: Literal["very_low"] = "very_low"
    explanation: str = ""


def fay_surface_tension_hours(width_m: float, sigma: float) -> float:
    """Time for a line-source slick to spread to `width_m` in Fay's surface-tension regime."""

    if not (width_m > 0 and sigma > 0):
        raise ValueError(f"width and spreading coefficient must be positive, got {width_m}, {sigma}")
    half_width = width_m / 2.0
    seconds = ((half_width / FAY_K3) ** 4 * SEAWATER_DENSITY**2 * SEAWATER_VISCOSITY / sigma**2) ** (1.0 / 3.0)
    return float(seconds) / 3600.0


def morphology_prior(width_profile_m: Sequence[float]) -> MorphologyAgePrior:
    """The prior from a width profile (any order; the widest third is used)."""

    widths = sorted(float(w) for w in width_profile_m if math.isfinite(float(w)) and float(w) > 0)
    if not widths:
        raise ValueError("no positive width to read a prior from")
    widest = widths[-max(1, len(widths) // 3):]
    width = sum(widest) / len(widest)
    fast, best, slow = (fay_surface_tension_hours(width, s) for s in SPREADING_COEFFICIENT)
    return MorphologyAgePrior(
        low_hours=fast,
        best_hours=best,
        high_hours=slow,
        width_m=width,
        explanation=(
            f"Fay surface-tension spreading to {width:.0f} m (the widest third of the slick) takes "
            f"{fast:.1f}-{slow:.1f} h for a spreading coefficient of {SPREADING_COEFFICIENT[0]}-"
            f"{SPREADING_COEFFICIENT[2]} N/m. Real oil spreads faster than Fay alone, so this is a loose "
            "ceiling to check the drift age against, not an age."
        ),
    )
