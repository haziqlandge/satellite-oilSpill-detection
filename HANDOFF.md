# HANDOFF

Continuation state. **Read this first, then `PLAN/INDEX.md`, then your current phase file.**

**Last updated:** 2026-08-29
**Machine:** RTX 4060 Ti desktop. Environment is **already built and verified** on this
machine - see "Start here" below. Do not rebuild it from scratch.

---

## If you are the new session: start here

You own the **backend and ML pipeline, PHASE-01 onward**. **Do not work on `frontDemo/`** -
it is a separate frontend layout study owned by the session on the other laptop, with its
own README and its own open issues. Touching it will collide.

**The environment is already set up and green.** Verify rather than rebuild:

```bash
.venv/Scripts/python.exe -m backend.cli doctor
.venv/Scripts/python.exe -m pytest -q
```

Expect `doctor` to report python 3.12.10, database ok with PostGIS 3.3, torch /
ultralytics / opendrift installed, `device cuda`, and **55 tests passing**.

`doctor` also warns **"under 8 GB - too little VRAM to train the PHASE-02 model"**. That
is correct and expected: this is the **8 GB** 4060 Ti, measured at 7.996 GB against
`MIN_TRAIN_VRAM_GB = 8.0` in `backend/device.py`. PHASE-01 needs no GPU, but PHASE-02
needs a decision - the 12 GB 5070 Ti laptop, a lowered floor with a smaller batch, or
rented compute. Earlier revisions of this file claimed 16 GB; they were wrong.

### The one thing blocking progress: disk

**The Zenodo training corpus is 91 GB of archives and the machine had 59.9 GB free**
(measured 2026-08-29). It does not fit, and 7z extraction roughly doubles the requirement.
The user is arranging more space. **Do not start a Zenodo download until you have
confirmed free space**; check first:

| Record | Size | Role |
|---|---|---|
| `8346860` Part I | **37.92 GB** | primary training positives |
| `8253899` Part II | **42.77 GB** | look-alike negative pool |
| `13761290` Part III | **9.18 GB** | held-out test |
| `15298010` Refined SOS | **1.10 GB** | corrected masks, prefer where overlapping |

The **mask archives are tiny** (10-30 MB each) - the images are the entire bulk. PHASE-01
targets only **~10% negatives per split**, so pulling all 42.77 GB of Part II to use a
tenth of it is poor value, and 7z supports selective extraction. `backend/ingest/datasets/
zenodo.py` is written, tested and ready; it verifies every file against Zenodo's published
MD5, because a truncated multi-GB archive does not announce itself.

Reclaimable now, if needed: the `_COG` products under `data/raw/sar/safe/` are unusable
(see below) and the classic `.zip` archives are redundant once extracted - roughly 10 GB.

### Then

1. **Finish PHASE-01** ([`PLAN/phases/PHASE-01.md`](PLAN/phases/PHASE-01.md)) - see the
   breakdown under "Current position".
2. **Email CERTH/MKLab for the Krestenitis dataset** if not already sent (check with the
   user). Request-gated, long lead time. A bonus, not a dependency.

**PHASE-04 and PHASE-05 do not depend on PHASE-02/03** and need no GPU. If PHASE-01 stalls
on disk or a dataset, switch to PHASE-05 rather than idling.

---

## Current position

