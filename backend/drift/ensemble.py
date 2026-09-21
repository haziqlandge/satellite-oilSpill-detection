"""Ensemble backward drift (PHASE-04).

**C5: never a single trajectory.** P002 via Kampouris is the reason — an
ensemble is what turns trajectory modelling into probabilistic assessment rather
than a point prediction dressed up as one. A single backward run produces a line
on a map that looks authoritative and carries no uncertainty at all; conditioning
an accusation on it would be the worst kind of false precision. `run_ensemble`
refuses fewer than `MIN_MEMBERS` members structurally, rather than by convention.

**What is sampled, and why those three.**

| Parameter | Range | Why |
|---|---|---|
| wind drift factor | 0.02-0.04 | The standard empirical range; the dominant surface-drift uncertainty |
| horizontal diffusivity | 1-50 m²/s | Sub-grid mixing the forcing does not resolve |
| **wind phase shift** | ±3 h | Kampouris 2021 found substantial sensitivity to wind *timing* specifically, not just magnitude |

The wind phase shift is the one that would be easy to leave out and is
specifically called for: getting the wind an hour early or late moves a slick
further than getting its speed slightly wrong.

**Members are stacked on the particle axis, not averaged.** Averaging member
positions would collapse the ensemble back into a single trajectory — the exact
thing C5 forbids — and would place the "mean" particle somewhere no member ever
went. The origin field bins all members' particles together, so ensemble spread
and within-member spread contribute to the same distribution, which is what
makes the result a probability.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np

from backend.drift.opendrift_runner import (
    DEFAULT_HORIZON_H,
    DEFAULT_TIME_STEP_S,
    DriftError,
    Forcing,
    run_drift,
)

# Below this an "ensemble" is not one. Structural, per C5.
MIN_MEMBERS = 5

# Kampouris 2021 / standard practice.
WIND_DRIFT_RANGE = (0.02, 0.04)
DIFFUSIVITY_RANGE_M2S = (1.0, 50.0)
WIND_PHASE_SHIFT_H = 3.0

DEFAULT_MEMBERS = 10
DEFAULT_PARTICLES_PER_MEMBER = 200

# PHASE-04 caps an ensemble at 5 minutes per detection so the demo stays live.
TARGET_RUNTIME_S = 300


class EnsembleError(RuntimeError):
    """The ensemble could not be run as specified."""


@dataclass(frozen=True, slots=True)
class Member:
    """One sampled parameter set."""

    index: int
    wind_drift_factor: float
    horizontal_diffusivity: float
    wind_phase_shift_h: float

    def as_dict(self) -> dict[str, float]:
        return {
            "wind_drift_factor": round(self.wind_drift_factor, 5),
            "horizontal_diffusivity": round(self.horizontal_diffusivity, 3),
            "wind_phase_shift_h": round(self.wind_phase_shift_h, 3),
        }


@dataclass(frozen=True, slots=True)
class EnsembleResult:
    """Every member's particle history, stacked on the particle axis."""

    lon_history: np.ndarray  # (timestep, member * particles)
    lat_history: np.ndarray
    times: tuple[datetime, ...]
    members: tuple[Member, ...]
    particles_per_member: int
    failures: tuple[str, ...] = field(default_factory=tuple)

    @property
    def member_count(self) -> int:
        return len(self.members)

    @property
    def particle_count(self) -> int:
        return int(self.lon_history.shape[1])


def sample_members(count: int, *, seed: int = 0) -> tuple[Member, ...]:
    """Draw `count` parameter sets by Latin hypercube over the three ranges.

    Latin hypercube rather than independent uniforms: with ten members, plain
    random sampling routinely leaves a whole corner of the parameter space
    unvisited, and the resulting spread understates the real uncertainty.
    Stratifying guarantees each range is covered once per member.
    """

    if count < MIN_MEMBERS:
        raise EnsembleError(
            f"C5 requires an ensemble, not a trajectory: {count} members is fewer than "
            f"the {MIN_MEMBERS} minimum"
        )

    rng = np.random.default_rng(seed)

    def stratified(low: float, high: float) -> np.ndarray:
        edges = (np.arange(count) + rng.random(count)) / count
        return low + edges * (high - low)

    wind = rng.permutation(stratified(*WIND_DRIFT_RANGE))
    diffusivity = rng.permutation(stratified(*DIFFUSIVITY_RANGE_M2S))
    phase = rng.permutation(stratified(-WIND_PHASE_SHIFT_H, WIND_PHASE_SHIFT_H))

    return tuple(
        Member(
            index=index,
            wind_drift_factor=float(wind[index]),
            horizontal_diffusivity=float(diffusivity[index]),
            wind_phase_shift_h=float(phase[index]),
        )
        for index in range(count)
    )


