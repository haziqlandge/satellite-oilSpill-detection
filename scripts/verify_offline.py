"""Prove the demo runs with the network off (PHASE-09, C12). Run it as the last check before presenting.

    .venv/Scripts/python.exe -m scripts.verify_offline          # every API read, every scene
    .venv/Scripts/python.exe -m scripts.verify_offline --run    # plus one live pipeline run (~5 min)

**Run it with networking actually disabled** -- the phase file is explicit that a
mocked fallback is not a tested one. The script says which it got: it probes a
public address before it starts, and a pass with the network ON proves only the
guard below, not the machine.

What it checks:

  1. `DEMO_OFFLINE=1`, and a socket guard: every connection to anything but
     loopback, and every DNS lookup of a non-local name, is refused and
     recorded. A pass means no code path reached out, whether or not the
     network was there to answer.
  2. Every read endpoint the console uses, for every scene the API serves, in
     process (`fastapi.testclient`, no sockets): health, scenes, detections,
     the seed's detection record, its drift both ways, and its suspects.
  3. With `--run`, the live pipeline on the December upload window, in process
     (so the guard sees it): detection, ERA5 and CMEMS from the cache only,
     OpenDrift, AIS, verdict, attribution.

The browser half is checked in the browser: with the network off the console
must draw every layer and the land from the local mask (ISSUES F11).
"""

from __future__ import annotations

import argparse
import contextlib
import io
import ipaddress
import os
import socket
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from backend.config import REPO_ROOT

WINDOW = REPO_ROOT / "data" / "processed" / "sar" / "windows"
LOCAL_NAMES = {"localhost", "testserver", ""}


class OfflineViolationError(RuntimeError):
    """Something other than loopback was reached for."""


def network_is_up(timeout: float = 3.0) -> bool:
    """Whether a public address answers. Measured before the guard is installed."""
    try:
        socket.create_connection(("1.1.1.1", 443), timeout=timeout).close()
        return True
    except OSError:
        return False


def _loopback(host: Any) -> bool:
    if host is None or str(host).lower() in LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(str(host).split("%")[0]).is_loopback
    except ValueError:
        return False


def install_guard(violations: list[str]) -> None:
    """Refuse every non-loopback connect and every non-local name lookup, and record it."""
    connect, connect_ex, getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo

    def refuse(what: str) -> None:
        violations.append(what)
        raise OfflineViolationError(f"offline violation: {what}")

    def guarded_connect(self: socket.socket, address: Any) -> Any:
        if isinstance(address, tuple) and not _loopback(address[0]):
            refuse(f"connect {address[0]}:{address[1]}")
        return connect(self, address)

    def guarded_connect_ex(self: socket.socket, address: Any) -> Any:
        if isinstance(address, tuple) and not _loopback(address[0]):
            refuse(f"connect {address[0]}:{address[1]}")
        return connect_ex(self, address)

    def guarded_getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        if not _loopback(host.decode() if isinstance(host, bytes) else host):
            refuse(f"resolve {host!r}")
        return getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = guarded_connect  # type: ignore[method-assign, assignment]
    socket.socket.connect_ex = guarded_connect_ex  # type: ignore[method-assign, assignment]
    socket.getaddrinfo = guarded_getaddrinfo


def check_api() -> list[str]:
    """Every read the console makes, for every scene; returns what failed."""
    from fastapi.testclient import TestClient

    from backend.app.main import create_app

    failures: list[str] = []
    with TestClient(create_app(warm=False)) as client:
        def get(path: str, **params: Any) -> Any:
            started = time.perf_counter()
            response = client.get(path, params=params or None)
            ms = (time.perf_counter() - started) * 1000
            # 200 with a problem body is how the suspects endpoint refuses (C3): a result, not a failure.
            ok = response.status_code == 200
            print(f"  {'ok ' if ok else 'BAD'} {response.status_code} {ms:7.0f} ms  {path}"
                  + (f" {params}" if params else ""))
            if not ok:
                failures.append(f"{path}: {response.status_code}")
            return response.json() if ok else None

        health = get("/api/v1/health")
        if health is not None and health["database"]["used_by_this_api"]:
            failures.append("health: the API claims to use the hosted database")
        scenes = get("/api/v1/scenes") or []
        if not scenes:
            failures.append("no scenes to serve")
        for scene in scenes:
            get(f"/api/v1/scenes/{scene['id']}")
            get(f"/api/v1/scenes/{scene['id']}/detections")
            seed = scene.get("seed_detection_id")
            if not seed:
                continue
            get(f"/api/v1/detections/{seed}")
            if scene.get("has_drift"):
                get(f"/api/v1/detections/{seed}/drift", direction="backward")
                get(f"/api/v1/detections/{seed}/drift", direction="forward")
                get(f"/api/v1/detections/{seed}/suspects")
        get("/api/v1/runs")
    return failures


def check_pipeline() -> list[str]:
    """The live pipeline on the December window, from the cache only; returns what failed."""
    import json

    from backend.pipeline.run import main as run_pipeline


    windows = sorted(WINDOW.glob("*20231205*_win2048.tif"))
    if not windows:
        return [f"no December window under {WINDOW} (DATA.md section 4 has the cut)"]
    with tempfile.TemporaryDirectory() as scratch:
        run_dir = Path(scratch) / "offline-run"
        started = time.perf_counter()
        with contextlib.redirect_stdout(io.StringIO()):  # the pipeline prints every event; summarised below
            run_pipeline(["--source", str(windows[0]), "--run-dir", str(run_dir)])
        events = [json.loads(line) for line in (run_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        print(f"  pipeline: {time.perf_counter() - started:.0f} s")
        for event in events:
            if event.get("state") in {"done", "refused", "skipped", "failed"}:
                print(f"    {event['stage']:<15} {event['state']:<8} {str(event.get('detail', ''))[:110]}")
        last: dict[str, Any] = next((e for e in reversed(events) if e.get("stage") == "run"), {})
        outcome = (last.get("data") or {}).get("outcome")
        if outcome != "complete":
            return [f"pipeline ended {outcome!r}: {last.get('detail')}"]
    return []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="also run the live pipeline on the December window")
    args = parser.parse_args(argv)

    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
    os.environ["DEMO_OFFLINE"] = "1"
    up = network_is_up()
    print(f"network: {'ON -- this run proves the guard, not the machine' if up else 'OFF (a public address is unreachable)'}")
    violations: list[str] = []
    install_guard(violations)

    failures = check_api()
    if args.run:
        failures += check_pipeline()

    print()
    for line in violations:
        print(f"VIOLATION {line}")
    for line in failures:
        print(f"FAILED    {line}")
    verdict = "PASS" if not violations and not failures else "FAIL"
    print(f"{verdict}: {len(violations)} network reach(es), {len(failures)} failure(s); network was "
          f"{'ON' if up else 'OFF'}")
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
