# INTERFACES

Authoritative definition of communication boundaries. Phase files reference this.

## 1. Pipeline stage boundaries (in-process Python)

Each stage is a pure-ish function: reads persisted inputs by ID, writes results, returns an
ID. This makes every stage independently testable and re-runnable.

```python
# ingest.sar
def ingest_scene(safe_path: Path, aoi: Polygon | None) -> SceneId
    # -> writes geocoded σ0 dB GeoTIFF + tiles; row in `scenes`
    # raises: SarPreprocessError, GeocodingError

# detect
def detect(scene_id: SceneId, weights: Path) -> list[DetectionId]
    # -> instance masks, class in {"oos","slick_unknown"}, confidence
    # rows in `detections`. Empty list is a valid result.

# characterize
def characterize(detection_id: DetectionId) -> CharacterisationId
    # -> geometry, damping ratio, head/tail, wind gate multiplier

# drift
def run_drift(detection_id: DetectionId, cfg: DriftConfig) -> DriftRunId
    # -> origin_field NetCDF on disk + contours in DB; forward forecast;
    #    age {low,best,high}; temporal_state
    # raises: ForcingUnavailableError

# attribute
def attribute(drift_run_id: DriftRunId) -> list[CandidateId]
    # -> ranked candidates with per-term scores and evidence
```

**Error contract.** Every stage raises a typed exception on unrecoverable failure and
returns an empty/degraded result on expected-but-unhelpful outcomes (no detections; origin
field too diffuse). **A diffuse origin field is not an error** — it is a legitimate finding
that must reach the UI as `insufficient_evidence`.

## 2. Core data schemas

### `Detection`
```python
id: UUID
scene_id: UUID
class_name: Literal["oos", "slick_unknown"]
confidence: float  # model confidence, 0–1
geom: MultiPolygon  # EPSG:4326, PostGIS
acquired_at: datetime  # UTC, from the scene
```

### `Characterisation`
```python
detection_id: UUID
area_km2: float
length_km: float  # along medial axis
width_m_mean: float
width_m_profile: list[float]  # sampled along the axis
orientation_deg: float
elongation: float
compactness: float
fragmentation: int  # part count
head: Point  # perimeter point far from centreline
tail: Point
damping_ratio_db: float
damping_confidence: Literal["low"]  # always "low" — see slick-age-estimation
wind_speed_ms: float
wind_gate_multiplier: float  # continuous ∈[0,1], NOT a hard cut
```

### `DriftRun`
```python
id: UUID
detection_id: UUID
direction: Literal["backward", "forward"]
horizon_hours: int
ensemble_size: int
particle_count: int
origin_field_path: Path  # NetCDF (lat, lon, time)
contours: dict[str, GeoJSON]  # {"50": ..., "90": ...} per timestep
convergence: list[tuple[datetime, float]]
age_hours: tuple[float, float, float]  # (low, best, high) — NEVER a scalar
age_method: Literal["drift_convergence", "source_coincidence", "beyond_horizon"]
temporal_state: Literal["ongoing", "recent", "legacy", "indeterminate"]
```

### `Candidate` and `SuspectScore`
```python
class Candidate:
    id: UUID
    drift_run_id: UUID
    kind: Literal["ais_vessel", "dark_vessel", "infrastructure"]
    mmsi: int | None
    vessel_name: str | None
    geom: Geometry  # track LINESTRING M, or Point for infra


class SuspectScore:
    candidate_id: UUID
    total: float  # collated, 0–1
    rank: int
    terms: dict[str, float]  # the six S_* terms, each 0–1
    weights: dict[str, float]  # explicit — no hidden constants
    evidence: EvidenceCard
```

