# OilSpill — SAR + AIS oil spill detection, hindcasting and vessel attribution

Detect oil slicks in Sentinel-1 SAR imagery, hindcast them to an origin point and time with
an ensemble drift model, and rank the vessels that could have released them — with the
reasoning exposed, not hidden.

Built for the NTRO / SIH problem statement *"Leveraging satellite imagery to determine oil
spills at sea along with AIS data correlations to identify vessel responsible for the spill."*

---

## Intended system capabilities

| Part | Capability |
|---|---|
| **(a)** | Instance-segments slicks from Sentinel-1 VV SAR, computes geometry — area, length, width profile, orientation, fragmentation, head/tail — and estimates age as an interval |
| **(b)** | Runs an **ensemble backward drift** (OpenDrift OpenOil, negative time step) to produce an **origin probability field `P(lat, lon, t)`**, plus a 72 h forward impact forecast |
| **(c)** | Gates historic AIS traffic on that field, scores surviving candidates on six explainable terms, collates vessels against infrastructure, and emits an **evidence card** per suspect |

### The contribution

No system in the reviewed literature conditions AIS attribution on a *physical* backward-drift
field. SkyTruth's Cerulean substitutes slick geometry as a proxy; the closest paper
(Zhao et al. 2025) does the AIS check by hand and names OpenDrift reverse-trajectory
simulation as future work. This project closes that loop — the `S_drift` scoring term.

See [`RESEARCH/SYNTHESIS.md`](RESEARCH/SYNTHESIS.md) §4.

---

## Status

