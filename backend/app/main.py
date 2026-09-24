"""The API: `PLAN/INTERFACES.md` §3 over the pipeline's artifacts, plus `POST /api/v1/runs`.

    .venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

Local by design: it binds to 127.0.0.1, serves a vessel's AIS by MMSI from the
machine's own cache, and starts pipeline processes. The console reaches it
through Vite's `/api` proxy (`frontDemo/vite.config.ts`), so it is same-origin
there and needs no CORS; the header below admits the dev servers' own ports for
a client that calls it directly.

Every GET is read-only against files the pipeline wrote (`store.py`). The one
write, `POST /runs`, queues a separate process and returns at once
(`routers/runs.py`, and the dated amendment in `PLAN/CONSTRAINTS.md`).
"""

from __future__ import annotations

import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from backend.app import problems
from backend.app.jobs import JobManager
from backend.app.routers import detections, drift, health, runs, scenes, suspects, vessels
from backend.app.store import API_RUNS, ArtifactStore

API_PREFIX = "/api/v1"


def _probe_database(state: dict[str, Any]) -> None:
    """The hosted database, probed once in the background: a paused pooler takes up to 15 s to refuse."""
    from backend.db.session import check_connection

    ok, detail = check_connection()
    state.update(ok=ok, detail=detail.splitlines()[0][:200], checked_at=datetime.now(UTC).isoformat())


def _warm(store: ArtifactStore) -> None:
    """Parse every artifact once in the background, so no reader pays the first parse (< 500 ms target)."""
    from backend.app import views

    for scene in store.scenes():
        views.scene_summary(store, scene)
        seed = store.seed_feature(scene)
        if seed is None or scene.run_dir is None:
            continue
        from backend.app.store import detection_uuid

        for direction in ("backward", "forward"):
            views.drift_collection(store, scene, detection_uuid(scene.id, seed), direction)
        views.seed_verdict_record(store, scene)


def create_app(*, store: ArtifactStore | None = None, jobs: JobManager | None = None,
               probe_database: bool = True, warm: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        from dotenv import load_dotenv

        from backend.app.routers.health import weights_status
        from backend.config import REPO_ROOT

        load_dotenv(REPO_ROOT / ".env")
        app.state.store = store or ArtifactStore()
        app.state.jobs = jobs or JobManager(API_RUNS)
        app.state.weights_status = weights_status()
        app.state.database = {"ok": None, "detail": "not probed yet"}
        if probe_database:
            threading.Thread(target=_probe_database, args=(app.state.database,), daemon=True).start()
        else:
            app.state.database = {"ok": None, "detail": "not probed (disabled)"}
        if warm:
            threading.Thread(target=_warm, args=(app.state.store,), daemon=True).start()
        yield

    app = FastAPI(
        title="Oil spill detection, drift and attribution",
        version="0.1.0",
        description="PLAN/INTERFACES.md §3, read from the pipeline's artifacts, and POST /runs.",
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    problems.install(app)
    for module in (scenes, detections, drift, suspects, vessels, health, runs):
        app.include_router(module.router, prefix=API_PREFIX)

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(f"{API_PREFIX}/docs")

    return app


app = create_app()
