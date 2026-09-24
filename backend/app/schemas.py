"""Response models: `PLAN/INTERFACES.md` §2-3, as the repository can honestly fill them.

Where the repository has moved past the plan, the model follows the repository
and says so in its field:

  * **`class_name` is `slick`.** The release weights declare one class and say
    never to relabel predictions as `oos` (`weights/L1-ciou-research.json`);
    `oos` versus `slick_unknown` is a verdict computed downstream from evidence
    (FUTURE_WORK §2.4), served beside the detection as `verdict`.
  * **Age is a triple or a refusal, never a scalar** (C1). When the backward
    field never converges the triple is null and `method` says why.
  * **Nobody is ranked.** No candidate exists in any run on this machine; the
    suspects endpoint answers with an `insufficient-evidence` problem at HTTP
    200 (C3), which is a result, not a failure.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

GeoJSONGeometry = dict[str, Any]


class Problem(BaseModel):
    """RFC 7807 problem details."""

    type: str
    title: str
    status: int
    detail: str
    instance: str | None = None


class SceneSummary(BaseModel):
    id: str
    name: str
    label: str
    origin: Literal["release-export", "api-run"]
    run_id: str | None = None
    acquired_at: str | None
    bbox: list[float] | None = Field(description="west, south, east, north of every detection, EPSG:4326")
    region: str | None
    detection_count: int
    seed_detection_id: str | None = Field(description="the detection the drift was seeded from, if a drift was run")
    has_drift: bool


class SceneDetail(SceneSummary):
    detections_url: str
    detection_source: str | None
    basemap: dict[str, Any] | None
    basemap_note: str
    raster_on_disk: bool


class DetectionProperties(BaseModel):
    id: str
    scene_id: str
    class_name: Literal["slick"]
    confidence: float
    acquired_at: str | None
    seed: bool
    box_cut: bool = Field(description="the mask filled its inference box (ISSUES Q5): a straight edge >= 1.2 km")
    area_km2: float


class Characterisation(BaseModel):
    """`INTERFACES.md` §2 `Characterisation`, measured by `backend/characterize` on the seed."""

    detection_id: str
    area_km2: float
    length_km: float
    width_m_mean: float
    width_m_profile: list[float]
    orientation_deg: float
    elongation: float
    compactness: float
    fragmentation: int
    head: GeoJSONGeometry
    tail: GeoJSONGeometry
    head_tail_resolved_by: str | None
    medial_axis: GeoJSONGeometry
    damping_ratio_db: float | None = Field(description="relative contrast only, never a thickness (C2); null = not measured")
    damping_confidence: Literal["low"]
    damping_note: str | None
    wind_speed_ms: float | None
    wind_gate_multiplier: float | None = Field(description="continuous in [0, 1], never a hard cut (C9)")
    wind_note: str | None
    age_prior: dict[str, Any] = Field(description="Fay's surface-tension ceiling: {low, best, high} + method (C1)")
    source: str


class Verdict(BaseModel):
    verdict: Literal["oos", "slick_unknown"]
    support: float
    caution: str | None
    summary: str
    terms: list[dict[str, Any]]
    source: str


class DetectionDetail(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: str
    geometry: GeoJSONGeometry
    properties: DetectionProperties
    characterisation: Characterisation | None
    characterisation_note: str | None
    verdict: Verdict | None
    drift_url: str | None


class AgeTriple(BaseModel):
    low: float | None
    best: float | None
    high: float | None
    method: str
    status: str | None
    explanation: str | None


class DriftProperties(BaseModel):
    detection_id: str
    direction: Literal["backward", "forward"]
    timesteps: list[str]
    hours: list[int]
    horizon_hours: int
    ensemble_size: int
    particle_count: int
    engine: str
    forcing: str
    forcing_note: str
    seed: list[float]
    seeding: str
    convergence: list[dict[str, Any]] | None
    age: AgeTriple | None
    temporal_state: Literal["ongoing", "recent", "legacy", "indeterminate"] | None
    insufficient_evidence: bool
    insufficient_evidence_reasons: list[str]
    origin_area_km2: float | None
    stranded_pct: float | None
    contours_note: str


class DriftCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    properties: DriftProperties
    features: list[dict[str, Any]]


class VesselTrack(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GeoJSONGeometry | None
    properties: dict[str, Any]


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    database: dict[str, Any]
    weights: dict[str, Any]
    browser_model: dict[str, Any]
    forcing_cache: dict[str, Any]
    artifacts: dict[str, Any]
    runs: dict[str, Any]
    offline: bool


class RunStage(BaseModel):
    key: str
    label: str
    state: str
    ms: int | None = None
    detail: str | None = None
    progress: dict[str, int] | None = None


class RunStatus(BaseModel):
    id: str
    status: Literal["queued", "running", "done", "failed"]
    outcome: str | None
    source: str | None
    use_precomputed: bool
    created_at: str
    stages: list[RunStage]
    detail: str | None
    events_url: str
    files: dict[str, str]
    scene_id: str | None
    seed_detection_id: str | None