def run_ensemble(
    *,
    lon: float,
    lat: float,
    start: datetime,
    hours: int = DEFAULT_HORIZON_H,
    backward: bool = True,
    members: int = DEFAULT_MEMBERS,
    particles: int = DEFAULT_PARTICLES_PER_MEMBER,
    radius_m: float = 500.0,
    forcing: Forcing | None = None,
    readers: list[Any] | None = None,
    seed: int = 0,
    time_step_s: int | None = None,
) -> EnsembleResult:
    """Run `members` perturbed drift simulations and stack their histories.

    A member that fails is recorded in `failures` and skipped rather than
    aborting the ensemble — losing one of ten members widens the field slightly,
    where losing the run entirely gives PHASE-06 nothing to gate on. If **every**
    member fails the error is raised, because an empty field is not a result.
    """

    sampled = sample_members(members, seed=seed)

    lon_stack: list[np.ndarray] = []
    lat_stack: list[np.ndarray] = []
    times: tuple[datetime, ...] = ()
    failures: list[str] = []

    for member in sampled:
        # Every member shares one clock, anchored at the observation.
        #
        # This used to pass `start + member.wind_phase_shift_h`, on the reading
        # that moving the run's clock is what "the wind arrived early or late"
        # means. The intent is right and the mechanism was not. Moving the clock
        # also moves the output axis, and `times` below is taken from whichever
        # member ran first, so the ensemble reported `start + shift` as the
        # observation -- measured at +2.757 h for `seed=0` -- while members
        # spanned 5.32 h of disagreement yet were stacked at the same row index
        # and binned into a single probability slice. The origin field, the age
        # estimate and PHASE-06's AIS gate all key off that axis, and a vessel
        # at ten knots covers about fifty kilometres in that error.
        #
        # No test caught it because every test uses constant `Forcing`, where
        # shifting the clock leaves the trajectory identical and only relabels
        # it -- so the shift contributed no diversity and corrupted the axis.
        #
        # The shift belongs on the forcing's time reference, not the run's, and
        # that needs a reader-side offset. `wind_phase_shift_h` is still sampled
        # and reported in `Member.as_dict()`, but it is NOT applied until real
        # time-varying readers exist. See FUTURE_WORK.md.
        try:
            result = run_drift(
                lon=lon,
                lat=lat,
                start=start,
                hours=hours,
                backward=backward,
                number=particles,
                radius_m=radius_m,
                forcing=forcing,
                readers=readers,
                horizontal_diffusivity=member.horizontal_diffusivity,
                wind_drift_factor=member.wind_drift_factor,
                time_step_s=time_step_s or DEFAULT_TIME_STEP_S,
            )
        except (DriftError, ValueError, RuntimeError) as error:
            failures.append(f"member {member.index}: {error}")
            continue

        if not times:
            times = result.times
        # Members can differ by a step if a run ends early; trim to the shortest
        # so the stack stays rectangular and no member is padded with invented
        # positions.
        steps = min(len(times), result.lon_history.shape[0])
        times = times[:steps]
        lon_stack = [array[:steps] for array in lon_stack]
        lat_stack = [array[:steps] for array in lat_stack]
        lon_stack.append(result.lon_history[:steps])
        lat_stack.append(result.lat_history[:steps])

    if not lon_stack:
        raise EnsembleError(f"every ensemble member failed: {failures[:3]}")

    return EnsembleResult(
        lon_history=np.concatenate(lon_stack, axis=1),
        lat_history=np.concatenate(lat_stack, axis=1),
        times=times,
        members=sampled,
        particles_per_member=particles,
        failures=tuple(failures),
    )
