"""Artifacts to API responses: the shapes of `INTERFACES.md` §2-3, filled from the files.

Everything here is a pure function of files the pipeline wrote; nothing runs a
model or a simulation. The only derived numbers are geometry (areas, the
dissolve of the origin field's cells into polygons) and the backend verdict
twin on a seed an older export did not record it for.
"""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.app.store import ArtifactStore, SceneEntry, detection_uuid
from backend.regions import zone_of

API = "/api/v1"
SIMPLIFY_DEG = 0.0002
BASEMAP_NOTE = (
    "No web-ready imagery exists: a processed scene is a 3.6 GB BigTIFF, with no COG pyramid, tile "
    "server or object storage behind it (ISSUES X6). The console draws its own basemap."
)
CONTOURS_NOTE = (
    "The 50% and 90% highest-density regions of every OpenDrift parcel on the backend's 0.01 degree "
    "origin-field grid, dissolved from its cells, not smoothed: the geometry claims no more precision "
    "than the grid holds. The console smooths its own drawing from the parcels."
)


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _area_km2(geometry: Any) -> float:
    lat = geometry.centroid.y
    return float(geometry.area * 110.574 * 111.320 * math.cos(math.radians(lat)))


def detection_rows(store: ArtifactStore, scene: SceneEntry) -> list[dict[str, Any]]:
    """Each detection's simplified geometry, confidence, box-cut flag and area, cached per file."""

    def build(document: dict[str, Any]) -> list[dict[str, Any]]:
        from shapely.geometry import mapping, shape

        from backend.drift.seedrule import FRAME_EDGE_KM, straight_edge_km

        rows = []
        for feature in document.get("features", []):
            geometry = shape(feature["geometry"])
            parts = list(getattr(geometry, "geoms", [geometry]))
            rows.append({
                "geometry": mapping(geometry.simplify(SIMPLIFY_DEG, preserve_topology=True)),
                "confidence": float(feature.get("properties", {}).get("confidence", 0.0)),
                "box_cut": max((straight_edge_km(p) for p in parts), default=0.0) >= FRAME_EDGE_KM,
                "area_km2": round(_area_km2(geometry), 4),
                "bounds": list(geometry.bounds),
            })
        return rows

    rows: list[dict[str, Any]] = store.files.get(scene.detections_path, build, key="rows")
    return rows


def scene_summary(store: ArtifactStore, scene: SceneEntry) -> dict[str, Any]:
    rows = detection_rows(store, scene)
    seed = store.seed_feature(scene)
    bbox = None
    if rows:
        bbox = [min(r["bounds"][0] for r in rows), min(r["bounds"][1] for r in rows),
                max(r["bounds"][2] for r in rows), max(r["bounds"][3] for r in rows)]
    return {
        "id": str(scene.id),
        "name": scene.name,
        "label": scene.label,
        "origin": scene.origin,
        "run_id": scene.run_id,
        "acquired_at": iso(scene.acquired_at),
        "bbox": bbox,
        # The zone whose AOI holds the scene (the region registry, PHASE-10).
        "region": zone_of((bbox[0], bbox[1], bbox[2], bbox[3])) if bbox else None,
        "detection_count": len(rows),
        "seed_detection_id": None if seed is None else str(detection_uuid(scene.id, seed)),
        "has_drift": scene.run_dir is not None,
    }


def scene_detail(store: ArtifactStore, scene: SceneEntry) -> dict[str, Any]:
    record = store.scene_file(scene) or {}
    source = record.get("detectionSource") or (
        "release model (L1-ciou research) on the full scene, eval/final/scenes"
        if scene.origin == "release-export" else None)
    return scene_summary(store, scene) | {
        "detections_url": f"{API}/scenes/{scene.id}/detections",
        "detection_source": source,
        "basemap": None,
        "basemap_note": BASEMAP_NOTE,
        "raster_on_disk": scene.raster_path is not None,
    }


def detection_feature(store: ArtifactStore, scene: SceneEntry, index: int) -> dict[str, Any]:
    row = detection_rows(store, scene)[index]
    detection_id = str(detection_uuid(scene.id, index))
    return {
        "type": "Feature",
        "id": detection_id,
        "geometry": row["geometry"],
        "properties": {
            "id": detection_id,
            "scene_id": str(scene.id),
            "class_name": "slick",
            "confidence": round(row["confidence"], 4),
            "acquired_at": iso(scene.acquired_at),
            "seed": store.seed_feature(scene) == index,
            "box_cut": row["box_cut"],
            "area_km2": row["area_km2"],
        },
    }


