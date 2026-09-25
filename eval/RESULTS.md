# Results (PHASE-08), 2026-09-25

The committed results artefact. Every figure names the file it came from, and
negative results are reported, not dropped (PHASE-08). The comparison with
P004 and Cerulean is in `COMPARISON.md`. What these results do **not** support
is at the end, and it is part of the result.

## Acceptance lines

| Line | Status | Evidence |
|---|---|---|
| Detection mAP50 ≥ .90 | **Not met.** Mask mAP50 .364 on the held-out test (v11, consumed once); v12 .345 on validation | `final/INDEPENDENT_AUDIT.md`, `part2/REPORT.md` |
| Look-alike FP below baseline, reported separately (C8) | **Met.** v12 raises an alarm on 4 of 87 frozen-holdout look-alikes (release: 55); on validation, 2 of 23 (release: 13). Difference −0.586, 95% CI [−0.690, −0.471] | `part2/REPORT.md` |
| LSK-to-segmentation transfer answered | **Answered, negatively.** L5 ranks below both L1 and plain YOLO (mask mAP50-95 .193 vs .199 / .198) | `../ml/ablation/results.md`, `screening/REVIEW.md` |
| Drift: 90% origin contour holds the true source, all three cases | **Met for Cases 1 and 3; not met for Case 2** (0.13 km outside the contour, at the slick's tip) | `evaluation/authored.json` |
| Drift: Case 3's release window inside the age interval | **Not met.** The age interval is degenerate (0 / 0 / 0 h, ISSUES F5); the release ran 16 h | `evaluation/authored.json` |
| Attribution: top-1 on all three cases | **Met on the authored cases** (Case 2 +.396, Case 3 +.186, Case 1 +.232). Not tested on real slicks (below) | `attribution/REPORT.md`, `check:scenarios` |
| Case 3 term ablation executed and recorded | **Executed; the expected drop does not happen.** Case 3's vessel stays 1st without S_drift (ISSUES Q7) | `attribution/REPORT.md`, `attribution/ablation.json` |
| S_drift variant comparison with rationale | **Met.** `integral` chosen, because `max` drops kutch-dark's dark contact to 4th | `attribution/REPORT.md` |
| All five synthetic scenarios resolve, including the null case | **Met.** Four rank their truth first; mumbai-null names nobody (wind 1.9 m/s, gate 0). The two PHASE-10 zones resolve too: Ennore's anchored tanker +.205, Paradip's mooring +.327 | `check:scenarios`, `evaluation/authored.json` |
| `RESULTS.md` and `COMPARISON.md` | This file, and `COMPARISON.md` | — |
| A "what we do not claim" section | Below | — |

## 1. Detection

One class, `slick`. The two-class `oos` / `slick_unknown` scheme has no labels
(ISSUES B1). `oos` is a downstream verdict, never a detector class.

| | v11 release, held-out test (.20) | v12 release, validation (.15) |
|---|---:|---:|
| Mask AP50 | .364 | .345 |
| Mask AP50-95 | .150 | .149 |
| Instance P / R / F1 | .505 / .356 / .417 | .473 / .349 / .401 |
| Small-instance recall | .110 | .124 |
| Look-alike alarm tiles | 8 / 11 (test) | 2 / 23 (val), 4 / 87 (Part II holdout) |

- The test split was evaluated once, on v11, and is consumed (D4). v12 has no
  test figure and must not get one.
- The Part II holdout is geographically disjoint from training but is Zenodo's
  own tiling, not an independently labelled scene set.
- Q5, box-fill: v12 cuts the box-filled share of detected area from 80 / 93 /
  91% to 24 / 51 / 58% on the three Gulf scenes (`part2/box_fill.json`).

## 2. Drift and hindcast

**The authored cases.** `evaluation/authored.json`, from
`cd frontDemo && npm run export:evaluation`. These use the console's analytic
forcing, with P004's slicks as published and real AIS in the Gulf.

| Case | Release | Hindcast hours whose 90% contour holds the source | At the release start | Age triple (h) |
|---|---|---|---|---|
| Case 2, moving tanker | continuous, to the pass | none | 0.13 km outside (slick tip) | 0 / 0 / 0 |
| Case 3, berthed vessel | 16 h, to the pass | −1 to 0 | 6.4 km outside | 0 / 0 / 0 |
| Case 1, platform | 15 h, to the pass | 0 | 10.0 km outside | 0 / 0 / 0 |
| kutch-dark | 18 h, to the pass | −14 to 0 | 1.5 km outside | 0 / 0 / 13 |

A continuous release is at its source for its whole window. The backward cloud
holds the source late in the window and leaves it by the start: the youngest
oil runs back past the source while the oldest returns to it. The age
estimator, `drift_convergence`, answers 0 h for fresh oil at the head and does
not bound a continuous window. That is why the Case 3 age line fails, and it
is recorded as F5, not tuned.

**The real runs.** Three Sentinel-1 Gulf scenes, v12 detections. OpenDrift
OpenOil ran 10 members × 200 parcels on ERA5 wind and CMEMS hourly currents,
each member's wind shifted up to 3 h either way (`PREVIOUS_WORK.md` §2.24).

| Scene | Age | 90% area at −72 h | Forecast |
|---|---|---|---|
| 2023-04-09 | none, never converges (C1) | 339 km² | all oil ashore by +72 h |
| 2023-05-15 | 0.0 / 0.5 / 10.2 h | 564 km² | afloat |
| 2023-12-05 | none, never converges | 49 km² | 48% stranded at +72 h |

**An independent cross-check, Ennore 2017 (PHASE-10).** `ennore/crosscheck.json`,
from `scripts/ennore_crosscheck.py`. The engine above ran forward 48 h from the
28 January 2017 collision two nautical miles off Ennore, on ERA5 wind and CMEMS
reanalysis currents (daily means). The reference is INCOIS's GNOME assessment
and Sentinel-1 observation of that spill: Prasad et al. 2018, *J. Earth Syst.
Sci.* 127:111.

| Hours after | Model: reach south of the source | Published: coast affected |
|---|---|---|
| 10 | 21.9 km, 74% afloat | ~6 km |
| 26 | 42.5 km, 2% afloat | ~15 km (Sentinel-1) |
| 43 | 59.0 km, all ashore | ~18 km |

- **Direction agrees:** the oil goes south-south-west along the coast (208°).
- **Beaching agrees:** the oil comes ashore within a day, as the real oil did.
- **The along-shore reach is about 3.4 times too long.**
- **Likely causes:** daily-mean currents with no tide, and 2-4% windage in a
  north-east monsoon.
- **Nothing was tuned to close the gap** (ISSUES X17).
- **Why the comparison is loose:** the published figures are lengths of
  affected coast, not a trajectory, so reach and direction are what can be
  compared.

The real seeds are not P004's published slicks (the model's seeds lie tens of
km away; ISSUES X7 for Case 3's acquisition), so no real case is scored against
P004's ground truth.

## 3. Attribution

`attribution/REPORT.md` holds the full tables. On the authored cases, all
three P004 truths and the dark contact rank first. Removing the drift field
entirely (no gate, no S_drift):

- the platform (Case 1) falls to 2nd;
- the dark contact falls to 8th;
- the Case 2 tanker's margin falls from .396 to .048.

The field is decisive where geometry is silent. **It is not decisive on the
authored Case 3**, whose slick head sits on the berth, so proximity carries it
(Q7).

No real run is ranked:

- two never converge;
- the third's wind (1.97 m/s) is below the Bragg gate;
- ranking a live field waits on smoothing it (X16).

Every one of these refusals is shown in the console (pane 04).

## 4. Interpretability

Every suspect carries six named terms, their weights (`w1-handset`, never
fitted) and the geometry behind each (C4). The console shows the ablation live:
pane 04, "recompute without s_drift". The authored cases resolve in pane 04 as
the tables above say.

## What we do not claim (EVALUATION.md §8)

- **No accuracy percentage from three ground-truth cases.** The outcomes above
  are per case.
- **No comparison to P003's numbers** (C11).
- **No cross-region generalisation.** Indian-waters scenarios use simulated AIS
  and analytic forcing. They test the pipeline's logic, not detection on real
  Indian SAR imagery (P002's highest-priority open problem).
- **No thickness or volume** (C2). The damping ratio is relative.
- **The origin field is a probability field, not a prediction of the source.**
- **Real-world attribution is not demonstrated.** Every figure in §3 is from
  authored cases. No real vessel has been ranked on a real slick.
- **The v12 look-alike gain is shown on Zenodo's own tiling**, not on an
  independently labelled scene set. A new generalisation claim needs a freshly
  frozen, independently labelled holdout (D4).
- **Current detections are research output**, one class, and must not be
  presented as operational accusations.
