# PHASE-04 — Met-ocean forcing and the drift engine

## Objective
Backward and forward Lagrangian drift with OpenDrift OpenOil, run as an **ensemble**,
producing the **origin probability field `P(lat, lon, t)`** — the spatiotemporal search
window that everything in PHASE-06 is conditioned on — plus a forward impact forecast and a
drift-derived age estimate.

## Why it exists
This is problem-statement part (b), and it is the component that makes part (c) tractable.
A slick observed at position X was released **somewhere else, earlier**. Without transport
physics there is no principled way to convert an observation into a search region.

P003 is the cautionary example: two parallel pipelines joined by an unspecified
"correlation" box, with no drift model, able only to ask *"was an anomalous vessel near the
slick's current position?"* — which fails exactly on P004's Case 3.

P004 names the fix in its own future work: *"automatically feed the spill's location and
shape into an ocean drift model like OpenDrift for reverse-trajectory simulations"*.

**This phase can be built in parallel with PHASE-02/03.**

## Dependencies
PHASE-00. Uses PHASE-03 masks when wiring end-to-end, but the engine and forcing readers can
be developed against a synthetic polygon.

## Files to create
```
backend/ingest/metocean/cmems.py        currents; NetCDF cache
backend/ingest/metocean/era5.py         wind (GFS fallback)
backend/ingest/metocean/cache.py        offline-first cache layer
backend/drift/opendrift_runner.py       one OpenOil run (fwd or bwd)
backend/drift/ensemble.py               parameter/forcing sampling, parallel runs
backend/drift/origin_field.py           particle density -> P(lat,lon,t), contours
backend/drift/convergence.py            concentration metric -> age
tests/test_drift.py, tests/test_origin_field.py
```

## Implementation details

### Forcing
| Field | Product |
|---|---|
| Currents (historical — our 2023 fixtures) | CMEMS `GLOBAL_MULTIYEAR_PHY_001_030` |
| Currents (recent/forecast) | CMEMS `GLOBAL_ANALYSISFORECAST_PHY_001_024` |
| Wind | ERA5 (consistent pairing — CMEMS currents are ERA5-forced); GFS fallback |

**Cache everything to local NetCDF.** CMEMS auth/quota is the single most likely live-demo
failure (`CONSTRAINTS.md`). The cache layer is offline-first: hit disk, then network.

### Backward run
OpenDrift documents that it **"can simulate backwards in time (specify a negative time
step)"**; maintainers confirm a negative `time_step` to `run()` reverses everything
automatically. That is the mechanism.

1. **Seed** N particles sampled inside the **instance mask** (not a bounding box — this is
   why PHASE-02 needed segmentation). Optionally weight by damping ratio.
2. Run backward, horizon 0–48 h.
3. **Ensemble** over the dominant uncertainties:
   - wind drift factor ~0.02–0.04
   - horizontal diffusivity
   - forcing perturbation members, including **wind phase shifts** — Kampouris 2021 found
     substantial sensitivity to wind phase specifically
4. Accumulate particle density onto a lat/lon/time grid; normalise per timestep.

**Never a single trajectory (C5).** P002 via Kampouris: ensembles are what turn trajectory
modelling into probabilistic assessment rather than a point prediction.

**Never hand-roll diffusion (C6).** Nordam 2019: naive random-walk schemes produce spurious
particle accumulation when eddy diffusivity varies with depth — and in a *backward* run
those artefacts become false, confident-looking origin locations. Use OpenDrift's built-in
vertical mixing.

### Origin field
`origin_field` → NetCDF on disk (large); DB stores the path plus derived **50% and 90%
contours** as GeoJSON per timestep for map rendering. The API serves contours, not grids.

### Age from convergence
Two independent signals:
1. **Convergence minimum** — the backward timestep at which the cloud is most spatially
   concentrated.
2. **Source coincidence** — the timestep at which the high-probability region first
   intersects a candidate source. This is the operationally meaningful one.

Ensemble spread at that timestep **is** the uncertainty interval. Emit
`age_hours = {low, best, high}` + `age_method` (C1).

Map to P004's proposed temporal states: `ongoing` / `recent` / `legacy` / `indeterminate`.

### Honest limits — must be implemented, not just documented
**Reversal is not information recovery.** Diffusion is irreversible; running a diffusive
process backward spreads the cloud. The origin field legitimately widens with backward time
— report it, never tune it away.

Beyond ~24–48 h the field may be too diffuse to discriminate. **Required behaviour (C3):
return `insufficient_evidence`, not a forced suspect.** Implement the threshold explicitly
and test it.

### Forward run
Same engine, positive `time_step`, 0–72 h from the current slick → impact forecast.

## Inputs / outputs
- In: `Detection` mask, acquisition time, cached forcing
- Out: `DriftRun` row + `origin_field` NetCDF + contours + age + temporal state

## Relevant interfaces
`INTERFACES.md` §1 (`run_drift`), §2 (`DriftRun`), §4 (CMEMS/ERA5 with cache fallback).

## Relevant research
`RESEARCH/topics/drift-modelling-and-hindcasting.md` (the whole note);
`RESEARCH/topics/slick-age-estimation.md`; `RESEARCH/papers/P002.md` (findings 1–3).

## Tests
- Backward then forward over the same interval returns particles near their origin under
  **zero diffusivity** (advection-only reversibility — the correctness check).
- Ensemble spread grows monotonically with backward time (guards a diffusion bug).
- Origin field integrates to 1.0 per timestep.
- A deliberately over-long backward run yields `insufficient_evidence`.
- Cache layer serves forcing with the network disabled.

## Acceptance criteria
- [ ] **Forward check:** seeding P004 Case 2's source (28 21 31.968 N, 89 13 31.332 W) and
      running to 00:02 UTC 2023-05-15 produces a ~19 km southward-trending footprint
- [ ] **Backward hit-rate:** the 90% origin contour contains the true source for all three
      P004 cases
- [ ] Case 3's known ~2-day release window falls inside the reported age interval
- [ ] Ensemble runs complete in < 5 min per detection
- [ ] Entire drift stage runs with the network disabled, from cache
- [ ] Over-long backward runs degrade to `insufficient_evidence`

## Known failure conditions
- **Diffusive irreversibility** — the convergence minimum may be shallow or absent for older
  slicks. This is physics, not a bug. Report `beyond_horizon`.
  *(Main risk to the age deliverable — `SYNTHESIS` §9 Q2.)*
- OpenDrift requiring positive `time_step` in some code paths → verify reversal empirically
  with the zero-diffusivity test before trusting any result.
- CMEMS reader auth failing mid-run → cache-first ordering prevents this.
- Land-stranding of backward particles near the delta → configure the coastline
  interaction mode deliberately; do not accept the default silently.
- N and ensemble size too large for a live demo → tune in this phase, record the choice.