def detections_collection(store: ArtifactStore, scene: SceneEntry) -> dict[str, Any]:
    features = [detection_feature(store, scene, i) for i in range(len(detection_rows(store, scene)))]
    return {
        "type": "FeatureCollection",
        "properties": {
            "scene_id": str(scene.id),
            "count": len(features),
            "detector": "release model L1-ciou (research): one class, `slick`; oos vs slick_unknown is a "
                        "downstream verdict, never a detector class (FUTURE_WORK §2.4)",
            "simplified_deg": SIMPLIFY_DEG,
        },
        "features": features,
    }


def characterisation(record: dict[str, Any], detection_id: str) -> dict[str, Any]:
    """The console's characterisation record (`Characterisation.as_console`) in `INTERFACES.md` §2 names."""
    wind = record.get("wind")
    damping = record.get("damping")
    prior = record.get("agePrior") or {}
    return {
        "detection_id": detection_id,
        "area_km2": record["areaKm2"],
        "length_km": record["lengthKm"],
        "width_m_mean": record["widthMMean"],
        "width_m_profile": record["widthMProfile"],
        "orientation_deg": record["orientationDeg"],
        "elongation": record["elongation"],
        "compactness": record["compactness"],
        "fragmentation": record["fragmentation"],
        "head": {"type": "Point", "coordinates": record["head"]},
        "tail": {"type": "Point", "coordinates": record["tail"]},
        "head_tail_resolved_by": record.get("headTailResolvedBy"),
        "medial_axis": {"type": "LineString", "coordinates": record.get("medialAxis") or []},
        "damping_ratio_db": record.get("dampingRatioDb"),
        "damping_confidence": "low",
        "damping_note": None if damping is None else damping.get("note"),
        "wind_speed_ms": record.get("windSpeedMs"),
        "wind_gate_multiplier": record.get("windGateMultiplier"),
        "wind_note": None if wind is None else (
            f"{wind['source']}, grid point {wind['gridPoint']}, {abs(wind['offsetS']) / 60:.0f} min from the pass"),
        "age_prior": {
            "low": prior.get("lowHours"), "best": prior.get("bestHours"), "high": prior.get("highHours"),
            "method": prior.get("method"), "confidence": prior.get("confidence"),
            "explanation": prior.get("explanation"),
        },
        "source": record.get("source", "backend/characterize"),
    }


def seed_verdict_record(store: ArtifactStore, scene: SceneEntry) -> dict[str, Any] | None:
    """The seed's verdict: the run's own when it wrote one, else the backend twin on the export's evidence."""
    record = store.scene_file(scene)
    if record is None or not record.get("characterisation"):
        return None
    if record.get("verdict"):
        return dict(record["verdict"])
    from backend.pipeline.run import seed_verdict

    radar = record.get("cfar") or {}
    targets = radar.get("targets", []) if radar.get("status") == "run" else []
    acquired = scene.acquired_at or datetime.now(UTC)
    return seed_verdict(record["characterisation"], targets, store.traffic(scene), acquired)


def detection_detail(store: ArtifactStore, scene: SceneEntry, index: int) -> dict[str, Any]:
    feature = detection_feature(store, scene, index)
    is_seed = feature["properties"]["seed"]
    record = store.scene_file(scene) or {}
    character = record.get("characterisation") if is_seed else None
    note = None
    if character is None:
        note = ("not characterised: the pipeline characterises and drifts the seed detection only "
                "(the largest at sea with a slick's edge)" if scene.run_dir is not None else
                "not characterised: no drift run exists for this scene")
    return feature | {
        "characterisation": None if character is None else characterisation(character, feature["id"]),
        "characterisation_note": note,
        "verdict": seed_verdict_record(store, scene) if is_seed else None,
        "drift_url": f"{API}/detections/{feature['id']}/drift?direction=backward" if is_seed else None,
    }


