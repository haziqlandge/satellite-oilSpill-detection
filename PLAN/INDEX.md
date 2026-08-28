# PLAN — Index

Engineering design for the SAR + AIS oil spill detection, hindcasting and vessel attribution
system. Research backing lives in `RESEARCH/`; **`RESEARCH/SYNTHESIS.md` is the document to
read alongside this one.**

## The problem

NTRO / SIH, Disaster Management, Software. Marine oil spills frequently go un-attributed.
Build an automated pipeline that:

- **(a)** detects and characterises oil slicks from satellite imagery — geometric
  properties, and age where feasible
- **(b)** uses oceanographic and meteorological data to hindcast the slick to an origin
  point and time, and forecast its forward drift
- **(c)** reconstructs vessel traffic in that origin window from historic AIS, filters
  irrelevant traffic, and ranks suspect vessels on proximity, trajectory and behavioural
  anomaly

Plus a visual interface.

## The approach in one paragraph

Instance-segment slicks from Sentinel-1 SAR into two classes (`oos`, `slick_unknown`) using
YOLO-seg + LSK attention + MPDIoU + SAHI; characterise geometry, head/tail and damping;
run an **ensemble backward drift** in OpenDrift OpenOil to produce an **origin probability
field `P(lat, lon, t)`**; gate historic AIS traffic on that field; score surviving candidates
on six explainable terms and collate vessels against infrastructure; present everything —
including the reasoning — in a map interface.

## The contribution

| System | Detect | Contour | Backward drift | Auto AIS attribution | Explainable |
|---|---|---|---|---|---|
| P004 (Zhao 2025) | 2-class | boxes | **no** — stated future work | **no** — manual | no |
| Cerulean (SkyTruth) | binary | yes | **no** — geometry as proxy | yes | partial |
| P003 | binary | yes | **no** | unspecified "correlation" | no |
| **This project** | 2-class | **instance seg** | **ensemble origin field** | **drift-conditioned** | **evidence cards** |

No system in the reviewed literature conditions AIS attribution on a physical backward-drift
field. **P004 §3.8 is effectively our specification** — it names OpenDrift reverse
trajectories, instance segmentation and temporal-state classification as the things it did
not do.

## Locked decisions

| Decision | Value |
|---|---|
| Target | **SIH demo prototype**, ~4–8 weeks, demo-first |
| Compute | Local NVIDIA GPU for training |
| Regions | **Dual** — Gulf of Mexico (real AIS, published ground truth) + Indian waters (synthetic AIS demo) |
| Stack | FastAPI + PostGIS backend; React + MapLibre + deck.gl frontend |

## Documents

| File | Contents |
|---|---|
| **ARCHITECTURE.md** | System diagram, data flow, components, technology choices, deployment, explicit non-goals |
| **PREREQUISITES.md** | Software, packages, accounts, datasets (required vs optional), hard-won install notes |
| **INTERFACES.md** | Pipeline stage signatures, core data schemas, REST API, external contracts, AIS schema, weights manifest |
| **CONSTRAINTS.md** | 11 scientific-integrity constraints (C1–C11), data/technical constraints, performance targets, scope boundaries, ethical constraints |
| **EVALUATION.md** | Metrics and targets per stage, the three ground-truth fixtures, what we will not claim |

## Phases

Dependency-ordered. **PHASE-04 and PHASE-05 are independent of PHASE-02/03 and can be built
in parallel.**

| Phase | Title | Depends on | Key output |
|---|---|---|---|
| [00](phases/PHASE-00.md) | Scaffold, environment, research corpus | — | PostGIS, package, RESEARCH/ + PLAN/ (**done**) |
| [01](phases/PHASE-01.md) | Data acquisition and SAR pre-processing | 00 | Geocoded σ0 tiles; datasets; relabelled classes |
| [02](phases/PHASE-02.md) | Detection model — the research contribution | 01 | YOLO-seg + LSK(L5) + MPDIoU weights; ablation table |
| [03](phases/PHASE-03.md) | Characterisation, geometry, wind gate | 02 (+04 readers) | Geometry, head/tail, damping, wind gate |
| [04](phases/PHASE-04.md) | Met-ocean forcing and drift engine | 00 | **`origin_field P(lat,lon,t)`**, forecast, age |
| [05](phases/PHASE-05.md) | AIS pipeline and synthetic generator | 00 | AIS tracks in PostGIS; 5 synthetic scenarios |
| [06](phases/PHASE-06.md) | Attribution engine | 02,04,05 | Ranked suspects + evidence cards |
| [07](phases/PHASE-07.md) | API and visual interface | 06 | FastAPI + deck.gl app |
| [08](phases/PHASE-08.md) | Evaluation and validation | 02–06 | `eval/RESULTS.md`, `eval/COMPARISON.md` |
| [09](phases/PHASE-09.md) | Demo packaging | 07,08 | Offline one-command demo + walkthrough |
| [10](phases/PHASE-10.md) | **Bonus** — national coverage (Indian coastline) | **01–09 all complete** | Additional maritime zones. **Gated: do not start until the core scope works end-to-end** |

## The validation fixtures

P004's three Port of South Louisiana cases are **published, peer-reviewed ground truth
coinciding with free real AIS** — the reason for the dual-region choice.

| Case | Date (UTC) | Truth | Role |
|---|---|---|---|
| 1 | 00:02, 2023-04-09 | Platform leak; no vessel within 5 km | Infrastructure must outrank vessels |
| 2 | 00:02, 2023-05-15 | **BOCHEM LONDON**, moving, ~19 km slick | Headline case |
| 3 | 23:57:19, 2023-12-05 | **BRANDON BORDELON**, berthed since 3 Dec | **The adversarial case** |

**Case 3 is the discriminating test.** Cerulean's parity and proximity terms both fail on it.
Only a backward-drift field reaching the berth at the right time can rank it correctly.
Solving it demonstrates something neither the literature nor the operational reference
implementation does.

## Reading rule

Do not read every document each session. Start with `HANDOFF.md`, then this index, then the
**current phase file**, then only the sections of ARCHITECTURE / INTERFACES / CONSTRAINTS
that phase references. Consult `RESEARCH/` through `RESEARCH/INDEX.md`.

## Source of truth

```
repository        what actually exists  (inspect it; fix stale docs against it)
PLAN/             what should exist
HANDOFF.md        what is done, what is next
RESEARCH/         what was learned externally
```