Training is complete and a release checkpoint exists. **This is a one-class research
system**: it detects `slick`, not `oos`/`slick_unknown`, and the two-class scheme the plan
calls for is not yet achievable — the labels do not exist. Detection quality is well below
the plan's target. Look-alike false alarms were high (55 of 87 on a frozen Zenodo Part II
holdout); the release since 2026-09-25 is the retrain with Part II negatives, which alarms on
4 of 87 for a small cost in mAP ([`eval/part2/REPORT.md`](eval/part2/REPORT.md)). Attribution
runs in the backend (`backend/attribute/`, the console's scorer in Python), but no real run is
ranked. The three real runs are forced by ERA5 wind and CMEMS currents since 2026-09-25, and
still refuse: two never converge (no age, C1), the third's wind is below the Bragg gate, and
ranking a real field waits on smoothing it (`ISSUES.md` X16).

Current numbers, open gates and everything else unresolved: **[`ISSUES.md`](ISSUES.md)**.
What has been done and proved: [`PREVIOUS_WORK.md`](PREVIOUS_WORK.md). What comes next:
[`FUTURE_WORK.md`](FUTURE_WORK.md).

---

## Running things

### Backend and ML

```bash
run.bat
```

An interactive menu: watch progress, resume the ablation grid, benchmark the input pipeline,
run tests, check the environment, watch temperatures. It exports the thread caps before
Python starts, which is load-bearing — the OMP runtime reads them once, at first
`import torch`.

### Frontend

```bash
cd frontDemo && npm install
```

```bash
npm run dev --prefix frontDemo
```

Opens on port 5180. `http://127.0.0.1:5180/#/console` is the operations console.

**An upload runs in the browser.**

- **Its mask** comes from the trained segmenter,
  `frontDemo/public/models/L1-ciou-research.onnx`. It is committed on purpose
  (`.gitignore` re-includes it) so the Vercel site can run it. After a
  retrain, regenerate it from `weights/L1-ciou-research.pt`:

  ```bash
  .venv/Scripts/python.exe -m ml.export.onnx_export
  ```

  The export is checked against PyTorch before it is written.
- **Its drift** is forced by ERA5 wind and Copernicus Marine currents for its
  own place and time, fetched from Open-Meteo (`sim/metocean.ts`). Currents
  exist from 2022; ERA5 runs about five days behind real time. The drift
  engine itself is the console's, tagged SIM.
- **Its ships** are the recorded AIS when a hosted Gulf day covers it, and
  SIM elsewhere.
- **With the API below running**, the same file also goes through the real
  pipeline: OpenDrift and the AIS on disk.

### The live pipeline (API)

```bash
.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Also the `api` launch configuration. `PLAN/INTERFACES.md` §3 over the pipeline's
own files (the hosted database is not in its request path, `ISSUES.md` X1), plus
one write: `POST /api/v1/runs` takes a georeferenced sigma-0 dB GeoTIFF (its bytes
as the body, `?name=`) or `{"source": "<repo-relative path>"}` for a raster on
disk, answers 202 at once, and runs the whole chain in a separate process --
two-pass detection, seed, ERA5 wind and CMEMS currents (from the cache, or fetched;
wind-only when neither is possible, and it says so), characterisation, CFAR, OpenDrift
backward and forward, origin field and age, AIS, verdict, attribution (which refuses to
rank a real field, and reports only how many tracks the gate kept). Each stage streams over
`GET /api/v1/runs/{id}/events` (server-sent events) as it happens. Docs at
`http://127.0.0.1:8000/api/v1/docs`. The dev server proxies `/api` to it, so the
console sends every georeferenced upload there too, shows the stages live in the
Model Timing pane, and opens the finished run as a view. A full scene takes about
five minutes on the session machine's CPU, most of it OpenDrift.

### The demo, offline

The three-minute walkthrough is [`demo/WALKTHROUGH.md`](demo/WALKTHROUGH.md). Everything it
shows runs from local files. `DEMO_OFFLINE=1` forbids every fetch, and without basemap tiles
the map draws the land from the local GSHHG mask.

```bash
.venv/Scripts/python.exe -m scripts.export_snapshot
```

writes `demo/data/snapshot.zip` (everything the demo reads that git does not carry) and
`demo/snapshot.json` (every file, hashed). On the demo machine, unzip it at the repository
root, then check it:

```bash
.venv/Scripts/python.exe -m scripts.export_snapshot --check
```

The last check before presenting, with the network off:

```bash
.venv/Scripts/python.exe -m scripts.verify_offline --run
```

It refuses every non-loopback connection and DNS lookup, reads every API endpoint for every
scene, and runs the live pipeline on the December window from the cache. It must print
`PASS` and `network was OFF`.

`npm install --prefix frontDemo` does **not** work on npm 10+ — it resolves
`package.json` from the current directory, not the prefix, and fails at the
repository root. `npm run --prefix` is unaffected.

---

## Setup

Requires **Python 3.12** (not 3.13+ — the geospatial/ML stack does not support it yet).

```bash
py -3.12 -m venv .venv
```

```bash
.venv/Scripts/python.exe -m pip install -e ".[dev]"
```

```bash
cp .env.example .env
```

```bash
.venv/Scripts/python.exe -m backend.cli doctor
```

`doctor` reports what is present and what is missing; it is safe to run with nothing
configured.

The database is **Supabase** (hosted Postgres + PostGIS), not a local container. Create the
project `oilSpill-Detect` and wire it up per
[`scripts/SETUP_DATABASE.md`](scripts/SETUP_DATABASE.md), which also records the trade-offs
that choice carries. Setting up on a fresh machine:
[`scripts/SETUP_NEW_MACHINE.md`](scripts/SETUP_NEW_MACHINE.md).

Heavy dependencies are optional groups so they can fail independently:
`.[api]`, `.[drift]`, `.[detect]`. Install `torch` from the correct CUDA index **before**
`.[detect]`.

### Verify

```bash
.venv/Scripts/python.exe -m pytest
```

```bash
.venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m mypy ml backend scripts
```

Baseline is **654 passed, 8 skipped**. A drop below that is a regression.

---

## Architecture

```
backend/
  ingest/     SAR download + SNAP preprocessing, AIS, dataset assembly, metocean cache
  detect/     YOLO-seg + LSK inference (SAHI over full scenes); CFAR bright targets
  drift/      OpenDrift OpenOil ensemble, origin probability field, convergence/age
  characterize/  geometry, damping ratio, wind gate, Fay age prior, the oos verdict (PHASE-03)
  db/         SQLAlchemy models; integrity constraints enforced in the schema
  app/        the REST API (FastAPI): INTERFACES.md §3 over the artifacts, POST /runs + SSE
  pipeline/   the live chain behind POST /runs; two-pass detection's overview screen
ml/
  models/     LSK block, MPDIoU, the YOLO-seg variants
  datasets/   corpus assembly, the fixed dB window, split assignment
  train/      training entry point and checkpointing
  ablation/   the 12-cell screening grid
frontDemo/    SlickTrace — the React frontend
```

The frontend is one product with two surfaces: a **home page** (`#/`) that narrates
detection, drift, forecast, cause and suspects, and an **operations console**
(`#/console`) with a map, dockable panels and a shared timeline. It is React 19 + Vite 6 +
Tailwind v4 + MapLibre GL + anime.js v4.

The authored scenarios in `src/sim/` generate their own data, and say so. The three
real runs are static files the backend exported (`frontDemo/public/runs/`), and a run
the live pipeline makes is read from the API (`src/lib/api.ts`) with the same view.

---

## Documentation

Read the indexes, not everything.

| Start here | For |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Operating rules — read first if you are picking this up |
| [`ISSUES.md`](ISSUES.md) | What is broken or unproven right now |
| [`PREVIOUS_WORK.md`](PREVIOUS_WORK.md) | What was done, and what must not be re-derived |
| [`FUTURE_WORK.md`](FUTURE_WORK.md) | What to do next |
| [`DATA.md`](DATA.md) | Where the data and artifacts live |
| [`frontDemo/README.md`](frontDemo/README.md) | The frontend: run, layout, and the invariants to respect |
| [`PLAN/INDEX.md`](PLAN/INDEX.md) | Architecture, interfaces, constraints, evaluation, ten phase files |
| [`RESEARCH/INDEX.md`](RESEARCH/INDEX.md) | Four papers read in full, six topic syntheses, citation graph |
| [`RESEARCH/SYNTHESIS.md`](RESEARCH/SYNTHESIS.md) | Every design decision and its justification |

`PLAN/` is what *should* exist; the repository is what *does*. When they disagree, the
repository wins and `ISSUES.md` records the gap.

`PLAN/CONSTRAINTS.md` defines twelve scientific-integrity constraints (C1–C12). They are
correctness requirements, not preferences — several are enforced structurally in
`backend/db/models.py` (age cannot be stored as a scalar; there is no thickness column;
a score cannot be stored without its terms and weights; dark vessels cannot be named).

---

## Validation

The system is validated against three **published, peer-reviewed** attribution cases from
Zhao et al. 2025 (Port of South Louisiana, 2023) that coincide with **free real AIS** from
marinecadastre.gov:

| Case | Date (UTC) | Ground truth |
|---|---|---|
| 1 | 2023-04-09 00:02 | Platform leak — no vessel within 5 km |
| 2 | 2023-05-15 00:02 | `BOCHEM LONDON`, moving, ~19 km slick |
| 3 | 2023-12-05 23:57 | `BRANDON BORDELON`, **berthed for two days** |

Case 3 was expected to be the discriminating test: Cerulean's parity and proximity terms
both fail on it, because the vessel was stationary and its track does not parallel the slick.
See [`PLAN/EVALUATION.md`](PLAN/EVALUATION.md). On the authored scenarios all three rank their
truth first. Removing the drift field entirely costs Case 1 (the platform drops to 2nd) but
not the authored Case 3, whose slick head sits on the berth
([`eval/attribution/REPORT.md`](eval/attribution/REPORT.md), `ISSUES.md` Q7).

Note that the locally available December scene is `20231205T000214`, which is **not** the
published Case 3 acquisition — see `ISSUES.md` X7.

---

## Regions

The zones are in one registry, `frontDemo/src/sim/regions.json`, which the
console and the backend both read. For each zone it holds the AOI, the
bundled coastline, the AIS footprint, and what is and is not verified there.

- **Validated:** the Gulf of Mexico, on real Sentinel-1, real AIS and P004's
  three published cases.
- **Demonstrated:** the Gulf of Kutch, Mumbai High, Chennai / Ennore and
  Paradip, with authored scenarios and simulated AIS.

Every evidence card in a zone carries that zone's caveats: its installation
coverage, and whether the wind-gate bounds are validated for its wind climate.
None is validated yet.

> **Claim:** the pipeline operates over these zones.
> **Do not claim:** detection accuracy generalises to Indian waters.
>
> The Indian-waters scenarios test the pipeline's logic. They are not a test of
> the detector on real Indian SAR imagery, which is P002's highest-priority open
> problem. National coverage needs labelled Sentinel-1 scenes of confirmed
> Indian spills.

The drift engine was cross-checked against INCOIS's published Ennore 2017
assessment (`eval/RESULTS.md`, `scripts/ennore_crosscheck.py`). Direction and
beaching agree; the along-shore reach is about 3.4 times too long.

## A note on the output

This system names specific vessels as suspected polluters. Every ranking is accompanied by
its full score decomposition and caveats, alternative hypotheses stay visible, dark vessels
are ranked but never named, and a drift field too diffuse to discriminate returns
**insufficient evidence** rather than a suspect. Those are hard requirements — see
`PLAN/CONSTRAINTS.md`.

Anything simulated says so. Current detections are research output and must never be
presented as operational accusations.
