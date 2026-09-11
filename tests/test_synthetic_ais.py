"""Synthetic Indian-waters AIS with authored ground truth (PHASE-05).

Two things these tests exist to protect:

**C10 -- ground truth is authored, never detector-derived.** P003 auto-labelled
anomalies with an Isolation Forest and then evaluated against those labels, which
is circular. Here the discharging MMSI, release time and release position are
written by us into a sidecar, and nothing reads them back out of the trajectories.

**The synthetic path is only trustworthy if it is indistinguishable in shape from
the real one.** PHASE-05 calls this "the key test": every generated record must
pass the *real* marinecadastre loader unchanged, so one downstream path serves
both regions.
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime

import pytest

from backend.ingest.ais.behaviour import describe
from backend.ingest.ais.clean import clean_records
from backend.ingest.ais.loader import AIS_COLUMNS, iter_ais_records, parse_ais_row
from backend.ingest.ais.synthetic import (
    REGIONS,
    SCENARIOS,
    ReleaseTruth,
    SyntheticScenario,
    generate_scenario,
    to_csv,
)

WHEN = datetime(2024, 3, 14, 6, 0, tzinfo=UTC)


def _all() -> list[SyntheticScenario]:
    return [generate_scenario(name, acquired_at=WHEN, seed=7) for name in SCENARIOS]


# --- the five authored scenarios --------------------------------------------


def test_all_five_scenarios_exist() -> None:
    """PHASE-05 names five, each mirroring a P004 fixture or testing a gap in them."""

    assert set(SCENARIOS) == {
        "moving_tanker",
        "berthed_discharge",
        "platform_leak",
        "dark_vessel",
        "null_case",
    }


def test_every_scenario_generates_traffic_and_truth() -> None:
    for scenario in _all():
        assert scenario.records, f"{scenario.name} generated no AIS"
        assert isinstance(scenario.truth, ReleaseTruth)
        assert scenario.truth.scenario == scenario.name


def test_regions_are_the_three_indian_areas_named_in_the_plan() -> None:
    assert set(REGIONS) == {"gulf_of_kutch", "mumbai_high", "ennore_chennai"}


# --- the key test: the real loader must accept synthetic output --------------


def test_synthetic_rows_parse_with_the_real_loader() -> None:
    """PHASE-05's key test. If this fails the synthetic path proves nothing."""

    for scenario in _all():
        text = to_csv(scenario.records)
        rows = list(csv.DictReader(io.StringIO(text)))
        assert rows
        for row in rows:
            parse_ais_row(row)


def test_synthetic_csv_carries_exactly_the_provider_columns() -> None:
    scenario = generate_scenario("moving_tanker", acquired_at=WHEN, seed=1)

    header = next(csv.reader(io.StringIO(to_csv(scenario.records))))

    assert set(header) == set(AIS_COLUMNS)


def test_a_written_file_round_trips_through_iter_ais_records(tmp_path) -> None:
    """The whole file path, not just the row parser."""

    scenario = generate_scenario("moving_tanker", acquired_at=WHEN, seed=1)
    path = tmp_path / "synthetic.csv"
    path.write_text(to_csv(scenario.records), encoding="utf-8")

    loaded = list(iter_ais_records(path, strict=True))

    assert len(loaded) == len(scenario.records)
    assert {r.mmsi for r in loaded} == {r.mmsi for r in scenario.records}


def test_synthetic_records_survive_the_real_cleaner() -> None:
    """Generated tracks must not contain impossible jumps or sentinel positions."""

    for scenario in _all():
        cleaned = list(clean_records(scenario.records))
        kept = len(cleaned) / len(scenario.records)
        assert kept > 0.98, f"{scenario.name}: cleaner dropped {1 - kept:.1%}"


# --- C10: authored, not derived ---------------------------------------------


def test_truth_names_the_discharger_the_generator_scripted() -> None:
    scenario = generate_scenario("moving_tanker", acquired_at=WHEN, seed=3)

    assert scenario.truth.has_spill
    assert scenario.truth.discharging_mmsi is not None
    assert scenario.truth.release_lat is not None
    assert scenario.truth.release_lon is not None
    assert scenario.truth.release_start is not None


def test_the_null_case_names_nobody() -> None:
    """A look-alike with no spill. The system must attribute to no vessel."""

    scenario = generate_scenario("null_case", acquired_at=WHEN, seed=3)

    assert not scenario.truth.has_spill
    assert scenario.truth.discharging_mmsi is None
    assert scenario.truth.release_lat is None


def test_the_platform_leak_has_no_discharging_vessel() -> None:
    """Case 1 analogue: infrastructure leaks, vessels merely transit nearby."""

    scenario = generate_scenario("platform_leak", acquired_at=WHEN, seed=3)

    assert scenario.truth.has_spill
    assert scenario.truth.discharging_mmsi is None
    assert scenario.truth.release_lat is not None
    assert scenario.records, "background traffic is what makes this test filtering"


