# PHASE-09 — Demo packaging

## Objective
Make the system demonstrable end-to-end with a **network failure path**, a seeded database,
a scripted walkthrough, and documentation that lets someone else run it.

> **Amended 2026-08-28.** The original objective was "no network dependency". The database
> is now hosted on Supabase (`scripts/SETUP_DATABASE.md`), so full offline operation is no
> longer available for free. C12 replaces it: the demo must **degrade gracefully** when the
> network is unavailable, which now takes deliberate work rather than falling out of the
> architecture.

## Why it exists
An SIH demo fails on infrastructure far more often than on substance. CMEMS auth, a CDSE
token expiry, or venue wifi will end the demo regardless of how good the science is. This
phase removes every live dependency from the critical path.

## Dependencies
PHASE-07 (UI), PHASE-08 (validated results).

## Files to create
```
scripts/seed_demo.py            populate Supabase with pre-processed scenes + results
scripts/export_snapshot.py      dump the result set to a local offline snapshot
scripts/verify_offline.py       assert the demo runs with networking disabled
backend/db/snapshot.py          DEMO_OFFLINE=1 read path
demo/WALKTHROUGH.md             the 3-minute script
demo/data/                      snapshot, cached scenes, forcing NetCDF, AIS extracts
README.md                       updated: setup, run, architecture diagram
docs/architecture.png
```

## Implementation details

### Pre-seed everything, then snapshot it locally
Run the full pipeline for every demo scene and persist results to Supabase, so that at demo
time the API only reads. Then **export that result set to a local snapshot** and add a
`DEMO_OFFLINE=1` path that reads from the snapshot instead of the network.

The post-PHASE-08 result set is small (scenes, detections, drift contours, ranked
candidates, evidence cards), so a local SQLite or file-backed snapshot is cheap. Slick and
track geometry can be served as GeoJSON straight from disk.

**Test the snapshot path with the network actually disabled, not by mocking it.** An
untested fallback is not a fallback.

Pre-seed:
- the three P004 GoM fixture scenes (pre-processed σ0 tiles + COGs)
- all five synthetic Indian-waters scenarios
- cached CMEMS/ERA5 forcing NetCDF for every window
- AIS extracts for the fixture dates
- detections, characterisations, drift runs, origin-field NetCDFs and contours, candidates,
  scores and evidence cards

`scripts/verify_offline.py` runs the demo with networking disabled and fails loudly if
any code path *other than the sanctioned snapshot reader* reaches for the network.
**Run it as the last check before presenting.**

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
- Out: a seeded database, a local snapshot, a one-command demo + walkthrough + README

## Relevant interfaces
None new.

## Relevant research
`RESEARCH/SYNTHESIS.md` §4 (the gap — the demo's argument) and §8 (validation strategy).

## Tests
- `scripts/verify_offline.py` passes with networking disabled
- The demo starts from a clean checkout with only `.env` supplied
- Every walkthrough step executes in order without manual intervention
- Cold-start time measured and recorded

## Acceptance criteria
- [ ] Demo runs from the local snapshot with networking disabled; `verify_offline.py` green
- [ ] Snapshot export is reproducible from a single command, not hand-assembled
- [ ] All three GoM fixtures and all five synthetic scenarios pre-seeded in Supabase **and** present in the local snapshot
- [ ] The demo starts from a clean checkout with only `.env` supplied
- [ ] `demo/WALKTHROUGH.md` fits in 3 minutes and covers all five acts
- [ ] The Case 3 `S_drift` term-ablation is runnable **live** from the UI or one command
- [ ] `insufficient_evidence` appears at least once in the walkthrough
- [ ] README lets a stranger reproduce the demo
- [ ] `HANDOFF.md` updated to final state

## Known failure conditions
- Demo data size (SAR scenes + forcing NetCDF) is large → git-ignore `demo/data/`; ship via
  an archive or a download script, and document expected size.
- Supabase free-tier projects pause after about a week idle. **Resume the project the day
  before**, and rely on the snapshot if it will not wake.
- Snapshot drifting out of sync with Supabase after a late pipeline re-run → re-export as
  the final step, never as an early one.
- GPU unavailable at the venue → detection results are pre-seeded, so the demo does not need
  a GPU. **Verify this explicitly** by running the demo with CUDA disabled.
- Live term-ablation being slow → precompute both scorings and toggle between stored results.
