# HANDOFF

Continuation state. **Read this first, then `PLAN/INDEX.md`, then your current phase file.**

**Last updated:** 2026-08-28
**Machine transfer:** this tree was zipped on the dev laptop and moved to the training
machine (RTX 4060 Ti, 16 GB VRAM). See "If you are the new session" immediately below.

---

## If you are the new session on the 4060 Ti: start here

You own the **backend and ML pipeline, PHASE-01 onward**. Another session on the original
laptop owns `frontDemo/` in parallel.

**Do not work on `frontDemo/`.** It is a separate frontend layout study with its own
session, its own README, and its own open issues. Touching it will collide.

Your first four actions, in order:

1. **Rebuild the environment.** The zip does not carry a working venv or `node_modules`.
   Follow [`scripts/SETUP_NEW_MACHINE.md`](scripts/SETUP_NEW_MACHINE.md) end to end. It
   finishes with `pytest` green and `oilspill doctor` reporting a usable CUDA device.
   **Install PyTorch from the CUDA index before `ultralytics`**, or you get a CPU build.
2. **Connect the database.** The project uses **Supabase**, not Docker or a local
   Postgres (user decision, 2026-08-28). The project **`oilSpill-Detect`**
   (ref `hbctpozvofhxlioywcjw`, `ap-south-1`, PG 17.6, PostGIS 3.3) **already exists** -
   do not create another. You need to **set the database password** in the dashboard
   (Project Settings > Database > Reset database password), put the **direct** connection
   URI in `.env`, then run `alembic upgrade head`.
   **Then enable RLS on every table before loading data** - Supabase exposes the `public`
   schema over its REST API, which a local Postgres never did.
   Full steps and accepted trade-offs: [`scripts/SETUP_DATABASE.md`](scripts/SETUP_DATABASE.md).
3. **Email CERTH/MKLab for the Krestenitis dataset** if it has not already been sent
   (check with the user). Request-gated, long lead time, cannot be accelerated. It is a
   bonus, not a dependency, but the clock starts when you ask.
4. **Begin PHASE-01** ([`PLAN/phases/PHASE-01.md`](PLAN/phases/PHASE-01.md)).

**PHASE-04 and PHASE-05 do not depend on PHASE-02/03** and need no GPU. If PHASE-01 stalls
on a dataset download or a CDSE account, switch to PHASE-05 rather than idling.

---

## Current position

