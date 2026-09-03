# OilSpill — SAR + AIS oil spill detection, hindcasting and vessel attribution

Detect oil slicks in Sentinel-1 SAR imagery, hindcast them to an origin point and time with
an ensemble drift model, and rank the vessels that could have released them — with the
reasoning exposed, not hidden.

Built for the NTRO / SIH problem statement *"Leveraging satellite imagery to determine oil
spills at sea along with AIS data correlations to identify vessel responsible for the spill."*

---

## What it does

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

**PHASE-00 complete** — environment, package scaffold, database schema, research corpus.
No pipeline code yet. Current position and the exact next action: [`HANDOFF.md`](HANDOFF.md).

`frontDemo/` is **SlickTrace**, the demonstration interface feeding PHASE-07 -- a home page
and an operations console over the same simulation. It has its own
[README](frontDemo/README.md) and is not part of the pipeline.

```
PHASE-00  scaffold + research corpus          done
PHASE-01  data acquisition + SAR preprocess   next
PHASE-02  detection model (YOLO-seg + LSK)
PHASE-03  characterisation + wind gate
PHASE-04  met-ocean + drift engine            } independent of 02/03
PHASE-05  AIS pipeline + synthetic generator  } can run in parallel
PHASE-06  attribution engine
PHASE-07  API + visual interface
PHASE-08  evaluation + validation
PHASE-09  demo packaging
```

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
.venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m mypy backend
```

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
