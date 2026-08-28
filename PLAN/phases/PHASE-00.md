# PHASE-00 — Scaffold, environment, research corpus

> **Superseded in part, 2026-08-28.** This phase is **complete**, but the database
> decision changed after it shipped: the project now uses **Supabase** (hosted Postgres +
> PostGIS), not a local Docker container. The `docker-compose.yml` and PostGIS references
> below record what was built at the time. For current setup follow
> `scripts/SETUP_DATABASE.md`. Docker is still used for the SNAP container in PHASE-01.

## Objective
A working development environment, repository skeleton, database, and the persistent
research corpus, such that any later session can resume from `HANDOFF.md` alone.

## Why it exists
Every later phase depends on PostGIS, the geospatial stack, and the research notes. Doing
this first prevents environment archaeology mid-build. The research corpus is also the
deliverable that makes the *reasoning* auditable, not just the code.

## Dependencies
None. This is the entry point.

## Files to create
```
pyproject.toml, .python-version, .gitignore, .env.example
docker-compose.yml                      postgis + api + web + ingest services
docker/ingest.Dockerfile                SNAP / esa_snappy (Linux — see CONSTRAINTS)
backend/__init__.py, backend/cli.py     typer CLI skeleton
backend/db/models.py, backend/db/session.py
alembic.ini, alembic/versions/0001_initial.py
tests/conftest.py, tests/test_smoke.py
README.md
HANDOFF.md
RESEARCH/**                             (DONE — see below)
PLAN/**                                 (DONE — see below)
```

## Files to modify
None.

## Implementation details

**Status: the research and plan corpus is already written.** `RESEARCH/` (INDEX, SYNTHESIS,
P001–P004, six topic notes, CITATION_GRAPH) and `PLAN/` (this file and its siblings) exist.
The remaining work in this phase is environment and scaffold only.

- Python 3.11; `uv` or Poetry. Pin the geospatial stack — GDAL/rasterio/pyproj version
  drift is a classic time sink.
- `docker-compose.yml`: `postgis/postgis:16-3.4`, healthcheck on `pg_isready`.
- Alembic migration `0001_initial` creates the tables in `INTERFACES.md` §2:
  `scenes, detections, characterisations, drift_runs, ais_points, ais_tracks,
  candidates, scores`. Enable `postgis` extension. GiST indexes on all geometry columns;
  BRIN on `ais_points.base_date_time`.
- `backend/cli.py`: stub commands `run-scene`, `train`, `evaluate`, `seed-demo`.
- `git init`; do **not** commit `data/`, `.env`, or model weights.
- Request the **Krestenitis/MKLab dataset by email now** — it is request-gated with a long
  lead time and is the one dependency that cannot be accelerated (`PREREQUISITES.md`).

## Inputs / outputs
- In: nothing
- Out: a running PostGIS, an importable `backend` package, a green test suite

## Relevant interfaces
`INTERFACES.md` §2 (data schemas — drives the migration).

## Relevant research
`RESEARCH/INDEX.md`, `RESEARCH/SYNTHESIS.md`.

## Tests
- `test_smoke.py`: imports `backend`, connects to PostGIS, asserts PostGIS version.
- `alembic upgrade head` then `downgrade base` runs clean.

## Acceptance criteria
- [ ] `docker compose up -d` brings PostGIS to healthy
- [ ] `pytest -q` green
- [ ] `alembic upgrade head` creates all tables with PostGIS geometry columns
- [ ] `python -m backend.cli --help` lists the four commands
- [ ] `ruff check` and `mypy backend` clean
- [ ] `RESEARCH/INDEX.md` links resolve to real files
- [ ] MKLab dataset request sent

## Known failure conditions
- GDAL/rasterio wheel conflicts on Windows → use conda-forge or the container.
- PostGIS extension missing → use the `postgis/postgis` image, not plain `postgres`.
