"""Backward drift, the ensemble, and the honest refusals (PHASE-04).

The test PHASE-04 puts first is `test_advection_is_reversible_without_diffusion`,
and it is first for a reason: OpenDrift documents that a negative `time_step`
runs backwards, but the phase file requires that be **verified empirically
before any result built on it is trusted**. Everything else here is downstream
of that one fact holding.

The rest defend the two constraints that make a drift result admissible as
evidence rather than as decoration:

* **C5** — never a single trajectory. An ensemble is what turns transport
  modelling into probabilistic assessment; one backward run is a confident line
  on a map with no uncertainty attached to it at all.
* **C3** — a field too diffuse to discriminate must say so, not produce a
  suspect anyway.
"""

from __future__ import annotations

import logging
import warnings
from datetime import datetime, timedelta

import numpy as np
import pytest

warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)

from backend.drift.ensemble import (  # noqa: E402
    MIN_MEMBERS,
    WIND_DRIFT_RANGE,
    EnsembleError,
    run_ensemble,
    sample_members,
)
from backend.drift.opendrift_runner import DriftError, Forcing, run_drift  # noqa: E402

# P004 Case 2's published source.
LON, LAT = -89.2254, 28.3589
T0 = datetime(2023, 5, 15, 0, 2)

_KM_LON, _KM_LAT = 97.6, 111.1


def _km_apart(lon_a, lat_a, lon_b, lat_b):
    return np.hypot((np.asarray(lon_a) - lon_b) * _KM_LON, (np.asarray(lat_a) - lat_b) * _KM_LAT)


# --- the foundation --------------------------------------------------------


@pytest.mark.slow
def test_advection_is_reversible_without_diffusion() -> None:
    """Forward then backward over the same interval returns to the seed.

    **The correctness check the whole phase rests on.** With zero diffusivity
    advection is exactly invertible, so any residual is integrator error. If
    this ever fails, no origin field below it means anything -- and it would
    fail silently, producing a plausible-looking field centred in the wrong
    place.

    Measured on opendrift 1.14.11: 12 h out and back over 13.6 km leaves
    mean 0.38 m / max 0.89 m.
    """

    forcing = Forcing(u_current=0.30, v_current=0.10)

    forward = run_drift(
        lon=LON, lat=LAT, start=T0, hours=12, backward=False,
        number=40, forcing=forcing, horizontal_diffusivity=0.0,
    )
    back = run_drift(
        lon=forward.lon, lat=forward.lat, start=T0 + timedelta(hours=12), hours=12,
        backward=True, number=40, forcing=forcing, horizontal_diffusivity=0.0,
    )

    assert _km_apart(forward.lon, forward.lat, LON, LAT).mean() > 5.0, "must actually move"
    assert _km_apart(back.lon, back.lat, LON, LAT).max() < 0.05, "round trip must return"


@pytest.mark.slow
def test_backward_times_descend() -> None:
    """`times[0]` is the observation and `times[-1]` the earliest instant.

    Code assuming an ascending axis builds the origin field back to front, and
    the result looks entirely reasonable.
    """

    result = run_drift(
        lon=LON, lat=LAT, start=T0, hours=6, backward=True,
        number=10, forcing=Forcing(u_current=0.2), horizontal_diffusivity=0.0,
    )

    assert result.times[0] > result.times[-1]
    assert result.times[0] == T0


@pytest.mark.slow
def test_diffusion_widens_the_cloud() -> None:
    """Guards a diffusion setting that silently does nothing.

    If the config key were wrong -- and it differs between OpenDrift versions --
    every run would be advection-only and the origin field would be far too
    confident.
    """

    common = dict(lon=LON, lat=LAT, start=T0, hours=12, backward=True, number=200,
                  forcing=Forcing(u_current=0.2), radius_m=0.0)

    tight = run_drift(**common, horizontal_diffusivity=0.0)
    loose = run_drift(**common, horizontal_diffusivity=50.0)

    tight_spread = _km_apart(tight.lon, tight.lat, tight.lon.mean(), tight.lat.mean()).std()
    loose_spread = _km_apart(loose.lon, loose.lat, loose.lon.mean(), loose.lat.mean()).std()

    assert loose_spread > tight_spread * 2


# --- guardrails ------------------------------------------------------------


def test_a_run_without_forcing_is_refused() -> None:
    """Silently running with no currents would produce a stationary cloud."""

    with pytest.raises(DriftError, match="needs forcing"):
        run_drift(lon=LON, lat=LAT, start=T0, hours=6)


def test_negative_diffusivity_is_refused() -> None:
    with pytest.raises(DriftError, match="non-negative"):
        run_drift(lon=LON, lat=LAT, start=T0, hours=6, forcing=Forcing(), horizontal_diffusivity=-1)


def test_zero_hours_is_refused() -> None:
    with pytest.raises(DriftError, match="hours must be positive"):
        run_drift(lon=LON, lat=LAT, start=T0, hours=0, forcing=Forcing())


