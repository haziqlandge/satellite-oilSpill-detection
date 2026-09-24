"""Runs `POST /api/v1/runs` starts: one pipeline process at a time, each streaming its own events.

The pipeline runs as a separate process (`python -m backend.pipeline.run`), not
inside the API: a stage that crashes, or OpenDrift exhausting memory, takes
down that run and never the server, and a run the API did not see finish is
still on disk to read. Runs are queued and executed one at a time -- the chain
is CPU-bound and two at once would each take twice as long.

The process writes `events.jsonl` in its run directory; the API reads it, never
the process's memory, so a client can subscribe at any point and get the
whole history first (`follow`). If the process exits without writing its final
event -- killed, or the API restarted under it -- the manager appends one that
says exactly that, marked as the API's, not the pipeline's.
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import secrets
import subprocess
import sys
import threading
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.config import REPO_ROOT
from backend.pipeline.run import EVENTS, STAGES

#: Files a client may fetch from a run directory, and nothing else.
FILES = ("run.json", "request.json", "detections.geojson", "drift.json", "scene.json", "ais.json")

Command = Callable[["RunRequest", Path], list[str]]


@dataclass(frozen=True)
class RunRequest:
    id: str
    source: str  # repo-relative path of the raster
    name: str
    use_precomputed: bool
    acquired_at: str | None
    created_at: str

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "source": self.source, "name": self.name, "use_precomputed": self.use_precomputed,
                "acquired_at": self.acquired_at, "created_at": self.created_at}


def pipeline_command(request: RunRequest, run_dir: Path) -> list[str]:
    command = [sys.executable, "-m", "backend.pipeline.run", "--source", str(REPO_ROOT / request.source),
               "--run-dir", str(run_dir), "--name", request.name]
    if request.use_precomputed:
        command.append("--use-precomputed")
    if request.acquired_at:
        command += ["--acquired-at", request.acquired_at]
    return command


def new_run_id() -> str:
    return f"{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{secrets.token_hex(3)}"


def read_events(run_dir: Path) -> list[dict[str, Any]]:
    path = run_dir / EVENTS
    if not path.exists():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                break  # a line still being written; the next read gets it whole
    return events


def is_final(event: dict[str, Any]) -> bool:
    return event.get("stage") == "run" and event.get("state") in {"done", "failed"}


class JobManager:
    def __init__(self, runs_dir: Path, *, command: Command = pipeline_command) -> None:
        self.runs_dir = runs_dir
        self.command = command
        self._queue: queue.Queue[RunRequest] = queue.Queue()
        self._lock = threading.Lock()
        self._running: str | None = None
        self._worker: threading.Thread | None = None
        runs_dir.mkdir(parents=True, exist_ok=True)
        self._close_orphans()

    # ---- lifecycle ----------------------------------------------------------
    def _close_orphans(self) -> None:
        """Runs a previous API process left unfinished: say so in their own event log."""
        for run_dir in self.runs_dir.glob("*/"):
            if not (run_dir / "request.json").exists():
                continue
            events = read_events(run_dir)
            if not events or not is_final(events[-1]):
                self._append(run_dir, "the API stopped before this run finished; it was not resumed")

    def _append(self, run_dir: Path, detail: str) -> None:
        events = read_events(run_dir)
        event = {"seq": (events[-1]["seq"] if events else 0) + 1,
                 "at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                 "stage": "run", "state": "failed", "label": "Pipeline", "detail": detail, "by": "api"}
        with (run_dir / EVENTS).open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(event, separators=(",", ":")) + "\n")

    def _ensure_worker(self) -> None:
        with self._lock:
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._work, name="pipeline-runs", daemon=True)
                self._worker.start()

    def _work(self) -> None:
        while True:
            request = self._queue.get()
            run_dir = self.runs_dir / request.id
            with self._lock:
                self._running = request.id
            try:
                with (run_dir / "pipeline.log").open("w", encoding="utf-8") as log:
                    env = os.environ | {"PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
                    process = subprocess.run(  # our own interpreter and module, never a shell
                        self.command(request, run_dir), cwd=REPO_ROOT, stdout=log, stderr=subprocess.STDOUT,
                        env=env, check=False,
                    )
                events = read_events(run_dir)
                if not events or not is_final(events[-1]):
                    self._append(run_dir, f"the pipeline process exited with code {process.returncode} without "
                                          "finishing; see pipeline.log in the run directory")
            except OSError as error:
                self._append(run_dir, f"the pipeline process could not be started: {error}")
            finally:
                with self._lock:
                    self._running = None
                self._queue.task_done()

    # ---- API ----------------------------------------------------------------
    def submit(self, request: RunRequest) -> None:
        run_dir = self.runs_dir / request.id
        # An upload's directory already holds the file; a second request for one id never exists.
        run_dir.mkdir(parents=True, exist_ok=True)
        if (run_dir / "request.json").exists():
            raise FileExistsError(f"run {request.id} already exists")
        (run_dir / "request.json").write_text(json.dumps(request.as_dict(), indent=1), encoding="utf-8")
        self._queue.put(request)
        self._ensure_worker()

    def run_ids(self) -> list[str]:
        return sorted((p.name for p in self.runs_dir.glob("*/") if (p / "request.json").exists()), reverse=True)

    def status(self, run_id: str) -> dict[str, Any] | None:
        run_dir = self.runs_dir / run_id
        request_path = run_dir / "request.json"
        if not request_path.exists():
            return None
        request = json.loads(request_path.read_text(encoding="utf-8"))
        events = read_events(run_dir)
        stages: dict[str, dict[str, Any]] = {k: {"key": k, "label": label, "state": "pending"} for k, label in STAGES}
        final = next((e for e in reversed(events) if is_final(e)), None)
        for event in events:
            key = event.get("stage")
            if key not in stages:
                continue
            row = stages[key]
            if event["state"] == "progress":
                row["progress"] = {"done": event.get("done", 0), "total": event.get("total", 0)}
                continue
            row["state"] = event["state"]
            for field in ("ms", "detail"):
                if field in event:
                    row[field] = event[field]
        summary_path = run_dir / "run.json"
        summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}
        status = "done" if final and final["state"] == "done" else "failed" if final else (
            "running" if events else "queued")
        return {
            "id": run_id,
            "status": status,
            "outcome": summary.get("outcome") or (final or {}).get("data", {}).get("outcome")
            or ("failed" if status == "failed" else None),
            "source": request.get("name"),
            "use_precomputed": bool(request.get("use_precomputed")),
            "created_at": request.get("created_at"),
            "stages": list(stages.values()),
            "detail": (final or {}).get("detail"),
            "events_url": f"/api/v1/runs/{run_id}/events",
            "files": {name: f"/api/v1/runs/{run_id}/files/{name}" for name in FILES if (run_dir / name).exists()},
        }

    async def follow(self, run_id: str, *, after: int = 0, poll_s: float = 0.25,
                     heartbeat_s: float = 15.0) -> AsyncIterator[str]:
        """Server-sent events: every event after `after`, then each new one, until the run's last."""
        run_dir = self.runs_dir / run_id
        seen = after
        quiet = 0.0
        while True:
            events = read_events(run_dir)
            fresh = [e for e in events if e.get("seq", 0) > seen]
            for event in fresh:
                seen = event["seq"]
                yield f"id: {seen}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"
                if is_final(event):
                    yield "event: end\ndata: {}\n\n"
                    return
            if fresh:
                quiet = 0.0
            await asyncio.sleep(poll_s)
            quiet += poll_s
            if quiet >= heartbeat_s:
                quiet = 0.0
                yield ": still running\n\n"

    def describe(self) -> dict[str, Any]:
        with self._lock:
            running = self._running
        return {"running": running, "queued": self._queue.qsize(), "total": len(self.run_ids())}