### `EvidenceCard` — the interpretability contract
Required by `RESEARCH/SYNTHESIS.md` §7 commitment 5 (P002 challenge #3). Output here is an
**accusation of an environmental crime**; opacity is not acceptable.

```python
class EvidenceCard:
    term_explanations: dict[str, TermExplanation]
    matched_track_segment: LineString | None
    origin_window: tuple[datetime, datetime]
    origin_overlap_geom: Geometry | None  # where the track met the origin field
    anomaly_flags: list[AnomalyFlag]  # each carries its RAW series
    thumbnail_path: Path | None
    caveats: list[str]  # e.g. "wind 2.1 m/s — below gate"


class TermExplanation:
    value: float
    geometry: Geometry | None  # the geometry that produced this term
    detail: str  # human-readable, e.g. "head 1.2 km from track at 21:14Z"
```

## 3. REST API

Base `/api/v1`. All spatial payloads are **GeoJSON**; all times **ISO-8601 UTC**.
Read-only — the API never triggers the pipeline (see `ARCHITECTURE.md`).

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/scenes` | Scene list: id, acquired_at, bbox, region, detection count |
| GET | `/scenes/{id}` | Scene detail + COG/tile URL for the SAR basemap |
| GET | `/scenes/{id}/detections` | `FeatureCollection` of slick polygons, class + confidence |
| GET | `/detections/{id}` | Detection + its `Characterisation` |
| GET | `/detections/{id}/drift?direction=backward` | Origin-field contours as time-indexed `FeatureCollection`; convergence series; age; temporal state |
| GET | `/detections/{id}/drift?direction=forward` | Forward impact forecast, time-indexed |
| GET | `/detections/{id}/suspects` | Ranked `SuspectScore[]` incl. full term breakdown |
| GET | `/suspects/{id}/evidence` | Full `EvidenceCard` |
| GET | `/vessels/{mmsi}/track?from=&to=` | `LineString` + AIS points |
| GET | `/health` | DB + weights + forcing-cache status |

**Time-indexed FeatureCollection** — the shape the deck.gl time slider consumes:
```json
{ "type": "FeatureCollection",
  "properties": { "timesteps": ["2023-05-14T16:00Z", "..."] },
  "features": [ { "type":"Feature",
                  "properties": { "timestep_index": 0, "probability": 0.9 },
                  "geometry": { "type":"Polygon", "coordinates": [] } } ] }
```

**Errors** — RFC 7807 problem+json:
```json
{ "type":"/errors/insufficient-evidence", "title":"Origin window too diffuse",
  "status":200, "detail":"90% contour spans 412 km² after 36 h; no candidate discriminated." }
```
Note `status: 200`. **Insufficient evidence is a result, not a failure.**

## 4. External interfaces

| Producer | Consumer | Protocol | Auth | Failure behaviour |
|---|---|---|---|---|
| CDSE (STAC/OData/S3) | `ingest.sar` | HTTPS | OAuth client credentials | Retry w/ backoff; fall back to AWS Open Data |
| AWS Open Data Registry | `ingest.sar` | S3 | anonymous | Fall back to CDSE |
| CMEMS | `ingest.metocean` | `copernicusmarine` client | user/pass via env or `.netrc` | **Fall back to local NetCDF cache** — required for offline demo |
| CDS (ERA5) | `ingest.metocean` | `cdsapi` | API key | Fall back to GFS, then to cache |
| marinecadastre | `ingest.ais` | HTTPS, Zstd CSV | none | Fail loudly — fixtures must be pre-downloaded |
| SNAP | `ingest.sar` | subprocess in container | none | `SarPreprocessError` |
| PostGIS | all | psycopg / SQLAlchemy | local creds | fail fast |

## 5. AIS ingest contract

Both the real loader and the synthetic generator **must emit this identical schema**, so one
downstream path serves both regions and the synthetic path is validated by the real one.

```
MMSI:int, BaseDateTime:datetime(UTC), LAT:float, LON:float,
SOG:float(kn), COG:float(deg), Heading:float(deg),
VesselName:str, IMO:str, CallSign:str, VesselType:int, Status:int,
Length:float(m), Width:float(m), Draft:float(m), Cargo:int, TransceiverClass:str
```

Synthetic records additionally carry a **ground-truth sidecar** (not in the main table)
naming the scripted discharging MMSI and release time/position — authored by us, never
derived from an anomaly detector (avoiding P003's circularity).

## 6. Model weights interface

`ml/export/` writes `weights/{name}.pt` plus a `weights/{name}.json` manifest:
```json
{ "name":"yolo-seg-lsk-l5-mpdiou", "classes":["oos","slick_unknown"],
  "imgsz":1024, "trained_on":["zenodo_p1","zenodo_p3","refined_sos"],
  "negatives_fraction":0.10, "map50":0.0, "map50_95":0.0,
  "lookalike_fp_count":0, "git_sha":"" }
```
`backend/detect` refuses to load weights whose `classes` do not match the expected scheme.
