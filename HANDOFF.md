# HANDOFF

Continuation state for the next session. Keep this small and current.

**Last updated:** 2026-08-28

---

## Current position

| | |
|---|---|
| **Phase** | **PHASE-00 complete.** Next: PHASE-01 |
| **Status** | Scaffold builds, `pytest` green (11 passed, 1 skipped), ruff + mypy clean |
| **Blocked on** | Two user decisions — see "Open decisions for the user" below |

## Environment as actually found (differs from the plan's assumptions)

| Assumed | Actual | Resolution |
|---|---|---|
| Python 3.11 | 3.14 and 3.12 present; no 3.11 | **Using 3.12** (`.venv`). 3.14 is too new for the geo/ML stack |
| Docker for PostGIS + SNAP | **Not installed** | `scripts/SETUP_DATABASE.md` documents a native Windows route; `docker-compose.yml` kept for later |
| `uv` | Not installed | Plain `pip` + `venv` |
| Local NVIDIA GPU for training | **GeForce GT 710, 2 GB, compute capability 3.5, CUDA 11.4** | **Cannot train the PHASE-02 model.** See open decisions |

## Completed

- All four supplied papers read in full (`paperSource/paper{1,2,3,4}`)
- Targeted web research covering the gaps the papers left open: OpenDrift backward
  mechanics, SkyTruth Cerulean's attribution algorithm, dataset access post-SciHub,
  marinecadastre AIS schema, slick-age feasibility, GFW AIS-gap methodology
- **`RESEARCH/` corpus written** — INDEX, SYNTHESIS, P001–P004, six topic notes,
  CITATION_GRAPH
- **`PLAN/` written** — INDEX, ARCHITECTURE, PREREQUISITES, INTERFACES, CONSTRAINTS,
  EVALUATION, PHASE-00 through PHASE-09
- Key decisions locked with the user (below)
- **PHASE-00 scaffold** — `pyproject.toml` (3.12, optional groups `api`/`drift`/`detect`/`dev`),
  `.venv` with core deps, `.gitignore`, `.env.example`, `backend/` package tree,
  `backend/config.py`, `backend/cli.py` (with a `doctor` command), `backend/db/{models,session}.py`,
  alembic baseline `0001_initial`, `tests/{conftest,test_smoke}.py`, `docker-compose.yml`,
  `docker/ingest.Dockerfile`, `scripts/SETUP_DATABASE.md`, `README.md`
