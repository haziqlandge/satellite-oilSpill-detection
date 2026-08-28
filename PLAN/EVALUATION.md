# EVALUATION

How we know the system works. Executed in PHASE-08; targets referenced by earlier phases.

## Guiding principle

The strongest verification available for this problem is **P004's three Port of South
Louisiana cases** — published, peer-reviewed ground truth that coincides with **free real
AIS**. That coincidence is the entire reason for the dual-region design. Everything else is
supporting evidence.

## 1. Detection (PHASE-02)

### Metrics
| Metric | Target | Basis |
|---|---|---|
| Multi-class **mAP50** | >= 0.90 | P004 achieved 94.2% |
| Multi-class **mAP50-95** | >= baseline YOLO-seg; stretch 0.71 | P004: 68.3% baseline → 71.6% |
| Per-class mAP (`oos`, `slick_unknown`) | both reported | P004 Table 1 reports per-class; averages hide the OOS weakness |
| **Look-alike false-positive count** | **strictly fewer than baseline** | P004 Fig. 5: 14 → 5 |
| Mask IoU (segmentation head) | reported, no hard target | New — P004 used boxes, so there is no comparable prior number |

> **C8: the look-alike FP count is reported separately and never folded into mAP.** It is
> P004's most operationally important result, and false alarms here mean accusing an
> innocent vessel.

### Required ablation
Reproduce P004 Table 1 on **our** data — LSK at {none, L1..L5} × {CIoU, MPDIoU} = 12 runs.
Committed to `ml/ablation/results.md`. Two questions it must answer:

1. Does L5 remain best, or does our dataset shift the optimum?
2. **Does LSK-at-L5 transfer from a detection head to a segmentation head?**
   *This is the open question flagged in `RESEARCH/SYNTHESIS.md` §9 and the main technical
   risk of Phase 2.* A negative result is a legitimate finding and must be reported as one.

