"""The API's contract (PLAN/INTERFACES.md §3) over a small artifact tree built here.

Every endpoint is exercised against files shaped exactly as the pipeline and
the real-run exports write them. Spatial responses are checked as GeoJSON with
shapely, errors as RFC 7807, and the two refusals the system is built around --
no age (C1) and nobody ranked (C3) -- as results, not failures.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import shape

pytest.importorskip("roaring_landmask")

from backend.app.jobs import JobManager
from backend.app.main import create_app
from backend.app.store import ArtifactStore, detection_uuid, scene_uuid
from tests.test_export_drift_runs import PIXEL, SEA, _box

STEM = "S1A_IW_GRDH_1SDV_20230409T000206_20230409T000231_048012_05C552_27F2_s0db"
PROBLEM = "application/problem+json"


def _streak(lon: float, lat: float, steps: int) -> list[list[float]]:
    """A thin diagonal slick: valid, and no edge runs along the pixel grid."""
    lower = [[lon + 4 * i * PIXEL, lat + 4 * i * PIXEL] for i in range(steps + 1)]
    upper = [[x - 3 * PIXEL, y + 3 * PIXEL] for x, y in lower]
    return lower + upper[::-1] + [lower[0]]


def _cells(lon: float, lat: float, n: int) -> list[list[list[float]]]:
    """Origin-field cell boxes (0.01 degrees), as `contour_geojson` writes them."""
    return [[[lon + i * 0.01, lat], [lon + (i + 1) * 0.01, lat], [lon + (i + 1) * 0.01, lat + 0.01],
             [lon + i * 0.01, lat + 0.01], [lon + i * 0.01, lat]] for i in range(n)]


def _drift(age: dict[str, Any]) -> dict[str, Any]:
    frames = []
    for hour in range(-3, 4):
        frame = {"hour": hour, "particles": [SEA[0], SEA[1]], "contour50": _cells(SEA[0], SEA[1], 1),
                 "contour90": _cells(SEA[0], SEA[1], 2 + abs(hour)), "area50Km2": 1.0,
                 "area90Km2": 2.0 + abs(hour), "spreadKm": 1.0 + abs(hour)}
        if hour > 0:
            frame["strandedPct"] = 10.0 * hour
        frames.append(frame)
    return {
        "scene": STEM, "acquiredAtIso": "2023-04-09T00:02:06Z", "seed": list(SEA), "engine": "OpenDrift OpenOil",
        "forcing": "era5", "forcingNote": "ERA5 10 m wind only; no current field (ISSUES X2).",
        "forwardForcingNote": "ERA5 after the pass.", "members": 10, "particlesPerMember": 200,
        "backwardHours": 3, "forwardHours": 3, "seeding": "over the polygon", "age": age,
        "convergence": [{"hour": f["hour"], "area90Km2": f["area90Km2"], "spreadKm": f["spreadKm"]}
                        for f in frames if f["hour"] <= 0],
        "frames": frames,
    }


CONVERGED = {"age_hours": {"low": 0.0, "best": 1.5, "high": 3.0}, "age_method": "convergence_minimum",
             "status": "converged", "spread_km": 1.0, "explanation": "tightest 1.5 h before"}
MONOTONIC = {"age_hours": {"low": None, "best": None, "high": None}, "age_method": "none",
             "status": "monotonic", "spread_km": 2.0, "explanation": "never re-focused"}


def _character() -> dict[str, Any]:
    return {
        "detectionId": "x", "areaKm2": 0.5, "lengthKm": 4.0, "widthMMean": 120.0,
        "widthMProfile": [100.0, 120.0, 140.0], "orientationDeg": 45.0, "elongation": 8.0, "compactness": 0.1,
        "fragmentation": 1, "head": [SEA[0], SEA[1]], "tail": [SEA[0] + 0.03, SEA[1] + 0.03],
        "headTailResolvedBy": "ambiguous", "medialAxis": [[SEA[0], SEA[1]], [SEA[0] + 0.03, SEA[1] + 0.03]],
        "dampingRatioDb": -3.0, "dampingConfidence": "low", "windSpeedMs": 6.0, "windGateMultiplier": 1.0,
        "damping": {"note": "clean sea only"},
        "wind": {"speedMs": 6.0, "fromDeg": 90.0, "gridPoint": [-89.5, 28.5], "validTime": "2023-04-09T00:00:00Z",
                 "offsetS": -126.0, "source": "ERA5"},
        "agePrior": {"lowHours": 0.0, "bestHours": 1.0, "highHours": 5.0, "widthM": 120.0,
                     "method": "fay_surface_tension", "confidence": "low", "explanation": "a ceiling"},
        "source": "backend/characterize",
    }


@pytest.fixture
def tree(tmp_path: Path) -> dict[str, Path]:
    scenes = tmp_path / "scenes"
    runs = tmp_path / "public" / "runs" / STEM
    ais = tmp_path / "public" / "ais"
    days = tmp_path / "ais-days"
    for d in (scenes, runs, ais, days, tmp_path / "api-runs", tmp_path / "sar"):
        d.mkdir(parents=True, exist_ok=True)
    streak = _streak(*SEA, 40)
    box = _box(SEA[0] + 600 * PIXEL, SEA[1], 400)
    document = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [streak]}, "properties": {"confidence": 0.5}},
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [box]}, "properties": {"confidence": 0.3}},
    ]}
    (scenes / f"{STEM}.geojson").write_text(json.dumps(document))
    (runs / "drift.json").write_text(json.dumps(_drift(CONVERGED)))
    (runs / "scene.json").write_text(json.dumps({
        "scene": STEM,
        "detections": [{"ring": streak, "feature": 0, "confidence": 0.5, "seed": True, "boxCut": False},
                       {"ring": box, "feature": 1, "confidence": 0.3, "seed": False, "boxCut": True}],
        "cfar": {"status": "run", "radiusKm": 15, "targets": [{"position": [SEA[0] - 0.001, SEA[1]], "peakDb": 9.0,
                                                               "areaPx": 9}]},
        "characterisation": _character(),
        "detectionSource": "fixture",
        "wind": {"source": "ERA5", "gridPoint": [-89.5, 28.5], "hours": [0], "ms": [6.0], "fromDeg": [90.0],
                 "current": "none"},
    }))
    (ais / "real-20230409.json").write_text(json.dumps({"vessels": [
        {"id": "367000001", "t": [-300, 300], "lon": [SEA[0] - 0.001, SEA[0] - 0.001], "lat": [SEA[1], SEA[1]]}]}))
    t0 = 1680998400  # 2023-04-09T00:00:00Z
    np.savez(days / "AIS_2023_04_09_gulf.npz", mmsi=np.array([477636500, 477636500, 1]), t=np.array([t0, t0 + 60, t0]),
             lon=np.array([-89.3, -89.31, -80.0]), lat=np.array([28.2, 28.21, 20.0]),
             sog=np.array([8.0, np.nan, 1.0], dtype=np.float32), cog=np.array([90.0, 91.0, 0.0], dtype=np.float32),
             type=np.array([80, 80, 30], dtype=np.int16), length=np.array([180.0, 180.0, 10.0], dtype=np.float32),
             draft=np.array([9.0, 9.0, 1.0], dtype=np.float32))
    return {"root": tmp_path, "scenes": scenes, "runs": runs, "ais": ais, "days": days}


@pytest.fixture
def client(tree: dict[str, Path]) -> TestClient:
    root = tree["root"]
    store = ArtifactStore(scenes_dir=tree["scenes"], public_runs=root / "public" / "runs", public_ais=tree["ais"],
                          api_runs=root / "api-runs", sar_dir=root / "sar", ais_days=tree["days"])
    app = create_app(store=store, jobs=JobManager(root / "api-runs"), probe_database=False, warm=False)
    with TestClient(app) as test_client:
        yield test_client


def _ids() -> tuple[uuid.UUID, str, str]:
    scene = scene_uuid(STEM)
    return scene, str(detection_uuid(scene, 0)), str(detection_uuid(scene, 1))


def _valid(geometry: dict[str, Any]) -> None:
    parsed = shape(geometry)
    assert not parsed.is_empty and parsed.is_valid, geometry["type"]


def test_scenes_are_listed_with_derived_stable_ids(client: TestClient) -> None:
    scene, seed, _ = _ids()
    listed = client.get("/api/v1/scenes").json()
    assert [s["id"] for s in listed] == [str(scene)]
    row = listed[0]
    assert row["detection_count"] == 2 and row["seed_detection_id"] == seed
    assert row["region"] == "gulf-of-mexico" and row["has_drift"] is True
    assert row["acquired_at"] == "2023-04-09T00:02:06Z"
    detail = client.get(f"/api/v1/scenes/{scene}").json()
    # No COG or tile server exists (ISSUES X6): the API says so instead of inventing a URL.
    assert detail["basemap"] is None and "X6" in detail["basemap_note"]


def test_detections_are_valid_geojson_of_one_class(client: TestClient) -> None:
    scene, seed, other = _ids()
    collection = client.get(f"/api/v1/scenes/{scene}/detections").json()
    assert collection["type"] == "FeatureCollection"
    for feature in collection["features"]:
        _valid(feature["geometry"])
        # The weights declare one class; oos is a downstream verdict, never a detector class.
        assert feature["properties"]["class_name"] == "slick"
    by_id = {f["id"]: f["properties"] for f in collection["features"]}
    assert by_id[seed]["seed"] is True and by_id[seed]["box_cut"] is False
    assert by_id[other]["seed"] is False and by_id[other]["box_cut"] is True


def test_the_seed_carries_its_characterisation_and_verdict(client: TestClient) -> None:
    _, seed, other = _ids()
    detail = client.get(f"/api/v1/detections/{seed}").json()
    character = detail["characterisation"]
    assert character["damping_confidence"] == "low"  # C2
    assert 0 <= character["wind_gate_multiplier"] <= 1  # C9
    assert set(character["age_prior"]) >= {"low", "best", "high", "method"}  # C1
    _valid(character["medial_axis"])
    assert detail["verdict"]["verdict"] in {"oos", "slick_unknown"}
    assert len(detail["verdict"]["terms"]) == 6
    plain = client.get(f"/api/v1/detections/{other}").json()
    assert plain["characterisation"] is None and "seed detection only" in plain["characterisation_note"]


def test_backward_drift_is_time_indexed_with_an_age_triple(client: TestClient) -> None:
    _, seed, _ = _ids()
    drift = client.get(f"/api/v1/detections/{seed}/drift", params={"direction": "backward"}).json()
    props = drift["properties"]
    assert props["hours"] == [-3, -2, -1, 0]
    assert props["timesteps"][0] == "2023-04-08T21:02:06Z" and props["timesteps"][-1] == "2023-04-09T00:02:06Z"
    assert props["age"]["method"] == "drift_convergence"
    assert (props["age"]["low"], props["age"]["best"], props["age"]["high"]) == (0.0, 1.5, 3.0)
    assert props["temporal_state"] == "ongoing"
    assert props["insufficient_evidence"] is True and props["insufficient_evidence_reasons"]
    assert props["origin_area_km2"] == 5.0
    for feature in drift["features"]:
        _valid(feature["geometry"])
        assert feature["properties"]["probability"] in (0.5, 0.9)
        assert 0 <= feature["properties"]["timestep_index"] < len(props["timesteps"])
    # Cell boxes are dissolved into one region, not served as a grid.
    horizon = [f for f in drift["features"] if f["properties"]["hour"] == -3 and f["properties"]["probability"] == 0.9]
    assert len(horizon) == 1 and shape(horizon[0]["geometry"]).geom_type == "Polygon"


def test_forward_drift_is_the_forecast_from_the_pass(client: TestClient) -> None:
    _, seed, _ = _ids()
    props = client.get(f"/api/v1/detections/{seed}/drift", params={"direction": "forward"}).json()["properties"]
    assert props["hours"] == [0, 1, 2, 3]
    assert props["stranded_pct"] == 30.0
    assert props["age"] is None and props["insufficient_evidence"] is False


def test_an_unconverged_field_keeps_the_triple_and_refuses_the_age(client: TestClient, tree: dict[str, Path]) -> None:
    (tree["runs"] / "drift.json").write_text(json.dumps(_drift(MONOTONIC)))
    _, seed, _ = _ids()
    props = client.get(f"/api/v1/detections/{seed}/drift").json()["properties"]
    age = props["age"]
    assert (age["low"], age["best"], age["high"]) == (None, None, None)  # C1: a triple, never a bare scalar
    assert age["method"] == "no_convergence" and age["status"] == "monotonic"
    assert props["temporal_state"] == "indeterminate"
    assert any("never converges" in r for r in props["insufficient_evidence_reasons"])


def test_suspects_answer_insufficient_evidence_at_200(client: TestClient) -> None:
    _, seed, other = _ids()
    response = client.get(f"/api/v1/detections/{seed}/suspects")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(PROBLEM)
    body = response.json()
    assert body["type"] == "/errors/insufficient-evidence" and body["status"] == 200
    assert "wind-only" in body["detail"]
    assert client.get(f"/api/v1/detections/{other}/suspects").status_code == 404
    evidence = client.get(f"/api/v1/suspects/{uuid.uuid4()}/evidence")
    assert evidence.status_code == 404 and evidence.headers["content-type"].startswith(PROBLEM)


def test_drift_for_a_detection_that_was_not_drifted_is_a_problem(client: TestClient) -> None:
    _, _, other = _ids()
    response = client.get(f"/api/v1/detections/{other}/drift")
    assert response.status_code == 404
    assert response.json()["type"] == "/errors/no-drift-run"


def test_unknown_ids_are_rfc7807_problems(client: TestClient) -> None:
    for path in ("/api/v1/scenes/nope", f"/api/v1/scenes/{uuid.uuid4()}", f"/api/v1/detections/{uuid.uuid4()}"):
        response = client.get(path)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith(PROBLEM)
        assert set(response.json()) >= {"type", "title", "status", "detail"}


def test_a_vessel_track_comes_from_the_ais_days_on_disk(client: TestClient) -> None:
    window = {"from": "2023-04-09T00:00:00Z", "to": "2023-04-09T06:00:00Z"}
    track = client.get("/api/v1/vessels/477636500/track", params=window).json()
    assert track["geometry"]["type"] == "LineString"
    points = track["properties"]["points"]
    assert [p["t"] for p in points] == ["2023-04-09T00:00:00Z", "2023-04-09T00:01:00Z"]
    assert points[1]["sog"] is None  # absent stays absent, never a made-up 0
    missing = client.get("/api/v1/vessels/477636500/track",
                         params={"from": "2023-06-01T00:00:00Z", "to": "2023-06-01T06:00:00Z"})
    assert missing.status_code == 404 and missing.json()["type"] == "/errors/no-ais"
    too_long = client.get("/api/v1/vessels/1/track", params={"from": "2023-04-01T00:00:00Z", "to": "2023-04-30T00:00:00Z"})
    assert too_long.status_code == 422


def test_health_reports_what_the_api_can_serve(client: TestClient) -> None:
    health = client.get("/api/v1/health").json()
    assert set(health) >= {"status", "database", "weights", "browser_model", "forcing_cache", "artifacts", "runs"}
    assert health["artifacts"]["scenes"] == 1 and health["artifacts"]["with_drift"] == 1
    assert health["database"]["used_by_this_api"] is False
