# ARCHITECTURE

Authoritative description of system structure. Phase files reference this rather than
restating it. Research justification lives in `RESEARCH/SYNTHESIS.md` §3.

## System overview

```
                     ┌──────────────────── INGEST ─────────────────────┐
  Sentinel-1 GRD ───▶│  CDSE / AWS Open Data                           │
  (IW, VV, 10 m)     │      ↓                                          │
                     │  SNAP chain: calibrate σ0 → Refined Lee →       │
                     │              land mask → terrain correct        │
                     │      ↓                                          │
                     │  1024×1024 tiles (overlap) + exact geotransform │
                     └────────────────────┬────────────────────────────┘
                                          ▼
                     ┌──────────────────── DETECT ─────────────────────┐
                     │  YOLO-seg + LSK(L5) + MPDIoU, SAHI inference    │
                     │      classes: oos | slick_unknown               │
                     │      output: instance masks + confidence        │
                     │  CFAR bright-target detector → ships/platforms  │
                     └────────────────────┬────────────────────────────┘
                                          ▼
   ERA5/CMEMS wind ─▶┌───────────────  CHARACTERISE ───────────────────┐
   (gate 3–12 m/s)   │  area, medial axis → length, width profile,     │
                     │  orientation, elongation, compactness,          │
                     │  fragmentation, head/tail, damping ratio,       │
                     │  wind gate multiplier                           │
                     └────────────────────┬────────────────────────────┘
                                          ▼
  CMEMS currents ───▶┌────────────────── DRIFT ────────────────────────┐
  ERA5/GFS wind ────▶│  OpenDrift OpenOil, N-member ensemble           │
                     │    seed: particles sampled inside instance mask │
                     │    BACKWARD (negative time_step) 0–48 h         │
                     │    FORWARD 0–72 h                               │
                     │  ⇒ origin_field P(lat,lon,t) + convergence      │
                     │  ⇒ age {low,best,high} + temporal state         │
                     │  ⇒ forward impact forecast                      │
                     └────────────────────┬────────────────────────────┘
                                          ▼
  AIS  real (GoM) ──▶┌──────────────── ATTRIBUTE ──────────────────────┐
  AIS  synth (IN) ──▶│  1. candidates: gate tracks on origin_field     │
                     │     + dark vessels (CFAR, no AIS) + infra       │
                     │  2. features: S_drift, S_parity, S_proximity,   │
                     │     S_temporality, S_behaviour, S_prior         │
                     │  3. collation score (vessels ⟷ infrastructure)  │
                     │  4. evidence card per suspect                   │
                     └────────────────────┬────────────────────────────┘
                                          ▼
              ┌────────── PostGIS ──────────┐      ┌──── FastAPI ────┐
              │ scenes, detections,         │◀────▶│  REST + GeoJSON │
              │ characterisations, drift    │      └────────┬────────┘
              │ runs, ais_points, tracks,   │               ▼
              │ candidates, scores          │      React + MapLibre + deck.gl
              └─────────────────────────────┘
```

## Data flow, stage by stage

| # | Stage | Input | Output | Persisted as |
|---|---|---|---|---|
| 1 | Ingest | S1 GRD `.SAFE`, AOI, date | Geocoded σ0 dB GeoTIFF + tiles | `scenes`, files in `data/processed/` |
| 2 | Detect | Tiles | Instance masks + class + confidence | `detections` (PostGIS `MULTIPOLYGON`) |
| 3 | Characterise | Mask + σ0 raster + wind | Geometry, damping, head/tail, wind gate | `characterisations` |
| 4 | Drift | Mask + forcing | `origin_field`, forward forecast, age | `drift_runs`, NetCDF in `data/cache/` |
| 5 | Attribute | `origin_field` + AIS + CFAR + infra | Ranked suspects + score breakdown | `candidates`, `scores` |
| 6 | Serve | DB | REST/GeoJSON | — |

Stages 1–5 are a **batch pipeline**, invocable as one CLI command per scene. The API only
reads persisted results — no heavy computation behind a request. This matters for the demo:
nothing expensive happens while a judge is watching.

## Components and responsibilities

