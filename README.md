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
| **(a)** | Instance-segments slicks from Sentinel-1 VV SAR into two classes (`oos`, `slick_unknown`), computes geometry — area, length, width profile, orientation, fragmentation, head/tail — and estimates age as an interval |
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

**2026-09-17 independent audit:** Validation threshold .20 is frozen and L1's one-time test evaluation is complete: mask AP50 .363622, AP50–95 .149918; 8/11 named look-alike tiles raised alarms. Research weights export, manifest enforcement and native-resolution GeoTIFF inference are implemented. Training is complete; this remains a one-class research system with unresolved false alarms and two-class annotation requirements. Current evidence and corrections: [INDEPENDENT_AUDIT.md](eval/final/INDEPENDENT_AUDIT.md). The selection/release history below predates these results.

## Historical final model selection — 2026-09-17

All **1,080 planned epochs are complete** (60 reference + 720 screening + 300 final). **`L1-ciou` is selected** because it leads both comparable validation evaluations and the fresh 100-epoch final curves on mask AP, while also leading recall, Dice, boundary F1, small-object recall and source coverage. `L4-ciou` is the precision/box-quality reserve; `none-ciou` remains the control/fallback. Full evidence: [`eval/final/REVIEW.md`](eval/final/REVIEW.md).

The FP32-safe `L1-ciou` release reproduction completed **100/100 epochs**. Its independently reloaded checkpoint produced mask mAP50-95 **0.15568** on the frozen 482-image validation split, only **0.00054** below the live epoch-71 peak of **0.15622** and well inside the project's ~0.004 within-run tolerance. Release artifact: `runs/final_l1_fp32_release/L1-ciou/weights/best-fp32.pt`; SHA-256 `d4a74906e3a9b692c14f28305baf3cb20ba63da4c38bc30dbabd14c5c6d1fc6c`. The untouched test split remains sealed pending validation-threshold selection.

## Historical screening decision — 2026-09-15

All **12/12 screens are complete**. Overall budget: **780/1080 epochs complete; 300 remain** for three fresh 100-epoch runs. Selected: **none-ciou (control), L1-ciou (primary), L4-ciou (complementary)**; L5-ciou is reserve. Final training has **not** started.

Read [the review protocol](PLAN/SCREENING_REVIEW.md) and [the detailed results and selection](eval/screening/REVIEW.md). Eleven saved checkpoints were evaluated on validation across AP, negatives, mask overlap/boundaries, sizes/shapes, sources, confidence, uncertainty and cost. The none-ciou screen weights are missing; two train/validation duplicate pairs and an MPDIoU coordinate-scale mismatch were found. These are binary single-class candidates, not certified operational/two-class models. Final data and runner preflight steps are in the report.

Current machine: **RTX 4060 Ti 8 GB, 32 GB RAM**, with full resource use authorized. Prior laptop resource limits, stopped-at-43/60 status and timing estimates below are historical.

Current broader phase status: Phase 00 complete; Phase 01 substantially implemented with class relabeling pending; Phase 02 training/model selection complete with threshold, untouched-test and SAHI acceptance pending; Phase 04 engine implemented with forcing/validation gaps; Phase 05 implemented; Phases 03 and 06–09 remain unfinished. Earlier test counts describe earlier sessions; this review ran its targeted metric tests and lint.

`frontDemo/` is a parallel landing-page layout study feeding PHASE-07; it has its own
[README](frontDemo/README.md) and is **owned by a separate session — do not edit it from the
backend track**.

### Running things

```bash
run.bat
```

An interactive menu: watch progress, resume the ablation grid, benchmark the input pipeline,
run tests, check the environment, watch temperatures. It exports the thread caps before
Python starts, which is load-bearing — the OMP runtime reads them once, at first
`import torch`.

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

### Machine limits

This runs on a laptop the user also works on. The limits are **correctness requirements, not
preferences** — a run that breaches them is a defect regardless of its results. Full detail in
[`PLAN/CONSTRAINTS.md`](PLAN/CONSTRAINTS.md).

| Resource | Limit | Enforced by |
|---|---|---|
| CPU | 80% ceiling; current mask is 16/24 E-cores (67%) | `cap_cpu()`, in-process before workers spawn |
| RAM | **24 GB absolute**, machine-wide | `RAM_CEILING_GB`; `workers=2` |
| GPU | about 80%, training process only | 80% CUDA-memory fraction plus an ~80% in-process duty cycle |
| Temperature | pause at **90 C**, resume at **80 C** | GPU guard plus post-epoch CPU checks in Armoury Crate |

---

## Documentation

Read the indexes, not everything.

| Start here | For |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | Where the work is, what to do next |
| [`PLAN/INDEX.md`](PLAN/INDEX.md) | Architecture, interfaces, constraints, evaluation, ten phase files |
| [`RESEARCH/INDEX.md`](RESEARCH/INDEX.md) | Four papers read in full, six topic syntheses, citation graph |
| [`RESEARCH/SYNTHESIS.md`](RESEARCH/SYNTHESIS.md) | Every design decision and its justification |

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

---

## A note on the output

This system names specific vessels as suspected polluters. Every ranking is accompanied by
its full score decomposition and caveats, alternative hypotheses stay visible, dark vessels
are ranked but never named, and a drift field too diffuse to discriminate returns
**insufficient evidence** rather than a suspect. Those are hard requirements — see
`PLAN/CONSTRAINTS.md`.
