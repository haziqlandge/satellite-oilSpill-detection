"""`POST /api/v1/runs` and its event stream, with a stand-in for the pipeline process.

The job manager runs whatever command it is given, so these tests hand it a
tiny script that writes events the way `backend.pipeline.run` does. What is
under test is the contract around the pipeline: what is refused at the door,
that the client gets the whole history and then each event as it lands, and
that a process which dies silently is reported as such -- never left looking
as if it were still running.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from backend.app.jobs import JobManager, RunRequest, read_events
from backend.app.main import create_app
from backend.app.store import ArtifactStore

FAKE_PIPELINE = """
import json, sys, time
from pathlib import Path
events = Path(sys.argv[1]) / "events.jsonl"
mode = sys.argv[2]
def emit(seq, stage, state, **extra):
    with events.open("a", encoding="utf-8") as out:
        out.write(json.dumps({"seq": seq, "stage": stage, "state": state, **extra}) + "\\n")
emit(1, "run", "running")
emit(2, "input", "running")
time.sleep(0.3)
emit(3, "input", "done", ms=300, detail="read")
if mode == "crash":
    sys.exit(3)
emit(4, "run", "done", data={"outcome": "complete"})
"""


def _raster(path: Path, *, crs: str | None = "EPSG:4326") -> Path:
    with rasterio.open(path, "w", driver="GTiff", width=16, height=16, count=1, dtype="float32", crs=crs,
                       transform=from_origin(-89.5, 28.5, 0.0001, 0.0001)) as out:
        out.write(np.full((1, 16, 16), -20.0, dtype=np.float32))
    return path


@pytest.fixture
def setup(tmp_path: Path) -> tuple[TestClient, Path]:
    script = tmp_path / "fake_pipeline.py"
    script.write_text(FAKE_PIPELINE)
    runs = tmp_path / "runs"

    def command(request: RunRequest, run_dir: Path) -> list[str]:
        mode = "crash" if "crash" in request.name else "ok"
        return [sys.executable, str(script), str(run_dir), mode]

    store = ArtifactStore(scenes_dir=tmp_path / "none", public_runs=tmp_path / "none", public_ais=tmp_path / "none",
                          api_runs=runs, sar_dir=tmp_path / "none", ais_days=tmp_path / "none")
    app = create_app(store=store, jobs=JobManager(runs, command=command), probe_database=False, warm=False)
    with TestClient(app) as client:
        yield client, tmp_path


def _post(client: TestClient, path: Path, name: str, **params: object):
    return client.post("/api/v1/runs", content=path.read_bytes(), params={"name": name, **params},
                       headers={"content-type": "image/tiff"})


def _wait(client: TestClient, run_id: str, timeout_s: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        status = client.get(f"/api/v1/runs/{run_id}").json()
        if status["status"] in {"done", "failed"}:
            return status
        time.sleep(0.1)
    raise AssertionError(f"run {run_id} never finished")


def test_an_upload_is_queued_and_its_events_stream_in_order(setup: tuple[TestClient, Path]) -> None:
    client, tmp = setup
    response = _post(client, _raster(tmp / "a.tif"), "S1A_IW_GRDH_1SDV_20230409T000206_x.tif")
    assert response.status_code == 202
    run = response.json()
    assert response.headers["location"] == f"/api/v1/runs/{run['id']}"
    assert run["status"] in {"queued", "running"}
    # Every stage is listed from the start, so a client can draw them all as pending.
    assert [s["key"] for s in run["stages"]][:3] == ["input", "screen", "detect"]

    with client.stream("GET", f"/api/v1/runs/{run['id']}/events") as stream:
        body = "".join(stream.iter_text())
    data = [json.loads(line[6:]) for line in body.splitlines() if line.startswith('data: {"')]
    assert [e["seq"] for e in data] == [1, 2, 3, 4]
    assert body.rstrip().endswith("event: end\ndata: {}")

    status = _wait(client, run["id"])
    assert status["status"] == "done"
    assert status["stages"][0] == {"key": "input", "label": "Read the raster", "state": "done", "ms": 300,
                                   "detail": "read", "progress": None}
    # The operator's file name is kept: a Sentinel-1 product name carries the acquisition time.
    assert (tmp / "runs" / run["id"] / "S1A_IW_GRDH_1SDV_20230409T000206_x.tif").exists()
    assert [r["id"] for r in client.get("/api/v1/runs").json()] == [run["id"]]


def test_a_late_subscriber_resumes_after_its_last_event(setup: tuple[TestClient, Path]) -> None:
    client, tmp = setup
    run = _post(client, _raster(tmp / "b.tif"), "b.tif").json()
    _wait(client, run["id"])
    with client.stream("GET", f"/api/v1/runs/{run['id']}/events", headers={"last-event-id": "2"}) as stream:
        body = "".join(stream.iter_text())
    assert [json.loads(line[6:])["seq"] for line in body.splitlines() if line.startswith('data: {"')] == [3, 4]


def test_a_process_that_dies_without_finishing_is_reported(setup: tuple[TestClient, Path]) -> None:
    client, tmp = setup
    run = _post(client, _raster(tmp / "c.tif"), "crash.tif").json()
    status = _wait(client, run["id"])
    assert status["status"] == "failed"
    assert "exited with code 3 without finishing" in status["detail"]
    last = read_events(tmp / "runs" / run["id"])[-1]
    assert last["by"] == "api" and last["state"] == "failed"


def test_what_the_pipeline_could_only_fail_on_is_refused_at_the_door(setup: tuple[TestClient, Path]) -> None:
    client, tmp = setup
    assert _post(client, _raster(tmp / "d.tif"), "d.png").status_code == 415
    unreferenced = _post(client, _raster(tmp / "e.tif", crs=None), "e.tif")
    assert unreferenced.status_code == 422 and unreferenced.json()["type"] == "/errors/not-georeferenced"
    garbage = tmp / "f.tif"
    garbage.write_bytes(b"not a raster")
    assert _post(client, garbage, "f.tif").json()["type"] == "/errors/not-a-raster"
    outside = client.post("/api/v1/runs", json={"source": "../../../../Windows/win.ini"})
    assert outside.status_code == 422 and outside.json()["type"] == "/errors/invalid-source"
    # Nothing refused leaves a run behind.
    assert client.get("/api/v1/runs").json() == []


def test_precomputed_is_refused_with_its_reason_when_there_is_none(setup: tuple[TestClient, Path]) -> None:
    client, tmp = setup
    response = _post(client, _raster(tmp / "g.tif"), "g.tif", use_precomputed="true")
    assert response.status_code == 409
    assert response.json()["type"] == "/errors/no-precomputed-result"
    assert "no precomputed result" in response.json()["detail"]


def test_a_run_the_api_never_saw_finish_is_closed_on_restart(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "20260924T000000Z-abcdef"
    run_dir.mkdir(parents=True)
    (run_dir / "request.json").write_text(json.dumps({"id": run_dir.name, "name": "x.tif"}))
    (run_dir / "events.jsonl").write_text(json.dumps({"seq": 1, "stage": "run", "state": "running"}) + "\n")
    JobManager(tmp_path / "runs")
    last = read_events(run_dir)[-1]
    assert last["state"] == "failed" and "stopped before this run finished" in last["detail"]
