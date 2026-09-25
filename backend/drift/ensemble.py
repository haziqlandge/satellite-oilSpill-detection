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

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
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
    lon: float | np.ndarray,
    lat: float | np.ndarray,
    start: datetime,
    hours: int = DEFAULT_HORIZON_H,
    backward: bool = True,
    members: int = DEFAULT_MEMBERS,
    particles: int = DEFAULT_PARTICLES_PER_MEMBER,
    radius_m: float = 500.0,
    forcing: Forcing | None = None,
    readers: list[Any] | Callable[[Member], list[Any]] | None = None,
    seed: int = 0,
    time_step_s: int | None = None,
    coastline_action: str | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> EnsembleResult:
    """Run `members` perturbed drift simulations and stack their histories.

    A member that fails is recorded in `failures` and skipped rather than
    aborting the ensemble — losing one of ten members widens the field slightly,
    where losing the run entirely gives PHASE-06 nothing to gate on. If **every**
    member fails the error is raised, because an empty field is not a result.

    `lon`/`lat` are one point, seeded as a disc of `radius_m`, or arrays of
    `particles` starting positions -- a detected slick's own shape
    (`seeding.points_in_polygon`) -- handed unchanged to every member.

    `progress(done, total)` is called after each member, failed or not, so a
    caller streaming the run (`backend/pipeline`) reports members as they land.

    `readers` may be a function of the member, which is how the wind phase
    shift is applied (ISSUES X9): `era5.drift_readers(..., wind_shift_h=
    member.wind_phase_shift_h)` moves that member's wind in time, never the
    run's clock. Constant forcing has no time axis to shift.
    """

    if not np.isscalar(lon) and np.size(lon) != particles:
        raise EnsembleError(f"{np.size(lon)} seed positions for {particles} particles per member")

    sampled = sample_members(members, seed=seed)

    lon_stack: list[np.ndarray] = []
    lat_stack: list[np.ndarray] = []
    runs: list[Any] = []
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
        # The shift belongs on the forcing's time reference, not the run's: a
        # caller with a time-varying wind passes `readers` as a function of the
        # member and shifts that member's wind reader (ISSUES X9, closed).
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
                readers=readers(member) if callable(readers) else readers,
                horizontal_diffusivity=member.horizontal_diffusivity,
                wind_drift_factor=member.wind_drift_factor,
                time_step_s=time_step_s or DEFAULT_TIME_STEP_S,
                coastline_action=coastline_action,
            )
        except (DriftError, ValueError, RuntimeError) as error:
            failures.append(f"member {member.index}: {error}")
            if progress is not None:
                progress(member.index + 1, len(sampled))
            continue

        runs.append(result)
        if progress is not None:
            progress(member.index + 1, len(sampled))

    if not runs:
        raise EnsembleError(f"every ensemble member failed: {failures[:3]}")

    # OpenDrift stops a member once none of its parcels is afloat (all stranded),
    # hours before the horizon. Its missing rows are that fact -- nothing in the
    # water -- so they are NaN, never positions. Trimming every member to the
    # shortest instead cut the April forecast at +15.8 h while 37% of the oil was
    # still adrift (2026-09-25). Any other difference in length (a step either
    # way) is trimmed as before, so no member is padded with invented rows.
    step = timedelta(seconds=(time_step_s or DEFAULT_TIME_STEP_S) * (-1 if backward else 1))
    horizon = round(hours * 3600 / (time_step_s or DEFAULT_TIME_STEP_S)) + 1
    running = [r for r in runs if r.active_at_end != 0]
    steps = min([horizon] + [r.lon_history.shape[0] for r in running]) if running else horizon
    times = max((r.times for r in runs), key=len)[:steps]
    while len(times) < steps:
        times = (*times, times[-1] + step)
    for r in runs:
        rows = r.lon_history[:steps]
        pad = np.full((steps - rows.shape[0], rows.shape[1]), np.nan)  # only a finished member is short
        lon_stack.append(np.vstack([rows, pad]))
        lat_stack.append(np.vstack([r.lat_history[:steps], pad]))

    return EnsembleResult(
        lon_history=np.concatenate(lon_stack, axis=1),
        lat_history=np.concatenate(lat_stack, axis=1),
        times=times,
        members=sampled,
        particles_per_member=particles,
        failures=tuple(failures),
    )
