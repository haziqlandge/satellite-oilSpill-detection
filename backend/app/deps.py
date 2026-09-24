"""The API's two dependencies: the artifact store it reads and the job manager that runs pipelines."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, Request

from backend.app.jobs import JobManager
from backend.app.problems import ProblemError
from backend.app.store import ArtifactStore, SceneEntry


def get_store(request: Request) -> ArtifactStore:
    store: ArtifactStore = request.app.state.store
    return store


def get_jobs(request: Request) -> JobManager:
    jobs: JobManager = request.app.state.jobs
    return jobs


Store = Annotated[ArtifactStore, Depends(get_store)]
Jobs = Annotated[JobManager, Depends(get_jobs)]


def parse_uuid(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as error:
        raise ProblemError(404, "not-found", f"No such {what}", f"{value!r} is not a {what} id") from error


def require_scene(store: ArtifactStore, scene_id: str) -> SceneEntry:
    scene = store.scene(parse_uuid(scene_id, "scene"))
    if scene is None:
        raise ProblemError(404, "not-found", "No such scene", f"no scene {scene_id} on this machine")
    return scene


def require_detection(store: ArtifactStore, detection_id: str) -> tuple[SceneEntry, int, uuid.UUID]:
    parsed = parse_uuid(detection_id, "detection")
    found = store.find_detection(parsed)
    if found is None:
        raise ProblemError(404, "not-found", "No such detection", f"no detection {detection_id} on this machine")
    return found[0], found[1], parsed