```
backend/
├── app/                  FastAPI: routers, pydantic schemas, dependencies
├── ingest/
│   ├── sar/              CDSE/AWS fetch; SNAP chain; tiling; geotransform
│   ├── ais/              marinecadastre loader; cleaning; trajectory build;
│   │                     synthetic Indian-waters generator (same schema)
│   └── metocean/         CMEMS + ERA5 readers; NetCDF cache
├── detect/
│   ├── yolo_lsk/         model def (LSK, MPDIoU), SAHI inference wrapper
│   └── cfar/             cell-averaging CFAR bright-target detector
├── characterize/
│   ├── geometry.py       area, medial axis, width profile, shape stats, head/tail
│   ├── damping.py        in-mask vs annulus σ0 contrast
│   └── age.py            morphology prior; consumes drift convergence
├── drift/
│   ├── opendrift_runner.py   single OpenOil run (fwd or bwd)
│   ├── ensemble.py           parameter/forcing sampling, parallel runs
│   └── origin_field.py       particle density → P(lat,lon,t); convergence metric
├── attribute/
│   ├── candidates.py     spatiotemporal gating; dark vessels; infrastructure
│   ├── features.py       the six S_* terms
│   ├── scoring.py        weighting, collation, ranking
│   └── evidence.py       evidence card assembly
├── db/                   SQLAlchemy models + alembic migrations
└── cli.py                run-scene, train, evaluate, seed-demo
```

**`ml/`** is separate from `backend/` by design: training and ablation are research
activities with different dependencies and lifecycles from serving. `ml/export/` writes
weights that `backend/detect/` loads.

## Key technology choices

| Choice | Rationale |
|---|---|
| **PostGIS** | Every core query is spatiotemporal ("AIS points inside this polygon between t0 and t1"). Doing this in pandas will not scale past one scene. Cerulean uses Postgres for the same reason |
| **OpenDrift OpenOil** | `RESEARCH/topics/drift-modelling-and-hindcasting.md`. Physics is sound (P002); named by P004; native backward support |
| **YOLO-seg + LSK(L5) + MPDIoU + SAHI** | `RESEARCH/SYNTHESIS.md` §3. Only family giving class + contour + small-object sensitivity + full-scene inference |
| **CFAR for ships** | No labels needed; bright targets on a dark sea is the easy detection case |
| **FastAPI** | Async, pydantic schemas, OpenAPI docs for free |
| **deck.gl over Leaflet** | Must render tens of thousands of AIS points and an animated particle cloud. Leaflet needs clustering to survive this; deck.gl is GPU-accelerated |
| **Batch pipeline + read-only API** | Demo reliability. See above |

## Communication between components

- **Within the pipeline:** direct Python calls. Each stage writes to PostGIS and returns
  IDs; the next stage reads by ID. No message broker — the pipeline is per-scene batch, and
  a queue would add failure modes for no benefit at this scale.
- **Pipeline → API:** exclusively through PostGIS. The API never invokes the pipeline
  synchronously.
- **API → frontend:** REST returning GeoJSON for anything spatial, plain JSON otherwise.
  See `INTERFACES.md`.
- **Drift artefacts:** `origin_field` is large (lat × lon × time). Stored as NetCDF on disk;
  PostGIS holds the path plus derived contours (GeoJSON) for map rendering. The API serves
  contours, not raw grids.

## Deployment (demo scope)

`docker-compose` with three services: `postgis`, `api`, `web`. The SNAP preprocessing step
runs in its own container (`ingest`) because SNAP/`esa_snappy` on Windows is a known
install hazard — see `CONSTRAINTS.md`.

Model weights and cached forcing ship as volume mounts, not baked into images.

## What this architecture deliberately does not do

- **No real-time streaming ingest.** Forensic attribution is not real-time; P002 confirms
  the drift model's weakness is real-time adaptation, which we simply avoid needing.
- **No response/robotics/remediation** (P002 §4.2–4.3, out of scope).
- **No AIS-triggered satellite tasking** (P003's direction — the inverse of our problem).
- **No learned drift surrogate.** P002 gives no evidence one beats the physics.
