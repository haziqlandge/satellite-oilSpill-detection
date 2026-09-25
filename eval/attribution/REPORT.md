# PHASE-06 attribution engine: acceptance record (2026-09-25)

The backend engine is `backend/attribute/` (`field.py`, `features.py`, `scoring.py`,
`weights.py`, `candidates.py`). It is the Python twin of the console's scorer
(`frontDemo/src/sim/scoring.ts`), which the five authored scenarios were built and accepted
on. `tests/test_attribution.py` holds the two to the same answers on fixtures the console
exports (`npm run export:scoring-fixtures`). The test covers every term, total, rank, gate
count, separability, refusal and line of evidence text, under both S_drift variants. Floats
agree to 1e-9 relative, and the text is identical.

All figures below come from `scripts/attribution_ablation.py` (`ablation.json`), scored over
**all** of each scenario's traffic. That uses `npm run export:scoring-fixtures -- --all-vessels
<dir>`, not the trimmed fixtures in `tests/`. Weights are `w1-handset`, unchanged and never
fitted.

## The S_drift question: max or integral

| Scenario | P004 | integral: truth rank, margin | max: truth rank, margin |
|---|---|---|---|
| gom-moving | Case 2 (the tanker) | 1st, +0.396 | 1st, +0.388 |
| gom-berthed | Case 3 (the berthed vessel) | 1st, +0.186 | 1st, +0.186 (identical) |
| gom-platform | Case 1 (the platform) | 1st, +0.232 | 1st, +0.232 |
| kutch-dark | dark contact | **1st, +0.058** | **4th**, and it refuses (top two 0.011 apart) |
| mumbai-null | nobody | refuses (wind 1.9 m/s, gate 0) | refuses |

**Choice: `integral`.** It passes all five; `max` fails kutch-dark.

What decided it was not the reason PHASE-06 anticipated. PHASE-06 expected Case 3 to need
the integral, because a vessel that lingered should gain from it. On this fixture Case 3 is
identical under both variants. The berthed vessel's dwell saturates, and its peak is already
the field's best cell. The failure was elsewhere, and it is a structural asymmetry. A track's
`max` is the densest cell its whole voyage ever touches. A fixed contact has one position, so
its `max` equals its integral. `max` therefore rewards carrying AIS, and the unlit contact
loses to passing traffic that crossed the field's core (`scoring.ts`, `scoreDark`).

## The ablation: is the field what finds the source?

Two ablations, because the gate is itself the field.

- **Term ablation:** S_drift's weight is removed and the rest renormalised, over the same gated
  candidates. This is the console's `rankWithoutDrift`.
- **Field ablation:** there is no field at all. Every vessel with a report is a candidate (no
  gate), and S_drift is removed. This is Cerulean's position, with geometry standing in for
  transport.

| Scenario | with the field | term ablation | field ablation |
|---|---|---|---|
| gom-moving (Case 2) | 1st of 24, +0.396 | 1st, +0.266 | 1st of 232, **+0.048** |
| gom-berthed (Case 3) | 1st of 11, +0.186 | 1st, +0.209 | 1st of 316, +0.130 |
| gom-platform (Case 1) | 1st of 6, +0.232 | 1st, +0.257 | **2nd of 313, -0.025** |
| kutch-dark | 1st of 38, +0.058 | **3rd, -0.034** | **8th of 232, -0.132** |

**Reading it:**

- **Without the field, the platform (Case 1) and the unlit contact (kutch-dark) are no longer
  found.** The Case 2 tanker is still first, but its margin falls from 0.396 to 0.048, close
  to the 0.015 separability floor.
- **The acceptance line is not met as written.** PHASE-06 asks that "scoring with S_drift
  removed drops the true source in rank" on **Case 3**. On this fixture it does not, under
  either ablation. The berthed vessel sits at the slick's head, so proximity (0 km),
  behaviour (stationary through the window) and its class prior carry it. The field narrows
  316 vessels to 11 and widens the margin from 0.130 to 0.186, but it is not needed for the
  top-1. PHASE-06 says to revisit the formulation before touching weights, and nothing was
  tuned. The honest statement is that the field is decisive where geometry is silent (a
  platform, a dark contact) and adds margin where it is not.
- The authored Case 3 puts the slick head on the berth. The published case (P004) describes a
  vessel whose track does not parallel the slick. Whether proximity would still carry a real
  Case 3 depends on the real December slick, which is the acquisition mismatch in ISSUES X7.

## Other acceptance lines

| Line | Status |
|---|---|
| All three P004 cases top-1 | Met on the authored scenarios (above). Not met on real runs: every real field is wind-only (X2), and the pipeline refuses to rank (E-X2) |
| Score separability reported per case | Above, and in each run's `separability` |
| Both S_drift variants evaluated, choice recorded | Above: `integral` |
| Case 3 ablation drops the true source | **Not met** (above) |
| Five synthetic scenarios resolve, the null case names nobody | Met: four rank the truth first; mumbai-null refuses |
| Every suspect exposes six terms with weights and geometry | Met; tested |
| A diffuse field yields insufficient evidence | Met; tested (and the wind gate, and no candidate) |
| Scoring < 10 s per detection | Met: 0.05-0.25 s over each scenario's full traffic (230-316 vessels), CPU |
