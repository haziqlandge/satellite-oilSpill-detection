"""Shared test fixtures.

Tests that need a live PostGIS are marked `integration` and skip automatically
when no database is reachable, so `pytest` stays green on a machine with only
the Python environment set up (PLAN/PHASE-00.md).
"""

from __future__ import annotations

import pytest

from backend.db.session import check_connection


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    db_ok, detail = check_connection()
    if db_ok:
        return
    skip_db = pytest.mark.skip(reason=f"no PostGIS available ({detail})")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_db)


@pytest.fixture(scope="session")
def db_available() -> bool:
    ok, _ = check_connection()
    return ok
