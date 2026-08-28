# PHASE-09 — Demo packaging

## Objective
Make the system demonstrable end-to-end with **no network dependency**, with a seeded
database, a scripted walkthrough, and documentation that lets someone else run it.

## Why it exists
An SIH demo fails on infrastructure far more often than on substance. CMEMS auth, a CDSE
token expiry, or venue wifi will end the demo regardless of how good the science is. This
phase removes every live dependency from the critical path.

## Dependencies
PHASE-07 (UI), PHASE-08 (validated results).

## Files to create
```
scripts/seed_demo.py            populate PostGIS with pre-processed scenes + results
scripts/verify_offline.py       assert the demo runs with networking disabled
demo/WALKTHROUGH.md             the 3-minute script
demo/data/                      cached scenes, forcing NetCDF, AIS extracts (git-ignored)
docker-compose.demo.yml         pinned, offline-capable stack
README.md                       updated: setup, run, architecture diagram
docs/architecture.png
```

## Implementation details

### Pre-seed everything
Run the full pipeline offline for every demo scene and persist results, so that at demo time
the API only reads. Pre-seed:
- the three P004 GoM fixture scenes (pre-processed σ0 tiles + COGs)
- all five synthetic Indian-waters scenarios
- cached CMEMS/ERA5 forcing NetCDF for every window
- AIS extracts for the fixture dates
- detections, characterisations, drift runs, origin-field NetCDFs and contours, candidates,
  scores and evidence cards

`scripts/verify_offline.py` runs the demo with networking disabled and fails loudly if
anything reaches for the network. **Run it as the last check before presenting.**

### The walkthrough — structure

The narrative is the argument. Order it so each step earns the next.

**Act 1 — real data, published ground truth (GoM, 2023-05-15).**
Load the scene. Detector finds a linear `oos`-class slick, ~19 km. Show the geometry and the
wind gate. *This is a real Sentinel-1 scene and a real, peer-reviewed spill.*

**Act 2 — hindcast.** Run the time slider backward. The origin field contracts toward a
point. Show the age interval and its method. *Nobody in the reviewed literature does this
automatically — P004 named it as future work.*

**Act 3 — attribution.** AIS traffic appears; the spatiotemporal gate strips it to a handful.
`BOCHEM LONDON` ranks #1. Open the evidence card: six terms, weights, geometry, caveats.
*Compare against the paper: same vessel, reached automatically.*

**Act 4 — the hard case (2023-12-05).** `BRANDON BORDELON`, berthed for two days, track not
matching the slick. Show that parity and proximity — Cerulean's core terms — both score low.
Then show `S_drift` carrying it. **Run the term-ablation live: remove `S_drift`, watch the
true source drop.** *This is the moment that demonstrates the contribution.*

**Act 5 — Indian waters.** The synthetic Gulf of Kutch / Mumbai High scenario, including the
dark-vessel case and the **null case where the system correctly names nobody**.

Act 4 is the centrepiece. Act 5 answers "does this work for India". Act 5's null case
answers the question a sceptical judge will ask: *does it ever say "I don't know"?*

### Honesty in the demo
The demo must not overstate what the evaluation showed (`EVALUATION.md` §8):
- Say the Indian scenarios are **synthetic AIS**, as the problem statement permits, and that
  they test the logic rather than cross-region detector transfer
- Present per-case outcomes, not an accuracy percentage from n=3
- Show `insufficient_evidence` at least once — a system that always names someone is useless
- Keep the "candidate / suspected" language (ethics constraints)

### Documentation
`README.md`: one-command setup, one-command demo, the architecture diagram, and pointers to
`RESEARCH/INDEX.md` and `PLAN/INDEX.md`. Someone who has never seen the repo should get the
demo running from it.

## Inputs / outputs
- In: validated pipeline, evaluation results
- Out: a seeded, offline, one-command demo + walkthrough + README

## Relevant interfaces
None new.

## Relevant research
`RESEARCH/SYNTHESIS.md` §4 (the gap — the demo's argument) and §8 (validation strategy).

## Tests
- `scripts/verify_offline.py` passes with networking disabled
- `docker compose -f docker-compose.demo.yml up` reaches a working UI from a clean clone
- Every walkthrough step executes in order without manual intervention
- Cold-start time measured and recorded

## Acceptance criteria
- [ ] Demo runs fully offline; `verify_offline.py` green
- [ ] All three GoM fixtures and all five synthetic scenarios pre-seeded
- [ ] `docker compose -f docker-compose.demo.yml up` works from a clean clone
- [ ] `demo/WALKTHROUGH.md` fits in 3 minutes and covers all five acts
- [ ] The Case 3 `S_drift` term-ablation is runnable **live** from the UI or one command
- [ ] `insufficient_evidence` appears at least once in the walkthrough
- [ ] README lets a stranger reproduce the demo
- [ ] `HANDOFF.md` updated to final state

## Known failure conditions
- Demo data size (SAR scenes + forcing NetCDF) is large → git-ignore `demo/data/`; ship via
  an archive or a download script, and document expected size.
- Docker volume mounts differing on Windows vs Linux → test on the actual demo machine, not
  only the dev machine.
- GPU unavailable at the venue → detection results are pre-seeded, so the demo does not need
  a GPU. **Verify this explicitly** by running the demo with CUDA disabled.
- Live term-ablation being slow → precompute both scorings and toggle between stored results.