def test_the_dark_vessel_is_absent_from_the_ais() -> None:
    """The defining property: the discharger transmits nothing.

    Its MMSI is known only because we authored it. If it appeared in the AIS the
    scenario would be testing nothing.
    """

    scenario = generate_scenario("dark_vessel", acquired_at=WHEN, seed=3)

    assert scenario.truth.is_dark_vessel
    assert scenario.truth.discharging_mmsi is not None
    assert scenario.truth.discharging_mmsi not in {r.mmsi for r in scenario.records}


def test_a_scripted_discharger_that_is_not_dark_does_appear() -> None:
    for name in ("moving_tanker", "berthed_discharge"):
        scenario = generate_scenario(name, acquired_at=WHEN, seed=3)
        assert scenario.truth.discharging_mmsi in {r.mmsi for r in scenario.records}


# --- the behaviour the scenarios are supposed to exhibit --------------------


def test_the_moving_tanker_reads_as_transiting() -> None:
    scenario = generate_scenario("moving_tanker", acquired_at=WHEN, seed=5)
    track = [r for r in scenario.records if r.mmsi == scenario.truth.discharging_mmsi]

    assert describe(track).is_transiting


def test_the_berthed_discharger_reads_as_loitering() -> None:
    """The Case 3 analogue must reproduce the adversarial signature."""

    scenario = generate_scenario("berthed_discharge", acquired_at=WHEN, seed=5)
    track = [r for r in scenario.records if r.mmsi == scenario.truth.discharging_mmsi]

    assert describe(track).is_loitering


# --- realism and reproducibility --------------------------------------------


def test_background_traffic_is_dense_enough_to_test_filtering() -> None:
    """"A scenario with three vessels does not test filtering" (PHASE-05)."""

    for scenario in _all():
        assert len({r.mmsi for r in scenario.records}) >= 20, scenario.name


def test_generation_is_deterministic_for_a_seed() -> None:
    """Reproducibility: an evaluation run must be repeatable."""

    first = generate_scenario("moving_tanker", acquired_at=WHEN, seed=11)
    second = generate_scenario("moving_tanker", acquired_at=WHEN, seed=11)

    assert [r.mmsi for r in first.records] == [r.mmsi for r in second.records]
    assert first.truth == second.truth


def test_different_seeds_give_different_traffic() -> None:
    first = generate_scenario("moving_tanker", acquired_at=WHEN, seed=1)
    second = generate_scenario("moving_tanker", acquired_at=WHEN, seed=2)

    assert [r.lat for r in first.records] != [r.lat for r in second.records]


def test_positions_stay_within_the_region() -> None:
    for scenario in _all():
        region = REGIONS[scenario.region]
        for record in scenario.records:
            assert region.bbox.contains(lon=record.lon, lat=record.lat), scenario.name


def test_synthetic_mmsis_use_the_indian_maritime_id() -> None:
    """MID 419 is India. It also keeps synthetic MMSIs clear of the US real data."""

    for scenario in _all():
        for record in scenario.records:
            assert str(record.mmsi).startswith("419")


def test_no_record_is_dated_after_the_acquisition() -> None:
    """Traffic is reconstructed backward from the observation, never after it."""

    for scenario in _all():
        for record in scenario.records:
            assert record.base_date_time <= WHEN


def test_each_vessels_own_track_is_chronological() -> None:
    """Ordering across vessels is not required; within a vessel it is."""

    for scenario in _all():
        by_mmsi: dict[int, list[datetime]] = {}
        for record in scenario.records:
            by_mmsi.setdefault(record.mmsi, []).append(record.base_date_time)
        for mmsi, stamps in by_mmsi.items():
            assert stamps == sorted(stamps), f"{scenario.name}: {mmsi} out of order"


def test_an_unknown_scenario_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown scenario"):
        generate_scenario("not_a_scenario", acquired_at=WHEN, seed=1)


def test_a_naive_acquisition_time_is_rejected() -> None:
    with pytest.raises(ValueError, match=r"(?i)utc|aware|timezone"):
        generate_scenario("moving_tanker", acquired_at=datetime(2024, 3, 14, 6, 0), seed=1)


def test_scenarios_do_not_share_mmsis_at_the_same_seed() -> None:
    """Found 2026-08-30: every scenario drew the same discharger MMSI.

    The generator is seeded identically per scenario, so the same identifier was
    a moving tanker in one and a berthed vessel in another. Loading two scenarios
    into one database would make a single MMSI contradict itself, and the demo
    presents these side by side.
    """

    fleets = {
        name: {r.mmsi for r in generate_scenario(name, acquired_at=WHEN, seed=7).records}
        for name in SCENARIOS
    }

    names = sorted(fleets)
    for index, first in enumerate(names):
        for second in names[index + 1 :]:
            overlap = fleets[first] & fleets[second]
            assert not overlap, f"{first} and {second} share MMSIs {sorted(overlap)[:3]}"


def test_dischargers_are_distinct_across_scenarios() -> None:
    scripted = [
        generate_scenario(name, acquired_at=WHEN, seed=7).truth.discharging_mmsi
        for name in SCENARIOS
    ]
    named = [mmsi for mmsi in scripted if mmsi is not None]

    assert len(named) == len(set(named))