- **Git initialised** on branch `main`; 74 files staged, **not yet committed** (awaiting the
  user's go-ahead). `data/`, `.venv/`, `.env` and weights confirmed excluded

## Not started

All pipeline code: `backend/ingest`, `detect`, `characterize`, `drift`, `attribute`,
`ml/`, `frontend/`. The package tree exists but the modules are empty; CLI commands raise
`NotImplementedError` naming their owning phase.

## Open decisions for the user (blocking PHASE-02 only)

1. ~~**Training compute.**~~ **RESOLVED 2026-08-28 — the user will upgrade the local GPU.**
   The card found during PHASE-00 was a **GeForce GT 710, 2 GB, compute capability 3.5,
   driver 475.14 (CUDA 11.4)** — below the sm_50 floor of prebuilt PyTorch 2.x wheels, and
   far short of the memory to train YOLO-seg at 1024 px (P004 used an RTX 4090).

   **Target hardware: RTX 4070 desktop or RTX 5070 Ti laptop, 12 GB VRAM.** Both clear the
   compute-capability floor with room to spare (Ada / Blackwell). **PHASE-02 proceeds as
   planned** — 1024 px, full L1–L5 × {CIoU, MPDIoU} ablation, LSK and MPDIoU intact.

   **One caveat to carry into PHASE-02:** P004's `batch=32` at 1024 px was measured on a
   24 GB RTX 4090 and will not fit in 12 GB. Use a **physical batch of 8–16 with gradient
   accumulation to an effective batch of 32** (`nbs=32` in Ultralytics), so the ablation
   stays numerically comparable to P004 Table 1. Record the physical batch actually used in
   `ml/ablation/results.md` — an unreported batch change would invalidate the comparison.

   PHASE-02 is blocked until the card arrives; PHASE-01, -04 and -05 are not. After the
   upgrade set `FORCE_CPU=0` in `.env` and re-run `oilspill doctor`, which checks compute
   capability and VRAM and warns if either is short.
2. **PostGIS install.** Route A (native PostgreSQL 16 + PostGIS bundle) or Route B (install
   Docker) — `scripts/SETUP_DATABASE.md`. Needed from PHASE-01.

## Exact next action

1. **Email CERTH/MKLab requesting the Krestenitis dataset** (user action — request-gated,
   long lead time, cannot be accelerated).
2. Install PostGIS via `scripts/SETUP_DATABASE.md`, then `alembic upgrade head`.
3. Begin **PHASE-01** (`PLAN/phases/PHASE-01.md`): CDSE fetch, SNAP chain, tiling, and the
   geocoding round-trip test.

**PHASE-04 and PHASE-05 are independent of PHASE-02/03** and can proceed in parallel — worth
starting while the GPU question is open, since neither needs one.

## Decisions made (locked with the user)

| Decision | Value | Rationale |
|---|---|---|
| Target | SIH demo prototype, ~4–8 weeks, demo-first | User choice |
| Compute | **Local GPU — pending hardware upgrade** | Existing GT 710 (sm_35, 2 GB) is unusable; user opted to upgrade rather than move training to the cloud. PHASE-02 plan unchanged |
| Python | **3.12** (plan said 3.11) | 3.11 absent; 3.14 too new for the geo/ML stack |
| Container runtime | **None** — native install | Docker not present on this machine |
| Regions | **Dual** — GoM (real AIS + published ground truth) + Indian waters (synthetic) | Free real AIS exists only for US waters, and P004's three cases give verifiable ground truth there |
| Bonus scope | **PHASE-10** — more Indian maritime zones, **gated behind PHASE-01–09** | User instruction 2026-08-28: only after the current scope works. Do not start early |
| Stack | FastAPI + PostGIS; React + MapLibre + deck.gl | Spatial queries need PostGIS; deck.gl needed for 50k AIS points + particle animation |
| Detector | YOLO-**seg** + LSK(**L5**) + MPDIoU + SAHI | `RESEARCH/SYNTHESIS.md` §3; L5 is the only P004 variant that reliably classifies OOSs |
| Drift engine | OpenDrift OpenOil, ensemble, negative `time_step` | P002 confirms the physics; P004 names OpenDrift |
| Scoring | Cerulean's parity/proximity/temporality/collation **+ `S_drift`** | `S_drift` is the contribution |

## Known issues and risks

| Risk | Note |
|---|---|
| **Binary → 2-class relabelling** | Zenodo masks are binary; our scheme needs `oos` + `slick_unknown`. **The largest hidden cost in the plan.** Annotation work, not code. Start as soon as Part I downloads |
| **LSK on a segmentation head is untested** | P004 ablated LSK on a *detection* head. Main technical risk of PHASE-02. A negative result is a legitimate finding |
| **Backward convergence sharpness unknown** | Diffusion is irreversible; the convergence minimum may be shallow. Main risk to the age deliverable (PHASE-04) |
| **Case 3 is genuinely hard** | Cerulean's parity and proximity both fail on it. If `S_drift` cannot carry it, revisit the formulation (integral vs max) — **do not tune weights to force a fixture to pass** |
| MKLab is request-gated | Cannot be a dependency; Zenodo covers us |
| CMEMS auth/quota at demo time | Cache all forcing to NetCDF early; `verify_offline.py` in PHASE-09 |
| SNAP on Windows | Containerise it. Do not attempt native install |

## Files that must not be modified carelessly

| Path | Why |
|---|---|
| `paperSource/**` | User-supplied source material. Read-only |
| `oil.txt` | User's own notes. Note: substantially derived from P001 — not an independent source |
| `RESEARCH/**` | The reasoning audit trail. Update when understanding changes; never delete findings, including negative ones |
| `PLAN/CONSTRAINTS.md` | C1–C11 are correctness requirements, not preferences. Changing one requires a recorded reason |

## Required reading for the next session

```
HANDOFF.md            (this file)
PLAN/INDEX.md
PLAN/phases/PHASE-00.md
RESEARCH/INDEX.md     (only if research context is needed)
```

Do **not** load all papers or all phases. Follow the indexes.

## Verification before claiming any phase complete

Each phase file has an explicit acceptance checklist. Run it. In particular:

- PHASE-01: **pixel→geo→pixel round-trip < 1 px** — everything downstream depends on it
- PHASE-02: look-alike FP count reported **separately** from mAP (C8)
- PHASE-04: backward/forward round-trip under zero diffusivity, before trusting any result
- PHASE-06: all three P004 cases, **plus the Case 3 `S_drift` term-ablation**
- PHASE-09: `verify_offline.py` with networking disabled

## Open questions carried forward

Full list in `RESEARCH/SYNTHESIS.md` §9. The two that will bite first:

1. Does LSK-at-L5 transfer from a detection head to a segmentation head? *(PHASE-02)*
2. `S_drift` as max over track points, or integral of the track through the field? The
   integral should favour a lingering vessel and therefore Case 3. *(PHASE-06 — implement
   both, let the fixture decide)*
