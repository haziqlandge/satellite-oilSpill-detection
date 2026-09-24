"""`POST /api/v1/runs`: the one write endpoint, a deliberate amendment to the read-only rule.

`PLAN/CONSTRAINTS.md` records why (dated 2026-09-24): the demo needs a live
path for an uploaded raster, and the reason the rule exists -- nothing
expensive behind a request while someone watches -- is kept by what this does
NOT do. It never runs the pipeline inside the request. It validates, queues a
separate process and answers 202 at once; the client follows progress over
server-sent events, and every GET stays read-only.

Two ways in:

  * `Content-Type: application/json` -- `{"source": "<repo-relative raster>"}`,
    for a raster already on this machine (a full processed scene, a window);
  * any other type -- the raster's bytes as the body, `?name=` the file name.
    That is what the console sends: `fetch(url, {method: "POST", body: file})`,
    no multipart.

`use_precomputed=true` honours the §1.5 contract: the stored segmentation for
these exact bytes under this model, refused with its reason (409) when none
exists, and labelled PRECOMPUTED wherever the result is shown.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from backend.app.deps import Jobs, Store
from backend.app.jobs import FILES, JobManager, RunRequest, new_run_id
from backend.app.problems import ProblemError
from backend.app.schemas import RunStatus
from backend.app.store import ArtifactStore, detection_uuid, scene_uuid
from backend.config import REPO_ROOT

router = APIRouter(tags=["runs"])

MAX_UPLOAD_BYTES = 512 * 2**20
RASTER_SUFFIXES = (".tif", ".tiff")


def _check_raster(path: Path) -> None:
    """Refuse at the door what the pipeline could only fail on: not a raster, or not EPSG:4326."""
    import rasterio
    from rasterio.errors import RasterioIOError

    try:
        with rasterio.open(path) as source:
            crs = source.crs
    except RasterioIOError as error:
        raise ProblemError(422, "not-a-raster", "Not a readable raster", str(error)) from error
    if crs is None or crs.to_epsg() != 4326:
        raise ProblemError(
            422, "not-georeferenced", "The raster is not in EPSG:4326",
            f"the pipeline needs a geocoded sigma0 dB GeoTIFF in EPSG:4326; this one is {crs or 'not georeferenced'}")


def _check_precomputed(path: Path) -> None:
    from backend.app.routers.health import weights_status
    from backend.pipeline.precomputed import find_precomputed
    from backend.pipeline.run import sha256_file

    digest = sha256_file(path)
    weights = weights_status()
    found = find_precomputed(digest, weights_sha256=weights.get("sha256", ""))
    if not found.ok:
        raise ProblemError(409, "no-precomputed-result", "No precomputed result for this file", found.reason)


def _status(jobs: JobManager, store: ArtifactStore, run_id: str) -> dict[str, Any]:
    status = jobs.status(run_id)
    if status is None:
        raise ProblemError(404, "not-found", "No such run", f"no run {run_id} on this machine")
    scene_id = seed_id = None
    if (jobs.runs_dir / run_id / "run.json").exists() and (jobs.runs_dir / run_id / "detections.geojson").exists():
        scene = store.scene(scene_uuid(f"run:{run_id}"))
        if scene is not None:
            scene_id = str(scene.id)
            seed = store.seed_feature(scene)
            seed_id = None if seed is None else str(detection_uuid(scene.id, seed))
    return status | {"scene_id": scene_id, "seed_detection_id": seed_id}


@router.post("/runs", status_code=202, response_model=RunStatus)
async def start_run(
    request: Request,
    jobs: Jobs,
    store: Store,
    name: str | None = Query(None, description="the uploaded file's name (raw-body uploads)"),
    use_precomputed: bool = Query(False),
    acquired_at: str | None = Query(None, description="ISO-8601 UTC, if neither the name nor the file carries it"),
    content_type: str = Header("application/octet-stream"),
) -> JSONResponse:
    run_id = new_run_id()
    run_dir = jobs.runs_dir / run_id
    if content_type.split(";")[0].strip() == "application/json":
        body = json.loads(await request.body() or b"{}")
        source = str(body.get("source") or "")
        use_precomputed = bool(body.get("use_precomputed", use_precomputed))
        acquired_at = body.get("acquired_at", acquired_at)
        path = (REPO_ROOT / source).resolve()
        if not source or REPO_ROOT.resolve() not in path.parents or not path.is_file():
            raise ProblemError(422, "invalid-source", "No such raster in this repository",
                               f"{source!r} is not a file under the repository")
        if path.suffix.lower() not in RASTER_SUFFIXES:
            raise ProblemError(415, "unsupported-type", "Not a GeoTIFF", f"{path.name}: the pipeline reads GeoTIFF")
        relative = path.relative_to(REPO_ROOT.resolve()).as_posix()
        display = path.name
    else:
        if not name:
            raise ProblemError(422, "invalid-request", "Name the file", "a raw-body upload needs ?name=<file name>")
        display = Path(name).name
        suffix = Path(display).suffix.lower()
        if suffix not in RASTER_SUFFIXES:
            raise ProblemError(415, "unsupported-type", "Not a GeoTIFF",
                               f"{display}: the pipeline reads a georeferenced GeoTIFF (EPSG:4326)")
        run_dir.mkdir(parents=True)
        # Keep the operator's file name: a Sentinel-1 product name carries the acquisition time.
        path = run_dir / display
        size = 0
        with path.open("wb") as stream:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    stream.close()
                    path.unlink(missing_ok=True)
                    run_dir.rmdir()
                    raise ProblemError(413, "too-large", "Upload too large",
                                       f"at most {MAX_UPLOAD_BYTES // 2**20} MB; put a full scene on disk and "
                                       "POST its path as JSON instead")
                stream.write(chunk)
        relative = path.relative_to(REPO_ROOT).as_posix() if REPO_ROOT in path.parents else str(path)
    try:
        _check_raster(path)
        if use_precomputed:
            _check_precomputed(path)
    except ProblemError:
        if run_dir.exists():
            for child in run_dir.iterdir():
                child.unlink()
            run_dir.rmdir()
        raise
    jobs.submit(RunRequest(
        id=run_id, source=relative, name=display, use_precomputed=use_precomputed, acquired_at=acquired_at,
        created_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    ))
    return JSONResponse(_status(jobs, store, run_id), status_code=202,
                        headers={"Location": f"/api/v1/runs/{run_id}"})


@router.get("/runs", response_model=list[RunStatus])
def list_runs(jobs: Jobs, store: Store) -> list[dict[str, Any]]:
    return [_status(jobs, store, run_id) for run_id in jobs.run_ids()]


@router.get("/runs/{run_id}", response_model=RunStatus)
def get_run(run_id: str, jobs: Jobs, store: Store) -> dict[str, Any]:
    return _status(jobs, store, run_id)


@router.get("/runs/{run_id}/events")
async def run_events(
    run_id: str,
    jobs: Jobs,
    last_event_id: str | None = Header(None),
) -> StreamingResponse:
    """Server-sent events: the run's whole history first, then each stage as it happens, then `end`."""
    if jobs.status(run_id) is None:
        raise ProblemError(404, "not-found", "No such run", f"no run {run_id} on this machine")
    after = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
    return StreamingResponse(
        jobs.follow(run_id, after=after), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs/{run_id}/files/{name}")
def run_file(run_id: str, name: str, jobs: Jobs) -> FileResponse:
    path = jobs.runs_dir / run_id / name
    if name not in FILES or jobs.status(run_id) is None or not path.exists():
        raise ProblemError(404, "not-found", "No such file", f"{name} is not a file of run {run_id}")
    media = "application/geo+json" if name.endswith(".geojson") else "application/json"
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-store"})