def _age(drift: dict[str, Any]) -> tuple[dict[str, Any], str]:
    age = drift.get("age") or {}
    triple = age.get("age_hours") or {}
    converged = age.get("status") == "converged" and all(
        isinstance(triple.get(k), (int, float)) for k in ("low", "best", "high"))
    if converged:
        best = float(triple["best"])
        state = "ongoing" if best <= 6 else "recent" if best <= 24 else "legacy"
        return ({"low": triple["low"], "best": triple["best"], "high": triple["high"], "method": "drift_convergence",
                 "status": "converged", "explanation": age.get("explanation")}, state)
    return ({"low": None, "best": None, "high": None, "method": "no_convergence",
             "status": age.get("status") or age.get("method"),
             "explanation": age.get("explanation") or age.get("reason")}, "indeterminate")


def attribution_refusal(drift: dict[str, Any]) -> list[str]:
    """Why nobody is ranked, in the order a reader needs it."""
    age, _ = _age(drift)
    reasons = []
    if age["status"] != "converged":
        reasons.append("the backward field never converges, so there is no age to gate candidates on (C1)")
    if drift.get("forcing") == "era5+cmems":
        from backend.pipeline.run import UNSCORED_REASON

        reasons.append(UNSCORED_REASON)
    else:
        reasons.append(f"the field is wind-only ({drift.get('forcingNote', 'no current field')}), and a wind-only "
                       "field cannot carry an attribution")
    return reasons


def drift_collection(store: ArtifactStore, scene: SceneEntry, detection_id: uuid.UUID, direction: str) -> dict[str, Any]:
    """The origin field (backward) or the forecast (forward) as a time-indexed FeatureCollection."""
    assert scene.run_dir is not None
    drift_path = scene.run_dir / "drift.json"

    def build(drift: dict[str, Any]) -> dict[str, Any]:
        from shapely.geometry import Polygon, mapping
        from shapely.ops import unary_union

        acquired = datetime.fromisoformat(drift["acquiredAtIso"].replace("Z", "+00:00"))
        backward = direction == "backward"
        frames = sorted(
            (f for f in drift["frames"] if (f["hour"] <= 0 if backward else f["hour"] >= 0)),
            key=lambda f: f["hour"],
        )
        features = []
        for index, frame in enumerate(frames):
            for level, key, area in (("0.9", "contour90", "area90Km2"), ("0.5", "contour50", "area50Km2")):
                rings = frame.get(key) or []
                if not rings:
                    continue
                region = unary_union([Polygon(r) for r in rings if len(r) >= 4])
                if region.is_empty:
                    continue
                features.append({
                    "type": "Feature",
                    "properties": {"timestep_index": index, "hour": frame["hour"], "probability": float(level),
                                   "area_km2": frame.get(area), "spread_km": frame.get("spreadKm")},
                    "geometry": mapping(region),
                })
        age, state = _age(drift)
        members = int(drift["members"])
        properties = {
            "detection_id": "",
            "direction": direction,
            "timesteps": [iso(acquired + timedelta(hours=f["hour"])) for f in frames],
            "hours": [f["hour"] for f in frames],
            "horizon_hours": int(drift["backwardHours"] if backward else drift.get("forwardHours", 0)),
            "ensemble_size": members,
            "particle_count": members * int(drift["particlesPerMember"]),
            "engine": drift["engine"],
            "forcing": drift["forcing"],
            "forcing_note": drift["forcingNote"] if backward else drift.get("forwardForcingNote", drift["forcingNote"]),
            "seed": drift["seed"],
            "seeding": drift.get("seeding", ""),
            "convergence": [
                {"time": iso(acquired + timedelta(hours=c["hour"])), "hour": c["hour"],
                 "area90_km2": c["area90Km2"], "spread_km": c["spreadKm"]}
                for c in drift.get("convergence", [])
            ] if backward else None,
            "age": age if backward else None,
            "temporal_state": state if backward else None,
            "insufficient_evidence": backward,
            "insufficient_evidence_reasons": attribution_refusal(drift) if backward else [],
            "origin_area_km2": frames[0]["area90Km2"] if backward and frames else None,
            "stranded_pct": frames[-1].get("strandedPct") if not backward and frames else None,
            "contours_note": CONTOURS_NOTE,
        }
        return {"type": "FeatureCollection", "properties": properties, "features": features}

    collection: dict[str, Any] = store.files.get(drift_path, build, key=f"drift:{direction}")
    return collection | {"properties": collection["properties"] | {"detection_id": str(detection_id)}}
