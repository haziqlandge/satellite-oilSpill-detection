"""The morphology age prior (C1) and the assembled characterisation (PHASE-03)."""

from __future__ import annotations

import dataclasses
import json
import math
from datetime import datetime

import pytest
from shapely.affinity import rotate
from shapely.geometry import box
from shapely.ops import transform

from backend.characterize.age import (
    FAY_K3,
    SEAWATER_DENSITY,
    SEAWATER_VISCOSITY,
    MorphologyAgePrior,
    fay_surface_tension_hours,
    morphology_prior,
)
from backend.characterize.characterise import characterise_outline
from backend.characterize.damping import Damping
from backend.characterize.geometry import local_projection
from backend.characterize.windgate import WindSample, wind_gate


def test_fay_time_is_the_surface_tension_law_solved_for_t():
    # l = k3 (sigma^2 t^3 / (rho^2 nu))^(1/4), with l the half-width: check by substituting back.
    hours = fay_surface_tension_hours(640.0, 0.02)
    t = hours * 3600
    half_width = FAY_K3 * (0.02**2 * t**3 / (SEAWATER_DENSITY**2 * SEAWATER_VISCOSITY)) ** 0.25
    assert half_width == pytest.approx(320.0, rel=1e-9)
    assert 5.0 < hours < 6.5
    # Width scales as t^(3/4), so twice the width takes 2^(4/3) the time.
    assert fay_surface_tension_hours(1280.0, 0.02) / hours == pytest.approx(2 ** (4 / 3))
    with pytest.raises(ValueError):
        fay_surface_tension_hours(0.0, 0.02)


def test_prior_is_an_ordered_triple_with_a_method_never_a_scalar():
    prior = morphology_prior([220, 260, 300, 400, 500, 640])
    assert prior.low_hours <= prior.best_hours <= prior.high_hours
    assert prior.method == "morphology_prior" and prior.confidence == "very_low"
    assert "not an age" in prior.explanation
    # C1, type-level: no field holds a single age.
    names = {f.name for f in dataclasses.fields(MorphologyAgePrior)}
    assert {"low_hours", "best_hours", "high_hours", "method"} <= names
    assert not names & {"age", "age_hours", "hours"}


def test_prior_reads_the_widest_third():
    prior = morphology_prior([100, 100, 100, 100, 600, 900])
    assert prior.width_m == pytest.approx(750.0)
    with pytest.raises(ValueError):
        morphology_prior([0, math.nan])


def _ribbon():
    _, inverse = local_projection(-89.4, 28.6)
    return transform(inverse, rotate(box(-4000, -200, 4000, 200), 20, origin=(0, 0)))


def test_characterisation_fills_the_database_row():
    from backend.db.models import Characterisation as Row

    wind = WindSample(speed_ms=2.8, from_deg=200.0, u_ms=1.0, v_ms=2.6, grid_lon=-89.5, grid_lat=28.5,
                      valid_time=datetime(2023, 5, 15), offset_s=-120.0, source="test")
    damping = Damping(-5.5, -19.0, -13.5, 3000, 12000, 150.0, 1000.0, "test")
    c = characterise_outline(_ribbon(), damping=damping, wind=wind)
    row = c.as_row()
    columns = {col.name for col in Row.__table__.columns} - {"id", "detection_id"}
    assert set(row) == columns
    assert row["damping_confidence"] == "low"
    assert row["wind_gate_multiplier"] == pytest.approx(wind_gate(2.8)) and 0 < row["wind_gate_multiplier"] < 1
    assert row["length_km"] == pytest.approx(8.0, rel=0.01)
    assert row["head"].startswith("SRID=4326;POINT(")


def test_console_record_is_json_safe_and_says_what_was_not_measured():
    c = characterise_outline(_ribbon())
    record = c.as_console("real-test-det")
    text = json.dumps(record, allow_nan=False)
    assert '"dampingRatioDb": null' in text and '"windGateMultiplier": null' in text
    # Everything the console's Characterisation type declares is present.
    for key in ("detectionId", "areaKm2", "lengthKm", "widthMMean", "widthMProfile", "orientationDeg",
                "elongation", "compactness", "fragmentation", "head", "tail", "headTailResolvedBy",
                "medialAxis", "dampingRatioDb", "dampingConfidence", "windSpeedMs", "windGateMultiplier"):
        assert key in record
    assert record["dampingConfidence"] == "low"
    assert record["agePrior"]["method"] == "morphology_prior"
