from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query

from backend.app import views
from backend.app.deps import Store, require_detection
from backend.app.problems import ProblemError
from backend.app.schemas import DriftCollection

router = APIRouter(tags=["drift"])


@router.get("/detections/{detection_id}/drift", response_model=DriftCollection)
def get_drift(
    detection_id: str,
    store: Store,
    direction: Literal["backward", "forward"] = Query("backward"),
) -> dict[str, Any]:
    """The origin field (backward) or the forecast (forward), time-indexed, with convergence and age."""
    scene, index, parsed = require_detection(store, detection_id)
    if scene.run_dir is None or store.seed_feature(scene) != index:
        raise ProblemError(
            404, "no-drift-run", "No drift run for this detection",
            "only the seed detection of a scene is drifted (the largest at sea with a slick's edge); "
            + ("this one is not it" if scene.run_dir is not None else "no drift was run for this scene"),
        )
    return views.drift_collection(store, scene, parsed, direction)
