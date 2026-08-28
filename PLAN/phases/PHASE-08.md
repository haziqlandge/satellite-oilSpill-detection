# PHASE-08 — Evaluation and validation

## Objective
Run the full evaluation defined in `EVALUATION.md`, produce the results artefacts, and state
honestly what the system does and does not demonstrate.

## Why it exists
Everything before this is assertion. This phase is where the central claim —
*drift-conditioned attribution outperforms geometry-proxy attribution* — is tested against
published ground truth, and where negative results get recorded rather than buried.

## Dependencies
PHASE-02 through PHASE-06. PHASE-07 optional (results can be produced headless).

## Files to create
```
eval/run_detection_eval.py
eval/run_drift_eval.py
eval/run_attribution_eval.py
eval/fixtures/p004_cases.yaml       the three ground-truth cases
eval/fixtures/synthetic_scenarios.yaml
eval/RESULTS.md                     the committed results artefact
eval/COMPARISON.md                  us vs P004 Table 2 vs Cerulean
```

## Implementation details

### Detection
Multi-class mAP50, mAP50-95, per-class mAP, mask IoU. **Look-alike FP count reported
separately, never folded into mAP (C8)** — it is P004's most operationally important result
and false alarms here mean accusing an innocent vessel.

Test set: held-out Zenodo Part III + the look-alike-only subset from Part II (evaluated
separately — it contains no oil, so FP count is its only meaningful metric).

### Drift
- **Forward consistency** — seed P004 Case 2's source, run to acquisition, compare the
  modelled footprint to the detected ~19 km polygon
- **Backward hit-rate** — does the 90% origin contour contain the true source, for all three
  cases
- **Origin field area per case** — reported, expected to grow with backward time. This is
  honest reporting, not a target to minimise
- **Ensemble sanity** — spread grows monotonically with backward time
- **Age** — Case 3's known release window (moored 18:59:12 UTC 2023-12-03, imaged 23:57:19
  UTC 2023-12-05) must fall inside the reported interval. It is the only case with a hard
  bound on release time

### Attribution — the headline
Cerulean's metrics, adopted for comparability: **top-1 source rate**, **top-3 source rate**,
**score separability**.

With three ground-truth cases we report **per-case outcomes, not a percentage** (`EVALUATION`
§8). Claiming an accuracy rate from n=3 would be indefensible.

**The two required experiments:**

1. **Case 3 term-ablation.** Score Case 3 with `S_drift` removed. Expected: the true source
   (`BRANDON BORDELON`, berthed for two days, track not matching the slick) drops in rank.
   *This single comparison is the cleanest possible evidence for the project's central
   claim.* Record the result either way.

2. **`S_drift` variant comparison.** Max-over-track-points vs integral-of-track-through-field
   (`SYNTHESIS` §9 Q3). The integral should favour a lingering vessel and therefore Case 3.
   Record which won and why.

### Synthetic scenarios
Five Indian-waters scenarios with authored ground truth (PHASE-05). The **null case** —
a look-alike with no spill, where the system must name nobody — carries as much weight as
the positives. A system that always produces a suspect is worthless.

### Comparison artefact
`eval/COMPARISON.md` positions us against P004 Table 2 and Cerulean along the axes in
`SYNTHESIS` §4: detect / contour / backward drift / auto attribution / explainable.

Be precise about what is and is not comparable: P004's mAP is **detection-box** mAP on
**its** dataset; ours is instance-segmentation on a different corpus. Report both, and say
plainly that they are not head-to-head.

### Optional: independent labels
Cerulean maintains a public database of **human-reviewed** slicks accessible via its API.
Worth investigating as an independent label source for detection validation — a genuinely
external check rather than a self-consistent one.

## Inputs / outputs
- In: trained weights, the three P004 fixtures, five synthetic scenarios, cached forcing
- Out: `eval/RESULTS.md`, `eval/COMPARISON.md`, ablation tables, figures

## Relevant interfaces
None new — evaluation calls the pipeline stages directly (`INTERFACES.md` §1).

## Relevant research
`PLAN/EVALUATION.md` (the authoritative spec — do not restate it here);
`RESEARCH/SYNTHESIS.md` §8; `RESEARCH/papers/P004.md` (Tables 1–2, the three cases).

## Tests
The evaluation scripts are themselves tested: metric functions verified against hand-computed
small examples (mAP, IoU, top-k, separability) so a reported number cannot come from a
broken metric.

## Acceptance criteria
- [ ] Detection: mAP50 >= 0.90; look-alike FP < baseline, reported separately
- [ ] Detection: the LSK-to-segmentation-head transfer question **explicitly answered**
- [ ] Drift: 90% origin contour contains the true source for all three cases
- [ ] Drift: Case 3's known release window inside the reported age interval
- [ ] Attribution: correct top-1 on all three cases
- [ ] **Case 3 term-ablation executed and recorded**
- [ ] `S_drift` variant comparison recorded with its rationale
- [ ] All five synthetic scenarios resolve correctly, including the null case
- [ ] `eval/RESULTS.md` and `eval/COMPARISON.md` committed
- [ ] A "what we do not claim" section written, per `EVALUATION.md` §8

## Known failure conditions
- **Fixture overfitting.** Three cases is a tiny sample and it is very easy to tune weights
  until they pass. **Weights are hand-set and version-stamped before evaluation runs**
  (PHASE-06); if a fixture fails, fix the *formulation*, not the weights, and record that
  you did.
- Negative results are expected and must be published in `RESULTS.md`, not dropped. If LSK
  does not transfer to a segmentation head, or if `S_drift` does not rescue Case 3, that is
  a finding.
- P004's reported numbers are on **its** dataset; ours will differ. Do not present a
  difference as an improvement or a regression without saying the datasets differ.
- Cross-region generalisation is **not** demonstrated by synthetic Indian scenarios — they
  test the logic, not the detector's transfer to real Indian SAR imagery. Say so explicitly
  (P002 challenge #2).