| | |
|---|---|
| **PHASE-00** | **Complete.** Committed as `a9eb695`, pushed |
| **PHASE-01** | **In progress, uncommitted.** Ingest modules, SNAP graph, fixture data and 37 tests exist locally. See the breakdown below |
| **PHASE-02 onward** | Not started |
| **frontDemo/** | Separate track, owned by the session on the other laptop. Committed in `6c1bc25`. Do not touch |
| **Repository** | https://github.com/haziqlandge/satellite-oilSpill-detection (public, `main`) |

### PHASE-01 breakdown as of 2026-08-29

| Done | Still to do |
|---|---|
| `sar/fetch.py`, `geo.py`, `tiling.py`, `cdse.py`, `preprocess.py` | Finish the SNAP chain on Cases 2 and 3 |
| `ais/clean.py`, `loader.py`, `trajectory.py` | `datasets/relabel.py` (binary -> 2-class) |
| `datasets/zenodo.py` (+ checksum verification) | Zenodo downloads - **blocked on disk** |
| `graphs/s1_grd_preprocess.xml` - **debugged, now works** | SAR Fixed Infrastructure Dataset |
| 3 classic fixture `.SAFE` products + 10 AIS days | Relabelling pass; coastline overlay check |
| **55 tests passing**, ruff + mypy clean | Geocoding round-trip < 1 px on a real scene |

**SNAP chain status: no scene is preprocessed yet.** Case 1 ran correctly with real data
(2.5 GB written, growing steadily) but **hit the 1-hour timeout** and was killed. The
truncated output was deleted; `data/processed/sar/` is empty. Nothing is wrong with the
chain - it is simply slow.

**Measured:** a full IW GRDH scene (25896 x 16734) through Refined Lee and
Terrain-Correction at 10 m had written 2.5 GB and was **still running at 60 minutes** on
this machine. `DEFAULT_TIMEOUT_S` is now **4 hours**. Budget hours per scene, three
scenes, and run it when the machine is free:

```bash
.venv/Scripts/python.exe scripts/preprocess_fixtures.py --max-heap-gb 8
```

Re-running is safe: completed outputs are skipped, `_COG` products are skipped with a
message, and a run that times out or fails now **deletes its partial output** so a
truncated raster cannot be mistaken for a finished one.

**Disk:** each output looked set to exceed 2.5 GB, so budget ~10 GB for three scenes on
top of whatever the Zenodo corpus needs.

**Do not trust "SNAP exited 0" as success.** It happily produces a correctly sized,
correctly georeferenced, **entirely zero** raster (see the `nodataValueAtSea` trap below).
`run_graph` now verifies both the CRS *and* that the output actually contains non-zero
pixels (`check_has_data`), so this specific failure can no longer pass silently.

**Four traps already paid for. Do not re-derive these.** Each cost real time on
2026-08-29; all four are now guarded by tests in `tests/test_preprocess.py`.

1. **`mapProjection` must be `WGS84(DD)`, not `EPSG:4326`.** SNAP wants its own CRS
   name; an `EPSG:nnnn` string makes it compute a zero-size target and die at graph
   init with `ArithmeticException: / by zero`. It looks exactly like a broken install
   or a bad product and is neither - SNAP 12 and 14 fail identically, on both `.SAFE`
   and DIMAP input, with a verified-healthy product. **SNAP 12 is installed at
   `C:\esa-snap-12` but is NOT needed**; SNAP 14 at `C:\Program Files\esa-snap` works.
   Uninstalling 12 needs UAC and was left for the user.
2. **`nodataValueAtSea` must be `false` in Terrain-Correction.** It defaults to true and
   SRTM has no data over water, so on a marine scene it nulls nearly every pixel: the
   output is correctly sized, correctly georeferenced and **entirely zero**, and SNAP
   still exits 0. For an oil-spill pipeline the sea is the signal.
3. **`Land-Sea-Mask` must not carry a `geometry` parameter when `useSRTM=true`.** SNAP
   parses the value as a band-arithmetic expression; the placeholder `0,0` that was in
   the graph failed with `Undefined symbol '0,0'` in `CreateLandMaskOp`.
4. **The measurement-band-only trap.** The first pass downloaded only `measurement/`
   assets, which **cannot be calibrated** - the sigma0 LUTs live in
   `annotation/calibration/`. Use `scripts/download_cdse_fixture_safe.py`, not
   `download_cdse_fixture_vv.py`.

Two hypotheses were pursued and proved **wrong**; they are recorded so nobody retries
them: "COG packaging breaks SNAP" (classic products fail identically - though classic is
still preferred, because SNAP flags the COG calibration LUT as unreliable) and "SNAP 14
regression, install SNAP 12" (12 fails the same way).

Full detail, including everything ruled out along the way, is in
`PLAN/phases/PHASE-01.md` under "Confirmed on this hardware".

### Open question for the next session: sigma0 in dB, and filter order

Measured on 2026-08-29: `Calibration` with `outputImageScaleInDb=true` emitted **linear**
sigma0, not dB - values 0-4.87, mean 0.004, where dB over water would sit around -20.
The Zenodo training corpus is sigma0 **in dB**, so this has to be reconciled before
PHASE-02 or the model trains on a different quantity than it will infer on.

Related, and worth deciding together: the chain in `PLAN/phases/PHASE-01.md` (from P004
§2.3) is calibrate-to-dB *then* Refined Lee. **Speckle is multiplicative in the linear
domain, which is what Refined Lee assumes**, so filtering in dB is statistically wrong.
Standard SNAP practice is calibrate -> speckle filter -> terrain correct -> `LinearToFromdB`
last. Changing the documented order needs a recorded reason (`PLAN/CONSTRAINTS.md`), so it
was deliberately **not** changed unilaterally. Put the evidence to the user and decide.

## Changes made on 2026-08-29

Everything below is **uncommitted**. The only commit in the repository is still
PHASE-00's `a9eb695`.

### New files

| Path | What it is |
|---|---|
| `backend/ingest/sar/cdse.py` | CDSE OData client: token refresh + resume. **CDSE answers ranged requests with 200, not 206**, so resume restarts rather than corrupting the file |
| `backend/ingest/sar/preprocess.py` | SNAP `gpt` invoker: locates `gpt`, sets the JVM heap, summarises Java stack traces down to the real cause, verifies the output CRS **and that it contains data**, and discards partial output on failure |
| `backend/ingest/datasets/zenodo.py` | Zenodo record listing + download with **MD5 verification** |
| `scripts/download_cdse_fixture_safe.py` | Downloads the three fixture scenes as complete `.SAFE` products |
| `scripts/preprocess_fixtures.py` | Batch-runs the SNAP chain; skips `_COG` products with an explanation |
| `tests/test_cdse.py`, `tests/test_preprocess.py`, `tests/test_zenodo.py` | 31 new tests (24 -> 55) |

### Modified

- `graphs/s1_grd_preprocess.xml` - three real bugs fixed (traps 1-3 above), each with a
  comment explaining why, each guarded by a test.
- `.env` - `DATABASE_URL` repointed at the **IPv4 session pooler**. The direct host
  `db.<ref>.supabase.co` is **IPv6-only** and this machine has no IPv6 route, which
  presents as `failed to resolve host ... getaddrinfo failed` and looks like a typo.
- `scripts/SETUP_NEW_MACHINE.md` - SNAP install, the Supabase IPv6/pooler trap, the
  `PROJ_LIB` fix, disk budget.
- `PLAN/CONSTRAINTS.md` - SNAP-in-a-container constraint **amended** to
  "not through `esa_snappy` on Windows", with the reason recorded. `gpt` is a plain Java
  CLI, so **Docker is no longer needed for anything** - Supabase replaced PostGIS too.
- `PLAN/phases/PHASE-01.md` - "Confirmed on this hardware" section.
- `scripts/download_cdse_fixture_vv.py` - one lint fix. **Superseded**; it fetches only
  measurement bands, which cannot be calibrated.

### Machine changes outside the repo

- **ESA SNAP 14** installed at `C:\Program Files\esa-snap` (`winget install
  EuropeanSpaceAgency.SNAP`). SNAP 12 also installed at `C:\esa-snap-12` while chasing a
  wrong hypothesis - **not needed**, safe to uninstall.
- **Machine-level `PROJ_LIB` and `GDAL_DATA` removed.** A PostgreSQL/PostGIS install had
  set them to its own outdated PROJ database, which shadows rasterio's and breaks every
  Python geospatial stack on the machine. Symptom: `CRSError ... DATABASE.LAYOUT.VERSION.
  MINOR = 2`, or `crs.to_epsg()` returning `None` for a valid EPSG:4326 product. **A shell
  opened before the fix keeps the stale value** - if you see this, open a new one. Old
  values are recorded in `scripts/SETUP_NEW_MACHINE.md`.
- PostgreSQL 16 + PostGIS were installed early in the session under the superseded
  local-Postgres plan. **The project uses Supabase**; the local instance is unused and
  its only lasting effect was the `PROJ_LIB` pollution above.
- Python 3.12.10 installed via `pymanager`; `.venv` rebuilt against it with torch
  **cu128** (verified with a real CUDA allocation, not just `is_available()`).

### Not done, deliberately

- **No Zenodo downloads** - blocked on disk, see the top of this file.
- **The dB / filter-order question** - raised, not decided. See above.
- **No scene preprocessed** - the chain works; it needs an uninterrupted multi-hour run.

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
| GPU | GeForce GT 710, 2 GB, sm_35 - **unusable** | **RTX 4060 Ti — the 8 GB variant**, sm_89 (see the warning below), or **RTX 5070 Ti laptop 12 GB** |
| Python | 3.12 (3.11 absent, 3.14 too new for the stack) | Install 3.12, same reason |
| Database | Local Postgres planned | **Supabase**, hosted, reached via the **IPv4 session pooler** |
| Docker | Required for PostGIS and SNAP | **Not required at all.** Supabase replaced PostGIS; SNAP runs natively via `gpt` |
| `uv` | Not installed, plain `pip` + `venv` | Either |

> **The desktop card is 8 GB, not 16 GB.** `nvidia-smi` reports 8188 MiB and
> `doctor` resolves it to 7.996 GB, which falls *just under* `MIN_TRAIN_VRAM_GB
> = 8.0` in `backend/device.py`. So `doctor` currently reports
> "too little VRAM to train the PHASE-02 model" on this machine. PHASE-01 needs
> no GPU, so this is not blocking yet, but **PHASE-02 needs a decision**: use the
> 5070 Ti laptop, lower the floor and accept a smaller batch, or rent a GPU.
> Do not assume the 16 GB figure that earlier revisions of this file asserted.

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

**SlickTrace** (Vite + React 19 + Tailwind v4 + anime.js v4): one product with two
surfaces -- a home page that explains what is happening in the ocean, and an operations
console with a dockable panel workspace. It began as a five- then four-direction layout
study; those directions were recombined into this on 2026-09-01. It is **design
exploration for PHASE-07**, not PHASE-07 itself. State, running instructions and the
traps worth not re-entering are in [`frontDemo/README.md`](frontDemo/README.md).

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