| | |
|---|---|
| **PHASE-00** | **Complete.** Committed as `a9eb695`, pushed |
| **PHASE-01 onward** | Not started. This is the work to do |
| **frontDemo/** | Separate track, in progress on the other machine, uncommitted |
| **Repository** | https://github.com/haziqlandge/satellite-oilSpill-detection (public, `main`) |

## What PHASE-00 delivered

- **`RESEARCH/`** corpus: INDEX, SYNTHESIS, one note per paper (P001-P004), six topic
  syntheses, citation graph. `RESEARCH/SYNTHESIS.md` carries every design decision and its
  justification, and is the document to read alongside `PLAN/`
- **`PLAN/`**: architecture, interfaces, prerequisites, constraints, evaluation, and eleven
  phase files (00-09 core, 10 gated bonus)
- **Scaffold**: Python 3.12 package, typer CLI with a `doctor` command, PostGIS schema and
  alembic baseline, smoke tests, native-Postgres setup notes
- **Constraints enforced structurally** in `backend/db/models.py` rather than by
  convention: slick age cannot be stored as a bare scalar, no absolute-thickness column
  exists, a suspect score cannot be written without its terms and weights, and dark vessels
  cannot be named. `tests/test_smoke.py` guards each one

Verified at the time of the commit: `pytest` 11 passed / 1 skipped, `ruff` clean,
`mypy` clean on 18 source files.

## Environment: what changed with the move

| | Dev laptop (was) | Training machine (now) |
|---|---|---|
| GPU | GeForce GT 710, 2 GB, sm_35 - **unusable** | **RTX 4060 Ti 16 GB**, or **RTX 5070 Ti laptop 12 GB**. Either works; the code adapts |
| Python | 3.12 (3.11 absent, 3.14 too new for the stack) | Install 3.12, same reason |
| Database | Local Postgres planned | **Supabase**, hosted. Docker is now only for SNAP |
| `uv` | Not installed, plain `pip` + `venv` | Either |

The GT 710 notes scattered through the docs are historical. The floor is **sm_50 or later,
8 GB+**, and it is enforced in code (`backend/device.py`), not by configuration. `FORCE_CPU`
is now a debug override defaulting to 0, not something to set per machine.

### PHASE-02 batch sizing - read before training

Zhao et al. trained at `imgsz=1024, batch=32` on a **24 GB RTX 4090**. Neither of this
project's machines has that, so the batch is **derived from detected VRAM** rather than
fixed: see `backend/device.py` and the table in `PLAN/phases/PHASE-02.md`. Nothing needs
editing when you switch between the 4060 Ti (16 GB) and the 5070 Ti laptop (12 GB) -
`python -m backend.cli doctor` reports the resolved device and the batch it would pick.

Effective batch is held at 32 via `nbs=32` gradient accumulation on every machine, which is
what keeps the ablation comparable to their Table 1. **Record the physical batch used**, and
say so if a grid was split across both machines.

If you move to the 5070 Ti: RTX 50-series is sm_120 and older CUDA wheels may lack kernels
for it. Install a CUDA 12.8+ PyTorch build and verify with a real allocation before starting
a long run.

**Wall-clock warning.** PHASE-02 specifies 12 ablation runs at 100 epochs. On either card
that is likely days, not hours. Suggested approach, to be confirmed with the user: run the
full grid at reduced epochs (around 60) to rank the variants, then full-train only the top
two plus the baseline. Record that you did this, because it changes how the numbers compare
to the paper.

## The Supabase switch: what it changed

Decided 2026-08-28 after the trade-offs were put to the user, who chose it anyway. Three
consequences you inherit:

1. **The demo is no longer offline by default.** PHASE-09 originally guaranteed the whole
   demo ran with networking disabled, because network dependence is the usual way a live
   demo dies. That guarantee is gone. **C12** replaces it: export the result set to a local
   snapshot and add a `DEMO_OFFLINE=1` read path. This is now deliberate work, not a
   property of the architecture.
2. **AIS must be clipped at ingest.** Free tier is 500 MB, Pro is 8 GB, and marinecadastre
   national files run to millions of rows per day. Clip to the AOI bounding box and the
   acquisition window *before* insert, and keep the raw CSVs on local disk under
   `data/raw/`. `ais_points` is the table that will blow the ceiling first.
3. **Migrations need the direct connection.** Supabase's transaction pooler (port 6543)
   has no prepared statements; alembic and psycopg3 both need them. Use port 5432.
4. **Our tables are internet-reachable by default.** PostgREST serves the `public` schema
   over HTTPS. Enable RLS on every table, or use a non-exposed schema, **before** any real
   AIS lands in it.

Also note `DB_CONNECT_TIMEOUT` now defaults to **15 s**, not 3 s. The old value was tuned
for a local socket and fails spuriously against a hosted instance, particularly a free-tier
project waking from pause. A free project pauses after about a week idle - if `doctor`
times out after a quiet spell, check the dashboard before debugging anything else.

## Open questions carried forward

Full list in `RESEARCH/SYNTHESIS.md` section 9. The two that will bite first:

1. **Does LSK-at-L5 transfer from a detection head to a segmentation head?** Zhao et al.
   only ablated detection. This is the main technical risk of PHASE-02. **A negative result
   is a legitimate finding** and must be reported, not engineered around.
2. **`S_drift` as max over track points, or integral of the track through the field?** The
   integral should favour a vessel that lingered, and therefore the P004 Case 3 fixture.
   Implement both and let the fixture decide. (PHASE-06)

## Known risks

| Risk | Note |
|---|---|
| **Binary to 2-class relabelling** | Zenodo masks are binary; the scheme needs `oos` + `slick_unknown`. **Largest hidden cost in the plan.** Annotation work, not code. Start it as soon as Part I downloads, in parallel with everything else |
| Ablation wall-clock on a 4060 Ti | See above. Agree a reduced-epoch screening pass with the user before committing days of compute |
| Backward-drift convergence sharpness | Diffusion is irreversible; the convergence minimum may be shallow. Main risk to the age deliverable (PHASE-04) |
| **P004 Case 3 is genuinely hard** | Cerulean's parity and proximity terms both fail on it. If `S_drift` cannot carry it, revisit the formulation, **do not tune weights to force a fixture to pass** |
| MKLab is request-gated | Cannot be a dependency; Zenodo Parts I-III + Refined SOS cover it |
| CMEMS auth at demo time | Cache all forcing to NetCDF early; `verify_offline.py` in PHASE-09 |
| **Supabase storage ceiling** | 500 MB free / 8 GB Pro against millions of AIS rows. Clip at ingest, watch `ais_points` in the dashboard |
| **Demo now needs network** | C12 snapshot fallback must actually be built and tested with the network off, not mocked |

## Decisions locked with the user

| Decision | Value |
|---|---|
| Target | SIH demo prototype, demo-first |
| Regions | **Dual** - Gulf of Mexico (real AIS + published ground truth) + Indian waters (synthetic) |
| Detector | YOLO-**seg** + LSK(**L5**) + MPDIoU + SAHI |
| Drift engine | OpenDrift OpenOil, ensemble, negative `time_step` |
| Scoring | Cerulean's parity/proximity/temporality/collation **plus `S_drift`** |
| Backend stack | FastAPI + PostGIS |
| Frontend stack | React + MapLibre/deck.gl (PHASE-07) |
| Bonus scope | **PHASE-10**, wider Indian coverage, **gated behind PHASE-01-09**. Do not start early |

## Validation fixtures

Zhao et al. 2025's three Port of South Louisiana cases: published, peer-reviewed ground
truth coinciding with **free real AIS** from marinecadastre. This is why the dual-region
choice exists.

| Case | Date (UTC) | Truth | Role |
|---|---|---|---|
| 1 | 2023-04-09 00:02 | Platform leak, no vessel within 5 km | Infrastructure must outrank vessels |
| 2 | 2023-05-15 00:02 | Moving tanker, ~19 km slick | Headline case |
| 3 | 2023-12-05 23:57 | Vessel **berthed since 3 Dec**, track does not match slick | **The adversarial case** |

Case 3 is the discriminating test. Solving it demonstrates something neither the reviewed
literature nor SkyTruth's Cerulean does.

## Files that must not be modified carelessly

| Path | Why |
|---|---|
| `paperSource/**` | User-supplied source material. Read-only |
| `oil.txt` | User's own notes. Derived from P001, so not an independent source |
| `RESEARCH/**` | The reasoning audit trail. Update when understanding changes; never delete findings, including negative ones |
| `PLAN/CONSTRAINTS.md` | C1-C11 are correctness requirements, not preferences. Changing one needs a recorded reason |
| `frontDemo/**` | **Owned by the other session.** Do not touch |

## Verification before claiming any phase complete

Each phase file has an acceptance checklist. Run it. The ones most easily skipped:

- **PHASE-01**: pixel to geo to pixel round-trip **< 1 px**. Everything downstream depends on it
- **PHASE-02**: look-alike false-positive count reported **separately** from mAP (C8)
- **PHASE-04**: backward/forward round-trip under **zero diffusivity**, before trusting any result
- **PHASE-06**: all three P004 cases, **plus the Case 3 `S_drift` term-ablation**
- **PHASE-09**: `verify_offline.py` with networking disabled

## Required reading for a new session

```
HANDOFF.md              (this file)
scripts/SETUP_NEW_MACHINE.md
PLAN/INDEX.md
PLAN/phases/PHASE-01.md
RESEARCH/INDEX.md       (only when research context is needed)
```

Do not load all papers or all phases. Follow the indexes.

---

## Parallel track: `frontDemo/`

Owned by the session on the original laptop. Summarised here only so you know what it is
and leave it alone.

A five-direction landing-page layout study (Vite + React + Tailwind v4 + anime.js v4),
switchable from a sticky right-edge rail. It is **design exploration for PHASE-07**, not
PHASE-07 itself. State, running instructions and open bugs are in
[`frontDemo/README.md`](frontDemo/README.md).

It is uncommitted as of this handoff. Do not commit it from the training machine; the other
session will.

---

## Producing the transfer zip

Exclude the three directories that are rebuilt rather than carried:

```
.venv/  frontDemo/node_modules/  frontDemo/dist/
```

Keep `.claude/` (launch config the next session needs) and `.git/` if present. **Never
include `.env`** - it now holds a live Supabase password. `.env.example` is what travels.

Exact commands: [`scripts/SETUP_NEW_MACHINE.md`](scripts/SETUP_NEW_MACHINE.md), final
section.