# --- C5: it must be an ensemble --------------------------------------------


def test_a_single_trajectory_is_structurally_refused() -> None:
    """C5, enforced rather than documented.

    One backward run is a line on a map that looks authoritative and carries no
    uncertainty. Conditioning an accusation on it is the false precision this
    project exists to avoid.
    """

    with pytest.raises(EnsembleError, match="ensemble, not a trajectory"):
        sample_members(1)
    with pytest.raises(EnsembleError, match="ensemble, not a trajectory"):
        sample_members(MIN_MEMBERS - 1)


def test_members_are_stratified_across_the_parameter_ranges() -> None:
    """Latin hypercube, not independent uniforms.

    With ten members plain random sampling routinely leaves a corner of the
    space unvisited, and the ensemble then understates its own uncertainty.
    """

    members = sample_members(10, seed=0)
    winds = sorted(m.wind_drift_factor for m in members)

    low, high = WIND_DRIFT_RANGE
    assert low <= winds[0] < winds[-1] <= high
    # Every decile occupied exactly once is what stratification buys.
    buckets = {int((w - low) / (high - low) * 10) for w in winds}
    assert len(buckets) == 10


def test_the_wind_phase_shift_is_sampled_both_ways() -> None:
    """Kampouris 2021: sensitivity is to wind *timing*, not only magnitude.

    A one-sided shift would bias every member's drift in the same direction.
    """

    shifts = [m.wind_phase_shift_h for m in sample_members(10, seed=0)]

    assert min(shifts) < 0 < max(shifts)


def test_sampling_is_reproducible() -> None:
    assert sample_members(8, seed=7) == sample_members(8, seed=7)
    assert sample_members(8, seed=7) != sample_members(8, seed=8)


def test_a_timezone_aware_start_is_run_as_naive_utc() -> None:
    """X10: an ISO time with an offset used to die deep in xarray.

    `TypeError: Cannot compare tz-naive and tz-aware datetime-like objects`,
    raised from inside the reader, with nothing pointing at the cause. A
    GeoTIFF or API timestamp is naturally aware, so the engine takes it and
    runs on the same instant in naive UTC, which is what OpenDrift expects.
    """

    from datetime import timezone

    ist = timezone(timedelta(hours=5, minutes=30))
    aware = datetime(2023, 5, 15, 5, 32, tzinfo=ist)  # 00:02 UTC

    result = run_drift(lon=LON, lat=LAT, start=aware, hours=1, number=4,
                       forcing=Forcing(u_current=0.1), time_step_s=1800)

    assert result.times[0] == T0
    assert result.times[0].tzinfo is None


@pytest.mark.slow
def test_an_ensemble_stacks_members_rather_than_averaging_them() -> None:
    """Averaging positions would collapse the ensemble into one trajectory.

    It would also place the "mean" particle somewhere no member ever went.
    """

    result = run_ensemble(
        lon=LON, lat=LAT, start=T0, hours=6, members=MIN_MEMBERS, particles=20,
        forcing=Forcing(u_current=0.2, u_wind=4.0),
    )

    assert result.member_count == MIN_MEMBERS
    assert result.particle_count == MIN_MEMBERS * 20
    assert result.lon_history.shape[1] == result.particle_count


@pytest.mark.slow
def test_ensemble_is_anchored_at_the_requested_observation_time() -> None:
    """Every member shares one clock, anchored at the acquisition time.

    `run_drift` already guarantees `times[0] == start`, and the origin field,
    the age estimate and PHASE-06's AIS gate are all keyed to that axis. The
    ensemble used to apply each member's wind phase shift by moving the run's
    clock and then keep whichever member ran first, so `times[0]` came back as
    `start + shift` -- up to three hours out, with members spanning five hours
    of disagreement while being stacked at the same row index and binned into
    one probability slice.

    A vessel at ten knots covers about fifty kilometres in that error.
    """

    result = run_ensemble(
        lon=LON, lat=LAT, start=T0, hours=4, backward=True,
        members=MIN_MEMBERS, particles=4,
        forcing=Forcing(u_current=0.2), time_step_s=1800,
    )

    assert result.times[0] == T0, "the ensemble must report the observation time it was given"
    assert result.times[0] > result.times[-1], "a backward axis descends"


def test_an_ensemble_reports_each_member_as_it_lands() -> None:
    """The live pipeline streams members to the console; a count it cannot trust is worse than none."""

    seen: list[tuple[int, int]] = []
    run_ensemble(
        lon=LON, lat=LAT, start=T0, hours=2, members=MIN_MEMBERS, particles=5,
        forcing=Forcing(u_current=0.2), progress=lambda done, total: seen.append((done, total)),
    )

    assert seen == [(k, MIN_MEMBERS) for k in range(1, MIN_MEMBERS + 1)]
