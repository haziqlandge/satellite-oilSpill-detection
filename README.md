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
the plan's target and look-alike false alarms remain high.

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

**Uploads need the model file, which is not in git.** The console runs the
trained segmenter in the browser from `frontDemo/public/models/L1-ciou-research.onnx`,
and `*.onnx` is gitignored like every other weight file. On a fresh clone, or
on the training machine, generate it once from `weights/L1-ciou-research.pt`:

```bash
.venv/Scripts/python.exe -m ml.export.onnx_export
```

It checks the export against PyTorch before writing it. Without it, an upload
says the segmenter could not be loaded rather than falling back to anything.

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

Baseline is **506 passed, 9 skipped**. A drop below that is a regression.

---

## Architecture

```
backend/
  ingest/     SAR download + SNAP preprocessing, AIS, dataset assembly, metocean cache
  detect/     YOLO-seg + LSK inference (SAHI over full scenes); CFAR bright targets
  drift/      OpenDrift OpenOil ensemble, origin probability field, convergence/age
  db/         SQLAlchemy models; integrity constraints enforced in the schema
  app/        the REST API — specced in PLAN/INTERFACES.md, not yet built
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

`src/sim/` currently generates its own data — the frontend is not yet wired to the backend.
The shapes already mirror `PLAN/INTERFACES.md`, so connecting them is a transport change
rather than a rewrite.

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

Case 3 is the discriminating test: Cerulean's parity and proximity terms both fail on it,
because the vessel was stationary and its track does not parallel the slick. See
[`PLAN/EVALUATION.md`](PLAN/EVALUATION.md).

Note that the locally available December scene is `20231205T000214`, which is **not** the
published Case 3 acquisition — see `ISSUES.md` X7.

---

## A note on the output

This system names specific vessels as suspected polluters. Every ranking is accompanied by
its full score decomposition and caveats, alternative hypotheses stay visible, dark vessels
are ranked but never named, and a drift field too diffuse to discriminate returns
**insufficient evidence** rather than a suspect. Those are hard requirements — see
`PLAN/CONSTRAINTS.md`.

Anything simulated says so. Current detections are research output and must never be
presented as operational accusations.
