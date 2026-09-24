from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request

from backend.app.deps import Jobs, Store
from backend.app.schemas import Health
from backend.config import REPO_ROOT
from backend.ingest.metocean.cache import DEFAULT_CACHE_DIR, is_offline

router = APIRouter(tags=["health"])


def weights_status() -> dict[str, Any]:
    from ml.export.export import read_manifest

    weights = REPO_ROOT / "weights" / "L1-ciou-research.pt"
    try:
        manifest = read_manifest(weights, expected_classes=("slick",))
    except (OSError, ValueError, KeyError) as error:
        return {"ok": False, "path": "weights/L1-ciou-research.pt", "error": str(error)}
    return {"ok": True, "path": "weights/L1-ciou-research.pt", "name": manifest["name"], "classes": manifest["classes"],
            "sha256": manifest["sha256"], "verified": "the file's SHA-256 matches its manifest",
            "status": manifest.get("status")}


def browser_model_status(weights_sha256: str | None) -> dict[str, Any]:
    path = REPO_ROOT / "frontDemo" / "public" / "models" / "L1-ciou-research.json"
    if not path.exists():
        return {"ok": False, "error": "frontDemo/public/models/L1-ciou-research.json is missing"}
    onnx = json.loads(path.read_text(encoding="utf-8"))
    same = onnx.get("source_weights_sha256") == weights_sha256
    precomputed = REPO_ROOT / "frontDemo" / "public" / "precomputed" / "index.json"
    entries = len(json.loads(precomputed.read_text(encoding="utf-8")).get("entries", {})) if precomputed.exists() else 0
    return {"ok": same, "sha256": onnx.get("sha256"), "precision": onnx.get("precision"),
            "exported_from_release_weights": same, "precomputed_entries": entries}


@router.get("/health", response_model=Health)
def health(request: Request, store: Store,
           jobs: Jobs) -> dict[str, Any]:
    """Database, weights and forcing-cache status, and what the API can serve."""
    weights = request.app.state.weights_status
    cache_dir = REPO_ROOT / DEFAULT_CACHE_DIR
    forcing = sorted(cache_dir.glob("*.nc")) if cache_dir.exists() else []
    scenes = store.scenes()
    database = dict(request.app.state.database)
    database["used_by_this_api"] = False
    database["note"] = ("The API reads the pipeline's files; the hosted PostGIS is not in its request path "
                        "(ISSUES X1, X4).")
    return {
        "status": "ok" if weights.get("ok") and scenes else "degraded",
        "database": database,
        "weights": weights,
        "browser_model": browser_model_status(weights.get("sha256")),
        "forcing_cache": {"dir": str(DEFAULT_CACHE_DIR).replace("\\", "/"), "files": len(forcing),
                          "bytes": sum(p.stat().st_size for p in forcing),
                          "note": "ERA5 10 m wind only; no current field (ISSUES X2)"},
        "artifacts": {"scenes": len(scenes), "with_drift": sum(1 for s in scenes if s.run_dir is not None),
                      "api_runs": sum(1 for s in scenes if s.origin == "api-run")},
        "runs": jobs.describe(),
        "offline": is_offline(),
    }
