"""Suspects: nobody is ranked on this machine, and the API says why rather than returning `[]`.

An empty list would read as "no vessel nearby". The truth is different -- the
physics available here cannot carry a ranking -- and C3 requires that to reach
the client as a prominent result: an `insufficient-evidence` problem document
at HTTP 200 (`INTERFACES.md` §3).
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.app import views
from backend.app.deps import Store, parse_uuid, require_detection
from backend.app.problems import ProblemError, problem

router = APIRouter(tags=["suspects"])


@router.get("/detections/{detection_id}/suspects")
def get_suspects(detection_id: str, store: Store) -> JSONResponse:
    scene, index, _ = require_detection(store, detection_id)
    drift = store.drift_file(scene)
    if drift is None or store.seed_feature(scene) != index:
        raise ProblemError(404, "no-drift-run", "No drift run for this detection",
                           "suspects are ranked from a backward drift, and only a scene's seed detection is drifted")
    reasons = views.attribution_refusal(drift)
    horizon = min(drift["frames"], key=lambda f: f["hour"])
    because = "; ".join(reasons)
    detail = (f"No candidate is ranked. The 90% origin region is {horizon['area90Km2']:.0f} km2 at "
              f"{horizon['hour']} h. {because[0].upper()}{because[1:]}.")
    return problem(200, "insufficient-evidence", "Nobody can be ranked from this drift", detail,
                   f"/api/v1/detections/{detection_id}/suspects")


@router.get("/suspects/{suspect_id}/evidence")
def get_evidence(suspect_id: str) -> JSONResponse:
    parse_uuid(suspect_id, "suspect")
    raise ProblemError(404, "not-found", "No such suspect",
                       "no suspect exists on this machine: nothing is ranked in any run (see a detection's "
                       "suspects for why)")
