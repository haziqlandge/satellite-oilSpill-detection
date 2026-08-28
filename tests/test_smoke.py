"""PHASE-00 smoke tests: the package imports, config loads, models are coherent.

These deliberately do not need a database, a GPU, or the network.
"""

from __future__ import annotations

import pytest
from sqlalchemy import inspect
from typer.testing import CliRunner

import backend
from backend.cli import app
from backend.config import get_settings
from backend.db.models import Base, Candidate, Characterisation, Detection, DriftRun

runner = CliRunner()

EXPECTED_TABLES = {
    "scenes",
    "detections",
    "characterisations",
    "drift_runs",
    "ais_points",
    "ais_tracks",
    "candidates",
    "scores",
}


def test_package_imports() -> None:
    assert backend.__version__


def test_settings_load_without_env_file() -> None:
    settings = get_settings()
    assert settings.database_url.startswith("postgresql+psycopg://")
    assert settings.cache_dir.name == "cache"


def test_all_expected_tables_declared() -> None:
    assert set(Base.metadata.tables) >= EXPECTED_TABLES


def test_cli_help_lists_commands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for command in ("run-scene", "train", "evaluate", "seed-demo", "doctor"):
        assert command in result.stdout


def test_unimplemented_commands_fail_loudly() -> None:
    """A stub must raise, not silently succeed -- otherwise a half-built
    pipeline looks like it ran."""
    result = runner.invoke(app, ["train"])
    assert result.exit_code != 0
    assert isinstance(result.exception, NotImplementedError)
    assert "PHASE-02" in str(result.exception)


# --------------------------------------------------------------------------- #
# Constraint guards -- see PLAN/CONSTRAINTS.md
# --------------------------------------------------------------------------- #
def test_c1_age_is_never_a_scalar_column() -> None:
    """C1: age must be a {low, best, high} triple plus a method."""
    columns = {c.name for c in inspect(DriftRun).columns}
    assert "age_hours" not in columns
    assert {"age_hours_low", "age_hours_best", "age_hours_high", "age_method"} <= columns


def test_c2_no_absolute_thickness_column() -> None:
    """C2: damping ratio is a relative contrast index, never a thickness."""
    columns = {c.name for c in inspect(Characterisation).columns}
    assert not any("thickness" in name for name in columns)
    assert "damping_ratio_db" in columns


def test_c3_insufficient_evidence_is_a_real_state() -> None:
    """C3: a diffuse origin field is a result, not an error."""
    columns = {c.name for c in inspect(DriftRun).columns}
    assert "insufficient_evidence" in columns


def test_c4_scores_store_terms_and_weights() -> None:
    """C4: a bare total is not a storable result."""
    columns = {c.name for c in Base.metadata.tables["scores"].columns}
    assert {"terms", "weights", "weights_version", "evidence"} <= set(columns)


def test_detection_classes_constrained_to_p004_scheme() -> None:
    checks = {c.name for c in Detection.__table__.constraints if c.name}
    assert "ck_detection_class" in checks


def test_dark_vessels_cannot_be_named() -> None:
    """Dark vessels are ranked but never identified."""
    checks = {c.name for c in Candidate.__table__.constraints if c.name}
    assert "ck_dark_vessel_anonymous" in checks


@pytest.mark.integration
def test_database_reachable_with_postgis(db_available: bool) -> None:
    assert db_available
