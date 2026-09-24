from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.app import views
from backend.app.deps import Store, require_scene
from backend.app.schemas import SceneDetail, SceneSummary

router = APIRouter(tags=["scenes"])


@router.get("/scenes", response_model=list[SceneSummary])
def list_scenes(store: Store) -> list[dict[str, Any]]:
    """Every scene on this machine: the exported real runs, then the runs the API has made."""
    return [views.scene_summary(store, scene) for scene in store.scenes()]


@router.get("/scenes/{scene_id}", response_model=SceneDetail)
def get_scene(scene_id: str, store: Store) -> dict[str, Any]:
    return views.scene_detail(store, require_scene(store, scene_id))


@router.get("/scenes/{scene_id}/detections")
def scene_detections(scene_id: str, store: Store) -> dict[str, Any]:
    """A FeatureCollection of the scene's slick polygons, one class, with confidence (EPSG:4326)."""
    return views.detections_collection(store, require_scene(store, scene_id))
