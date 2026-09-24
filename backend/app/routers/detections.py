from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.app import views
from backend.app.deps import Store, require_detection
from backend.app.schemas import DetectionDetail

router = APIRouter(tags=["detections"])


@router.get("/detections/{detection_id}", response_model=DetectionDetail)
def get_detection(detection_id: str, store: Store) -> dict[str, Any]:
    """The detection, its characterisation (the seed only) and the seed's oos verdict with its terms."""
    scene, index, _ = require_detection(store, detection_id)
    return views.detection_detail(store, scene, index)
