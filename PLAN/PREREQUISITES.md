# PREREQUISITES

## Required — software

| Item | Version / note | Used by |
|---|---|---|
| Python | **3.12** (3.11 unavailable locally; 3.13+ unsupported by the stack) | everything |
| uv or Poetry | dependency management | everything |
| Docker + docker-compose | Containerising SNAP only; **no longer used for the database** | Phase 1 |
| **Supabase project** | Hosted Postgres + PostGIS, named `oilSpill-Detect` | Phase 0 onward |
| Node.js | 20 LTS | Phase 7 |
| Git | — | Phase 0 |
| CUDA toolkit + NVIDIA driver | matching the local GPU | Phase 2 |

## Required — Python packages

| Package | Purpose | Phase |
|---|---|---|
| `ultralytics` | YOLO-seg base | 2 |
| `torch` (CUDA build) | training | 2 |
| `sahi` | slicing-aided hyper-inference | 2 |
| `opendrift` | drift engine (pulls `oil_library`/NOAA OilLibrary) | 4 |
| `copernicusmarine` | CMEMS data access | 4 |
| `xarray`, `netCDF4`, `dask` | forcing fields, origin field | 4 |
| `rasterio`, `pyproj`, `shapely`, `geopandas` | geospatial I/O and geometry | 1, 3 |
| `scikit-image` | skeletonisation / medial axis | 3 |
| `scikit-learn` | Isolation Forest, One-Class SVM | 5, 6 |
| `pandas`, `pyarrow`, `zstandard` | AIS CSV (Zstd-compressed) | 5 |
| `sqlalchemy`, `geoalchemy2`, `alembic`, `psycopg` | DB layer | 0 |
| `fastapi`, `uvicorn`, `pydantic` v2 | API | 7 |
| `pytest`, `ruff`, `mypy` | quality | 0 |
| `typer` | CLI | 0 |

## Required — SAR preprocessing

**ESA SNAP** with `esa_snappy`, or **`pyroSAR`** as a wrapper. See `CONSTRAINTS.md` —
install this **in a Linux container**, not natively on Windows. Budget real time for this;
it is the most common early blocker in SAR projects.

## Required — accounts and credentials

| Account | For | Cost | Notes |
|---|---|---|---|
| **Supabase** (`supabase.com`) | Hosted Postgres + PostGIS | Free tier (500 MB) | Project **`oilSpill-Detect`**. Create manually - the Supabase MCP connector is not installed. See `scripts/SETUP_DATABASE.md` |
| **Copernicus Data Space Ecosystem** (`dataspace.copernicus.eu`) | Sentinel-1 GRD | Free | SciHub is dead — do not use `sentinelsat` against it |
| **Copernicus Marine Service** (`marine.copernicus.eu`) | CMEMS currents | Free | OpenDrift reads credentials from env vars or `.netrc` |
| CDS / ECMWF (`cds.climate.copernicus.eu`) | ERA5 wind | Free | Alternative: NOAA GFS, no account needed |
| AWS (optional) | S1 GRD via Open Data Registry | Free tier | Lower friction than CDSE for bulk; what Cerulean uses |

**Environment variables** (`.env`, git-ignored):
```
COPERNICUSMARINE_SERVICE_USERNAME=
COPERNICUSMARINE_SERVICE_PASSWORD=
CDSE_CLIENT_ID=
CDSE_CLIENT_SECRET=
CDSAPI_KEY=
DATABASE_URL=postgresql+psycopg://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require
DB_CONNECT_TIMEOUT=15
```

## Required — datasets

Full details and URLs in `RESEARCH/topics/datasets-and-data-access.md`.

| Dataset | Access | Priority |
|---|---|---|
| Zenodo S1 SAR Oil Spill Parts I (`8346860`) + III (`13761290`) | Open | **Required** — training positives |
| Zenodo Part II (`8253899`) — No-Oil / Look-alike | Open | **Required** — the look-alike negative pool |
| Refined Deep-SAR SOS (`15298010`) | Open | **Required** — corrected masks, prefer where overlapping |
| marinecadastre AIS, 2023-04-09 / **2023-05-15** / 2023-12-05 | Open | **Required** — validation fixtures |
| Sentinel-1 scenes for those three dates, Port of South Louisiana | Open via CDSE | **Required** |
| CMEMS reanalysis currents + ERA5 wind for those windows | Free account | **Required** |
| SAR Fixed Infrastructure Dataset (GoM) | Open | **Required** — Case 1 needs infrastructure candidates |

## Optional — improves the result, not required

| Item | Value | Why optional |
|---|---|---|
| **Krestenitis / MKLab dataset** | The reference 5-class benchmark; P004 used 615 of its images | **Request-gated** — email CERTH early, treat as bonus. Zenodo covers us if it never arrives |
| Sentinel-2 / Sentinel-3 imagery | Optical look-alike cross-check (P004 §3.6) | Cloud-free coincidence with S1 is uncommon; bonus enrichment only |
| Cerulean API / human-reviewed slick DB | Independent validation labels | Nice-to-have for Phase 8 |
| Eastern Mediterranean slick dataset (ESSD 2025) | Cross-region generalisation testing | Only if pursuing P002 challenge #2 seriously |
| GFW API access | Real dark-vessel / gap data | We implement the method, not their data |

## External tooling

- No tooling beyond the packages, accounts and datasets listed above is required to
  execute the build.

## Hard-won notes

1. **SciHub is dead** (2 Nov 2023). Any tutorial using `sentinelsat` against
   `scihub.copernicus.eu` is stale. Use CDSE or AWS.
2. **Request MKLab on day one** — request-gated datasets have long lead times, and it is the
   one dependency we cannot accelerate.
3. **Cache all met-ocean forcing early.** CMEMS auth/quota is a likely live-demo failure.
   Note the demo is no longer offline by default (the database is hosted); C12 requires a
   local snapshot fallback instead. See `PLAN/phases/PHASE-09.md`.
4. **Do not install SNAP natively on Windows.** Containerise it. Docker is still needed for
   this, just not for the database.
5. **Use Supabase's direct connection for migrations**, not the transaction pooler on 6543:
   the pooler has no prepared statements and alembic needs them.
6. **Clip AIS to the AOI and time window before insert.** Free tier is 500 MB and
   `ais_points` is what will exhaust it.
7. **The Zenodo masks are binary**; our class scheme needs two foreground classes. Budget a
   relabelling pass — see PHASE-01 and PHASE-02. This is the largest hidden cost in the plan.
