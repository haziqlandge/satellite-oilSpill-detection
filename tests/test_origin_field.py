"""The origin probability field and the age estimate (PHASE-04).

Two things are being defended.

**The field must be a probability, and an honest one.** Each timestep integrates
to 1.0, and the field is allowed -- required -- to *widen* with backward time.
Diffusion is irreversible, so a narrow origin field at 48 h would be a bug or a
lie. `spread_km` exposes the widening rather than hiding it.

**The age estimator must be willing to say nothing.** For many real slicks there
is no convergence minimum at all: the spread grows monotonically and the "most
concentrated" timestep is just the observation, which says nothing. PHASE-04
names that a known failure condition and calls it physics, not a bug. C3 makes
the required behaviour explicit -- return `insufficient_evidence`, never a
forced suspect -- and most of these tests are about that refusal working.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pytest

from backend.drift.convergence import (
    MAX_USEFUL_SPREAD_KM,
    AgeEstimate,
    ConvergenceError,
    age_from_source_coincidence,
    coverage_fraction,
    estimate_age,
    spread_profile,
    temporal_state,
)
from backend.drift.origin_field import (
    OriginFieldError,
    build_origin_field,
    contour_geojson,
    highest_density_mask,
)

T0 = datetime(2023, 5, 15, 0, 2)
LON, LAT = -89.2254, 28.3589


def _history(spreads_deg: list[float], *, particles: int = 400, seed: int = 0):
    """A synthetic backward history whose spread follows `spreads_deg`.

    Backward times descend, matching what `run_drift` returns.
    """

    rng = np.random.default_rng(seed)
    lon = np.empty((len(spreads_deg), particles))
    lat = np.empty_like(lon)
    for step, spread in enumerate(spreads_deg):
        lon[step] = LON + rng.normal(0, max(spread, 1e-6), particles)
        lat[step] = LAT + rng.normal(0, max(spread, 1e-6), particles)
    times = tuple(T0 - timedelta(hours=step) for step in range(len(spreads_deg)))
    return lon, lat, times


# --- the field is a probability --------------------------------------------


def test_every_timestep_integrates_to_one() -> None:
    lon, lat, times = _history([0.01, 0.02, 0.03])
    field = build_origin_field(lon, lat, times)

    sums = field.probability.reshape(field.shape[0], -1).sum(axis=1)
    assert np.allclose(sums, 1.0)


def test_spread_grows_with_backward_time() -> None:
    """The diffusion guard. A field that does not widen is not diffusing."""

    lon, lat, times = _history([0.005, 0.01, 0.02, 0.04])
    field = build_origin_field(lon, lat, times)

    spreads = spread_profile(field)
    assert np.all(np.diff(spreads) > 0), spreads


def test_the_source_lies_inside_the_ninety_percent_region() -> None:
    """PHASE-04's backward hit-rate criterion, on a field centred on truth."""

    lon, lat, times = _history([0.01, 0.02, 0.03])
    field = build_origin_field(lon, lat, times)

    assert field.contains(0, LON, LAT, 0.9)


def test_a_distant_point_is_outside_the_region() -> None:
    """The converse -- otherwise `contains` could be trivially true."""

    lon, lat, times = _history([0.01, 0.02, 0.03])
    field = build_origin_field(lon, lat, times)

    assert not field.contains(0, LON + 5.0, LAT + 5.0, 0.9)


def test_the_ninety_percent_region_is_larger_than_the_fifty() -> None:
    lon, lat, times = _history([0.02, 0.03])
    field = build_origin_field(lon, lat, times)

    fifty = highest_density_mask(field.probability[0], 0.5).sum()
    ninety = highest_density_mask(field.probability[0], 0.9).sum()
    assert fifty < ninety


def test_the_region_holds_the_mass_it_claims() -> None:
    """A highest-density region, not a raw threshold.

    A `P >= x` cut would enclose a mass that changes with grid resolution, so
    "90% contour" would quietly stop meaning 90%.
    """

    lon, lat, times = _history([0.02])
    field = build_origin_field(lon, lat, times)

    for level in (0.5, 0.9):
        mask = highest_density_mask(field.probability[0], level)
        assert field.probability[0][mask].sum() >= level - 1e-9


def test_deactivated_particles_are_dropped_not_filled(caplog) -> None:
    """A stranded particle must not pull mass to an arbitrary place."""

    lon, lat, times = _history([0.01, 0.02])
    lon[1, :100] = np.nan
    lat[1, :100] = np.nan

    field = build_origin_field(lon, lat, times)

    assert np.isclose(field.probability[1].sum(), 1.0)


def test_mismatched_history_shapes_are_refused() -> None:
    lon, lat, times = _history([0.01, 0.02])
    with pytest.raises(OriginFieldError, match="shapes differ"):
        build_origin_field(lon, lat[:, :10], times)


def test_a_history_with_no_finite_positions_is_refused() -> None:
    lon, lat, times = _history([0.01, 0.02])
    with pytest.raises(OriginFieldError, match="no finite particle positions"):
        build_origin_field(np.full_like(lon, np.nan), np.full_like(lat, np.nan), times)


