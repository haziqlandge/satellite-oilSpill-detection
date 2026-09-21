"""Pause long GPU work when the hardware gets too hot, and resume when it cools.

Set by the user 2026-09-01: **at 90 C, pause the training process tree, wait for
the temperature to fall, then resume the same processes.**

Run alongside a long job:

    .venv/Scripts/python.exe scripts/thermal_guard.py --command "..."
    .venv/Scripts/python.exe scripts/thermal_guard.py --watch-only

**What can and cannot be read on this machine.**

*GPU: yes.* `nvidia-smi --query-gpu=temperature.gpu` works unprivileged and is
the number that matters here, because training is what loads the hardware.

*CPU: only through a real package sensor.* LibreHardwareMonitor and
OpenHardwareMonitor WMI are used when either is running. The ACPI thermal-zone
counter is deliberately rejected: it reports the chassis/ambient zone on this
machine (about 28 C while Armoury Crate reports the CPU near 70 C), so treating
it as the CPU would defeat the guard.

CPU temperature is **read when available and otherwise blocks startup by
default**. `--allow-missing-cpu` is only for an actively supervised run where
Armoury Crate is being watched separately.

**Hysteresis matters.** Restarting the moment the temperature dips below the
limit produces a thrash cycle: the job restarts, the temperature climbs back
over in seconds, and it stops again. `RESUME_C` is well below `LIMIT_C` so the
hardware genuinely cools before work resumes.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

# The user's current limit. Raised from 85 to 90 C on 2026-09-01 after the
# guarded run reached the earlier boundary too quickly.
LIMIT_C = 90.0

# Resume only once genuinely cool. A margin this wide is what prevents a
# stop/start thrash cycle around the limit.
#
# 80 rather than a tighter number because the GPU's *normal* load temperature on
# this machine is 73-77 C. A resume threshold set inside that band would restart
# the job into a temperature it immediately re-reaches, which is the thrash this
# margin exists to prevent -- the guard would look busy and make no progress.
# With the job stopped the card falls to ~50 C in well under a minute, so a
# 10 C margin costs almost nothing in practice.
RESUME_C = 80.0

POLL_S = 15.0

# How long to keep waiting for a cooldown before giving up and reporting. Two
# hours of sustained over-temperature is a hardware or airflow problem, not
# something a guard should keep papering over.
MAX_COOLDOWN_S = 7200

DEFAULT_LOG = Path("data/thermal_guard.log")

# Processes this guard is allowed to pause. Deliberately narrow: it must never
# reach for something the user is running.
MANAGED_PATTERNS = ("run_ablation", "scripts/train.py", "scripts\\train.py")


@dataclass(frozen=True, slots=True)
class Reading:
    """One temperature sample."""

    gpu_c: float | None
    cpu_c: float | None
    at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def hottest(self) -> float | None:
        values = [v for v in (self.gpu_c, self.cpu_c) if v is not None]
        return max(values) if values else None

    def as_dict(self) -> dict[str, object]:
        return {
            "at": self.at.isoformat(),
            "gpu_c": self.gpu_c,
            "cpu_c": self.cpu_c,
            "cpu_available": self.cpu_c is not None,
            "hottest": self.hottest,
        }


def read_gpu_temperature() -> float | None:
    """GPU core temperature in Celsius, or None if unreadable."""

    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    first = result.stdout.strip().splitlines()
    try:
        return float(first[0].strip()) if first else None
    except ValueError:
        return None


def read_cpu_temperature() -> float | None:
    """CPU package temperature from a hardware-monitor WMI provider.

    Never use ``MSAcpi_ThermalZoneTemperature`` here. On this laptop it is an
    ambient/chassis zone, not the CPU die.
    """

    for namespace in (r"root\LibreHardwareMonitor", r"root\OpenHardwareMonitor"):
        script = (
            f"Get-CimInstance -Namespace '{namespace}' -ClassName Sensor "
            "-ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' "
            "-and $_.Name -match 'CPU Package|Core Average|CPU Core' } | "
            "Measure-Object -Property Value -Maximum | Select-Object -ExpandProperty Maximum"
        )
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", script],
                capture_output=True,
                text=True,
                timeout=25,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue

        text = result.stdout.strip()
        if not text:
            continue
        try:
            return round(float(text), 1)
        except ValueError:
            continue
    return None


def sample() -> Reading:
    return Reading(gpu_c=read_gpu_temperature(), cpu_c=read_cpu_temperature())


def managed_root_pids() -> list[int]:
    """Root PIDs of this project's long jobs, selected by command line."""

    script = (
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
        "Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        payload = json.loads(result.stdout or "[]")
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return []

    if isinstance(payload, dict):
        payload = [payload]

    return [
        int(entry["ProcessId"])
        for entry in payload
        if entry.get("CommandLine")
        and any(pattern in entry["CommandLine"] for pattern in MANAGED_PATTERNS)
    ]


def managed_tree_pids(root_pid: int | None = None) -> list[int]:
    """The exact training process tree, children first and root last."""

    import psutil

    roots = [root_pid] if root_pid is not None else managed_root_pids()
    ordered: list[int] = []
    seen: set[int] = set()
    for pid in roots:
        try:
            process = psutil.Process(pid)
            candidates = [*reversed(process.children(recursive=True)), process]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        for candidate in candidates:
            if candidate.pid not in seen:
                seen.add(candidate.pid)
                ordered.append(candidate.pid)
    return ordered


def pause_managed(root_pid: int | None = None) -> list[int]:
    """Suspend only the training tree and return the PIDs actually paused."""

    import psutil

    paused: list[int] = []
    for pid in managed_tree_pids(root_pid):
        try:
            psutil.Process(pid).suspend()
            paused.append(pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return paused


def resume_managed(pids: list[int]) -> list[int]:
    """Resume the same processes that this guard previously suspended."""

    import psutil

    resumed: list[int] = []
    for pid in pids:
        try:
            psutil.Process(pid).resume()
            resumed.append(pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return resumed


def log(path: Path, event: str, reading: Reading, **extra: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {"event": event, **reading.as_dict(), **extra}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    print(f"[{record['at']}] {event}: {record}", flush=True)


def wait_for_cooldown(
    log_path: Path,
    *,
    resume_c: float,
    poll_s: float,
    deadline_s: float,
    require_cpu: bool,
) -> bool:
    """Block until the hottest readable sensor falls to `resume_c`."""

    started = time.monotonic()
    while time.monotonic() - started < deadline_s:
        time.sleep(poll_s)
        reading = sample()
        if require_cpu and reading.cpu_c is None:
            log(log_path, "no_cpu_sensor_during_cooldown", reading)
            continue
        hottest = reading.hottest
        if hottest is None:
            log(log_path, "no_sensor_during_cooldown", reading)
            continue
        if hottest <= resume_c:
            log(log_path, "cooled", reading, waited_s=round(time.monotonic() - started))
            return True
        log(log_path, "cooling", reading, waited_s=round(time.monotonic() - started))
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--command", default=None, help="training command to launch and supervise")
    parser.add_argument("--watch-only", action="store_true", help="pause, but never resume")
    parser.add_argument(
        "--allow-missing-cpu",
        action="store_true",
        help="GPU-only automation; requires separate active CPU supervision",
    )
    parser.add_argument("--limit", type=float, default=LIMIT_C)
    parser.add_argument("--resume", type=float, default=RESUME_C)
    parser.add_argument("--poll", type=float, default=POLL_S)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--once", action="store_true", help="take one reading and exit")
    arguments = parser.parse_args()

    if arguments.resume >= arguments.limit:
        print("resume threshold must be below the limit, or the guard will thrash", file=sys.stderr)
        return 2

    first = sample()
    if arguments.once:
        print(json.dumps(first.as_dict(), indent=2))
        return 0

    if first.gpu_c is None:
        print("GPU temperature is unreadable; refusing to start training", file=sys.stderr)
        return 3
    if first.cpu_c is None and not arguments.allow_missing_cpu:
        print(
            "CPU package temperature is unreadable; start a supported hardware monitor "
            "or use --allow-missing-cpu only with active Armoury Crate supervision",
            file=sys.stderr,
        )
        return 3

    child: subprocess.Popen[str] | None = None
    if arguments.command:
        child = subprocess.Popen(arguments.command, text=True)

    log(
        arguments.log,
        "started",
        first,
        limit_c=arguments.limit,
        resume_c=arguments.resume,
        cpu_sensor="readable" if first.cpu_c is not None else "manual supervision required",
        child_pid=child.pid if child else None,
    )

    while True:
        if child is not None and child.poll() is not None:
            log(arguments.log, "training_exited", sample(), returncode=child.returncode)
            return int(child.returncode or 0)

        reading = sample()
        hottest = reading.hottest

        if hottest is None:
            log(arguments.log, "no_sensor", reading)
            time.sleep(arguments.poll)
            continue

        if hottest >= arguments.limit:
            paused = pause_managed(child.pid if child else None)
            log(arguments.log, "OVER_LIMIT_PAUSED", reading, paused_pids=paused)

            if not wait_for_cooldown(
                arguments.log,
                resume_c=arguments.resume,
                poll_s=arguments.poll,
                deadline_s=MAX_COOLDOWN_S,
                require_cpu=not arguments.allow_missing_cpu,
            ):
                log(arguments.log, "cooldown_timed_out", sample())
                return 1

            if not arguments.watch_only:
                resumed = resume_managed(paused)
                log(arguments.log, "resumed", sample(), resumed_pids=resumed)
        else:
            log(arguments.log, "ok", reading)

        time.sleep(arguments.poll)


if __name__ == "__main__":
    raise SystemExit(main())
