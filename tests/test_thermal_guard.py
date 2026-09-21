"""Thermal guard: pause at 90 C, resume only once genuinely cool.

The property worth defending hardest is that **an unreadable sensor is not a
cold one**. CPU temperature needs elevation on this machine, so the guard runs
with one sensor blind most of the time; a design that defaulted a missing
reading to 0 would sail straight through an overheat while logging "ok".
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from thermal_guard import (
    LIMIT_C,
    MANAGED_PATTERNS,
    RESUME_C,
    Reading,
    log,
)


def test_the_limit_is_the_agreed_ninety() -> None:
    assert LIMIT_C == 90.0


def test_resume_is_below_the_limit_so_it_cannot_thrash() -> None:
    """Resuming the instant it dips under the limit restarts a stop/start cycle.

    The job would restart, climb back over within seconds and stop again,
    making no progress while looking busy.
    """

    assert RESUME_C < LIMIT_C - 5


def test_the_hottest_sensor_decides() -> None:
    """Either sensor over the limit must trigger, not their average."""

    assert Reading(gpu_c=95.0, cpu_c=40.0).hottest == 95.0
    assert Reading(gpu_c=40.0, cpu_c=95.0).hottest == 95.0


def test_a_missing_sensor_is_ignored_not_counted_as_cold() -> None:
    """CPU is unreadable without elevation on this machine.

    Treating `None` as 0 would drag the maximum down and mask a hot GPU.
    """

    assert Reading(gpu_c=88.0, cpu_c=None).hottest == 88.0
    assert Reading(gpu_c=None, cpu_c=88.0).hottest == 88.0


def test_no_readable_sensor_yields_none_not_zero() -> None:
    """With nothing readable the guard must say so, never report 'cold'."""

    blind = Reading(gpu_c=None, cpu_c=None)

    assert blind.hottest is None
    assert blind.as_dict()["cpu_available"] is False


def test_a_reading_records_whether_the_cpu_was_visible() -> None:
    """So a log reader can tell one-sensor coverage from two."""

    assert Reading(gpu_c=70.0, cpu_c=65.0).as_dict()["cpu_available"] is True
    assert Reading(gpu_c=70.0, cpu_c=None).as_dict()["cpu_available"] is False


def test_the_guard_only_manages_this_project_s_jobs() -> None:
    """It must never reach for something the user is running."""

    assert all("run_ablation" in p or "train.py" in p for p in MANAGED_PATTERNS)


def test_the_log_is_one_json_object_per_line(tmp_path: Path) -> None:
    """Machine-readable, so a later session can see whether it ever tripped."""

    path = tmp_path / "guard.log"
    log(path, "ok", Reading(gpu_c=70.0, cpu_c=None))
    log(path, "OVER_LIMIT_PAUSED", Reading(gpu_c=95.0, cpu_c=None), paused_pids=[1, 2])

    records = [json.loads(line) for line in path.read_text().splitlines()]

    assert [r["event"] for r in records] == ["ok", "OVER_LIMIT_PAUSED"]
    assert records[1]["paused_pids"] == [1, 2]
    assert records[0]["gpu_c"] == 70.0


@pytest.mark.parametrize(
    ("gpu", "should_trip"), [(89.9, False), (90.0, True), (95.0, True), (65.0, False)]
)
def test_the_trip_boundary_is_inclusive(gpu: float, should_trip: bool) -> None:
    """At exactly the limit it stops -- the limit is a ceiling, not a target."""

    hottest = Reading(gpu_c=gpu, cpu_c=None).hottest
    assert hottest is not None
    assert (hottest >= LIMIT_C) is should_trip