def test_contours_are_emitted_for_both_levels() -> None:
    lon, lat, times = _history([0.02, 0.03])
    field = build_origin_field(lon, lat, times)

    collection = contour_geojson(field, 0)

    assert collection["type"] == "FeatureCollection"
    assert [f["properties"]["level"] for f in collection["features"]] == [0.5, 0.9]
    assert all(f["geometry"]["type"] == "MultiPolygon" for f in collection["features"])
    assert all("spread_km" in f["properties"] for f in collection["features"])


# --- the age estimate, and its refusals ------------------------------------


def test_a_monotonic_spread_yields_no_age() -> None:
    """The common real case, and it must not be dressed up as an answer.

    Pure diffusion spreads from the observation onwards. There is no
    convergence minimum to find, and inventing one would be the false precision
    the whole project is built to avoid.
    """

    lon, lat, times = _history([0.005 * (step + 1) for step in range(12)])
    age = estimate_age(build_origin_field(lon, lat, times))

    assert age.status == "monotonic"
    assert age.method == "none"
    assert not age.is_usable
    assert "never re-focused" in age.explanation


def test_a_genuine_convergence_minimum_is_found() -> None:
    """A cloud that re-focuses and then spreads again has a real age."""

    spreads = [0.05, 0.04, 0.03, 0.02, 0.008, 0.02, 0.03, 0.045, 0.06, 0.07, 0.08]
    lon, lat, times = _history(spreads)
    age = estimate_age(build_origin_field(lon, lat, times))

    assert age.status == "converged"
    assert age.method == "convergence_minimum"
    assert age.is_usable
    assert age.low_hours <= age.best_hours <= age.high_hours
    assert age.best_hours == pytest.approx(4.0, abs=1.5)


def test_an_over_diffuse_field_reports_beyond_horizon() -> None:
    """C3: the required behaviour when the field cannot discriminate."""

    huge = MAX_USEFUL_SPREAD_KM / 111.0 * 3
    lon, lat, times = _history([huge * (1 + 0.1 * s) for s in range(10)])
    age = estimate_age(build_origin_field(lon, lat, times))

    assert age.status in {"beyond_horizon", "monotonic"}
    assert not age.is_usable
    assert age.method == "none"


def test_an_age_is_never_a_bare_scalar() -> None:
    """C1, structurally: there is nowhere to put a point estimate."""

    fields = set(AgeEstimate.__dataclass_fields__)

    assert {"low_hours", "best_hours", "high_hours", "method"} <= fields
    assert "age_hours" not in fields  # no single-value field exists


def test_the_serialised_age_carries_its_method_and_status() -> None:
    spreads = [0.05, 0.04, 0.02, 0.008, 0.02, 0.04, 0.05, 0.06, 0.07]
    lon, lat, times = _history(spreads)
    payload = estimate_age(build_origin_field(lon, lat, times)).as_dict()

    assert set(payload["age_hours"]) == {"low", "best", "high"}
    assert payload["age_method"]
    assert payload["status"]
    assert payload["explanation"]


def test_too_few_timesteps_is_an_error_not_a_guess() -> None:
    lon, lat, times = _history([0.01, 0.02])
    with pytest.raises(ConvergenceError, match="timesteps"):
        estimate_age(build_origin_field(lon, lat, times))


# --- source coincidence -----------------------------------------------------


def test_source_coincidence_finds_a_covered_source() -> None:
    lon, lat, times = _history([0.01, 0.02, 0.03, 0.04])
    age = age_from_source_coincidence(build_origin_field(lon, lat, times), LON, LAT)

    assert age.status == "converged"
    assert age.method == "source_coincidence"


def test_a_source_the_field_never_reaches_is_insufficient_evidence() -> None:
    """C3 again: a real answer, and better than naming the nearest timestep."""

    lon, lat, times = _history([0.01, 0.02, 0.03])
    age = age_from_source_coincidence(build_origin_field(lon, lat, times), LON + 4.0, LAT + 4.0)

    assert age.status == "insufficient_evidence"
    assert age.method == "none"
    assert not age.is_usable
    assert "not supported by the drift field" in age.explanation


# --- temporal state ---------------------------------------------------------


def test_an_unusable_age_is_indeterminate_not_guessed() -> None:
    lon, lat, times = _history([0.005 * (s + 1) for s in range(12)])
    age = estimate_age(build_origin_field(lon, lat, times))

    assert temporal_state(age) == "indeterminate"


@pytest.mark.parametrize(
    ("hours", "expected"), [(2.0, "ongoing"), (12.0, "recent"), (40.0, "legacy")]
)
def test_temporal_states_map_from_the_age(hours: float, expected: str) -> None:
    age = AgeEstimate(
        low_hours=hours - 1, best_hours=hours, high_hours=hours + 1,
        method="convergence_minimum", status="converged", spread_km=1.0, explanation="",
    )

    assert temporal_state(age) == expected


def test_coverage_fraction_is_a_share_of_the_grid() -> None:
    lon, lat, times = _history([0.02, 0.03])
    field = build_origin_field(lon, lat, times)

    assert 0.0 < coverage_fraction(field, 0, 0.9) <= 1.0