Optional second ablation: look-alikes as **background negatives** (P004's choice) vs as an
explicit third **class** (Krestenitis's scheme).

### Test set
Held-out Zenodo Part III + a **look-alike-only subset** from Part II. The look-alike subset
is evaluated separately — it contains no oil, so its only meaningful metric is FP count.

## 2. Characterisation (PHASE-03)

| Check | Target |
|---|---|
| Area, length vs manual QGIS measurement | within **5%** on 3 hand-checked slicks |
| P004 Case 2 slick length | ~**19 km** (paper-reported) |
| P004 Case 1 slick length | ~**5.5 km** |
| P004 Case 3 slick length | ~**5 km** |
| Head/tail identification | head within 1 km of the paper's stated source tip on all 3 cases |
| Wind gate | demonstrably suppresses a known low-wind false positive |
| Damping ratio | reported with `damping_confidence="low"` (C2) |

The three published slick lengths are a genuine external check on the whole geometry chain
— detection mask, geocoding, and medial axis together.

## 3. Drift and hindcast (PHASE-04)

| Check | Target | Method |
|---|---|---|
| **Forward consistency** | Seeding P004 Case 2's source (28 21 31.968 N, 89 13 31.332 W) and running forward to 00:02 UTC 2023-05-15 yields a ~19 km southward-trending slick | Compare modelled footprint to the detected polygon |
| **Backward hit-rate** | The **90% origin contour contains the true source** for Cases 1, 2, 3 | Point-in-polygon |
| **Origin field area** | Reported per case; expected to grow with backward time | Honest reporting, not a target to minimise |
| **Ensemble sanity** | Spread grows monotonically with backward time | C5, C6 — a shrinking spread signals a diffusion bug |
| **Age interval** | The true elapsed time falls inside `{low, high}` for Case 3 (~2 days, known from the mooring timestamp) | Case 3 is the only case with a precisely known release window |
| **Graceful degradation** | A deliberately over-long backward run returns `insufficient_evidence`, not a suspect | C3 |

Case 3's mooring timestamps (sailed 18:06:50 UTC 3 Dec, moored 18:59:12 UTC 3 Dec, imaged
23:57:19 UTC 5 Dec) give a rare hard bound on release time. It is the best age test we have.

## 4. Attribution (PHASE-06) — the headline

### Metrics (Cerulean's, adopted deliberately for comparability)
| Metric | Target |
|---|---|
| **Top-1 source rate** | 3/3 on the P004 cases |
| **Top-3 source rate** | 3/3 |
| **Score separability** | Margin between true source and next candidate, reported per case |

Cerulean reports ~90% top-1 on infrastructure attribution after its redesign. With only
three cases we cannot claim a rate — we report **per-case outcomes**, not a percentage.

### The three fixtures

| Case | Date (UTC) | Expected top-1 | What it tests |
|---|---|---|---|
| **1** | 00:02, 2023-04-09 | **Infrastructure** (platform) | Collation must rank infrastructure above vessels when no vessel is within 5 km |
| **2** | 00:02, 2023-05-15 | **BOCHEM LONDON** (MMSI via AIS) | The straightforward moving-vessel case |
| **3** | 23:57:19, 2023-12-05 | **BRANDON BORDELON**, berthed since 3 Dec | **The adversarial case** |

### Why Case 3 is the real test

Cerulean's two core geometric terms **both fail** on Case 3:
- **Parity** fails — the vessel was stationary; there is no track to be parallel to.
- **Proximity** fails or misleads — the slick head is where the *oil* is, and the vessel
  never moved along it. P004 states explicitly that "the ship's trajectory does not match
  the shape of the oil spill."

Only `S_drift` (a backward field that reaches the berth at the right time) plus a
berthed/loitering `S_behaviour` signal can rank it correctly.

**Acceptance:** `BRANDON BORDELON` ranks above passing traffic. If it does, the system
demonstrably does something the reviewed literature and the operational reference
implementation do not.

**Additional required check:** a **term-ablation** on Case 3 — score it with `S_drift`
removed. The expected result is that the true source drops in rank. That single comparison
is the cleanest possible evidence for the project's central claim.

### Synthetic Indian-waters scenarios (PHASE-05/06)
Ground truth is authored (C10). At minimum:
1. Moving tanker, continuous discharge — the Case 2 analogue
2. Berthed/anchored vessel discharge — the Case 3 analogue
3. Platform leak with vessels transiting nearby — the Case 1 analogue, tests filtering
4. **Dark vessel** — discharger with AIS switched off; a CFAR bright target with no AIS match
5. **Null case** — a look-alike with no spill; must return no detection or no suspect

Scenario 5 matters as much as the rest: a system that always names someone is useless.

## 5. Interpretability (PHASE-06/07)

Not scored numerically, but acceptance-gated (C4):
- [ ] Every suspect exposes all six terms with values **and** weights
- [ ] Every term links to the geometry that produced it
- [ ] Anomaly flags carry their raw series, not just a boolean
- [ ] `insufficient_evidence` renders prominently
- [ ] Alternative hypotheses (infrastructure, dark vessels) are always visible
- [ ] No UI copy asserts guilt (C-ethics 1)

## 6. End-to-end acceptance

One command, one scene, complete story:

```bash
python -m backend.cli run-scene --scene S1A_IW_GRDH_GoM_20230515 --backward-hours 48
```

Must produce:
1. An `oos`-class slick polygon, length ~19 km
2. A backward origin field whose 90% contour contains 28 21 31.968 N, 89 13 31.332 W
3. An age interval with `age_method`
4. **`BOCHEM LONDON` ranked #1**, with a legible six-term breakdown
5. A forward 72 h impact forecast

## 7. Test suite structure

| Level | Scope | Runs in |
|---|---|---|
| Unit | geometry maths, scoring terms, AIS cleaning, origin-field normalisation | CI, seconds |
| Integration | each pipeline stage against a small fixture scene | CI, minutes |
| **Geocoding invariant** | pixel→geo→pixel round-trip **< 1 px** | CI — guards the constraint everything downstream depends on |
| Fixture/E2E | the three P004 cases + 5 synthetic scenarios | Nightly / manual, GPU required |
| Regression | detection metrics + look-alike FP count vs committed baselines | On weights change |

## 8. What we will not claim

- No accuracy percentage from three ground-truth cases.
- No comparison to P003's numbers (C11).
- No cross-region generalisation claim unless we actually test Indian-waters detection on
  real Indian SAR imagery — P002 challenge #2 is real and we should not paper over it.
- No absolute thickness or volume figures (C2).
- No claim that the origin field is a "prediction" of the source. It is a probability field.
