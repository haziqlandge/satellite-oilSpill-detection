# Topic — Drift modelling, backward hindcasting, and the origin field

Sources: [[P002]] (primary for method choice), [[P004]] (states this as its future work),
[[P003]] (shows what happens without it), OpenDrift documentation and maintainer guidance,
INCOIS OOSA (web).

**This topic is the core of problem-statement part (b) and the enabler of part (c).**

## Why a drift model is structurally necessary

A slick observed at position X at time T was **released somewhere else, at some earlier
time**. Without a transport model there is no principled way to convert an observation into
a search region for the source.

[[P003]] is the cautionary case: it runs an AIS pipeline and a SAR pipeline in parallel and
joins them with an unspecified "Anomaly & Spill Correlation" box. With no drift model, the
only question it can answer is *"was an anomalous vessel near the slick's current
position?"* — which fails whenever the source has moved on. [[P004]]'s Case 3 (source vessel
berthed two days before acquisition, track not matching slick shape) is exactly that case.

[[P004]] names the fix in its own future work:

> "we will automatically feed the spill's location and shape into an ocean drift model like
> **OpenDrift** (Dagestad et al., 2018) for **reverse-trajectory simulations**. This will
> replace the manual analysis process and achieve intelligent source-tracking throughout
> the entire lifecycle of an OOS event."

## Engine choice: OpenDrift OpenOil — settled

[[P002]] frames the trade-off precisely:

> "Despite offering physically correct frameworks, conventional Lagrangian particle-tracking
> models, such as **OpenDrift** and **MEDSLIK-II**, still struggle with computational
> complexity and real-time adaptation (Vasconcelos et al., 2025)."

The weakness is **cost and real-time adaptation, not correctness**. Forensic hindcasting is
not real-time, so the weakness does not bind us. **Do not build or learn a surrogate drift
model** — nothing in the literature claims a learned model beats the physics.

`OpenOil` is OpenDrift's 3-D oil module; weathering is based on the NOAA-ERR-ERD OilLibrary.

### Alternatives considered and rejected for this build
- **MEDSLIK-II** — equally valid, Mediterranean-operational, used by [[P002]]'s cited
  ensemble and Bayesian-calibration work. Rejected only because [[P004]] names OpenDrift and
  OpenDrift's Python API and backward support are better documented.
- **NOAA GNOME** — this is what **INCOIS** actually runs operationally for the Indian
  Ocean (OOSA advisory, diagnostic mode, forced by ROMS/HYCOM/GODAS + ECMWF/NCMRWF/WRF).
  Worth citing as the Indian operational reference and as a sanity cross-check for the
  Indian demo region, but not worth a second integration.

## The backward mechanism

OpenDrift's own documentation states it **"Can simulate backwards in time (specify a
negative time step)"**, and maintainer guidance on the project's discussions confirms that
passing a negative `time_step` to `run()` reverses the integration automatically.

That single API fact is the mechanism for part (b). It is not exotic — but note the honest
caveat below about what reversal does and does not recover.

## From trajectories to an origin field

A single backward trajectory is scientifically indefensible. [[P002]] via Kampouris et al.
(2021) established that **ensemble simulation over forcing uncertainty** is what turns
trajectory modelling into "probabilistic hazard assessments that communicate outcome ranges
rather than point predictions", and found substantial sensitivity to **wind phase
differences** in particular.

**Design:**

1. **Seed** N particles sampled inside the detected slick polygon (instance mask, not a
   bounding box — hence the need for instance segmentation). Optionally weight the sampling
   by damping ratio, so thicker/fresher parts of the slick contribute more.
2. **Run backward** with negative `time_step` over a 0–48 h horizon.
3. **Ensemble** over the dominant uncertainties:
   - wind drift factor (~0.02–0.04, the standard range)
   - horizontal diffusivity
   - forcing perturbation members (and, per Kampouris, wind **phase** shifts specifically)
4. **Accumulate** particle density onto a lat/lon/time grid, normalise per timestep.

**Output: `origin_field P(lat, lon, t)`** — a 4-D probability field, the "origin window in
space and time" that the problem statement asks for. Plus a per-timestep **convergence
metric** (spatial concentration of the backward cloud).

5. **Forward run** 0–72 h from the current slick for impact forecasting (part (b), second half).

### Do not hand-roll diffusion

[[P002]] via Nordam et al. (2019): naive random-walk turbulent diffusion produces
**spurious accumulation artifacts** when eddy diffusivity varies with depth. In a backward
run those artifacts become false high-probability origin locations — a silent failure that
looks like a confident answer. **Use OpenDrift's built-in vertical mixing.**

## Age from convergence

The problem statement asks for slick age "if feasible". See [[slick-age-estimation]] for the
full argument. In summary: direct SAR-to-age regression is not supported by the literature;
the defensible estimate is the **backward timestep at which the particle cloud is most
concentrated**, with the cloud's spread giving the uncertainty interval.

## Honest limits of backward drift

These must be surfaced in the UI, not hidden:

| Limit | Why | Handling |
|---|---|---|
| **Reversal is not information recovery.** Diffusion is irreversible; running a diffusive process backward spreads the cloud rather than focusing it. | Physics | The origin field legitimately widens with backward time. Report it; do not tune it away. |
| Beyond ~24–48 h the field may be too diffuse to discriminate candidates | Accumulated forcing error + diffusion | Degrade gracefully to **"origin window too diffuse to attribute"** rather than forcing a suspect. This is a required behaviour, not a failure. |
| Forcing resolution (CMEMS ~1/12 deg) is coarser than slick scale | Data | Widens the field; acknowledged in the uncertainty interval |
| Surface currents + Stokes drift + windage are all approximations | Model | Ensemble over wind drift factor covers the dominant term |
| Weathering changes the particle's drift response over time | Physics | OpenOil models it; accept its defaults |

## Forcing data

| Field | Source | Notes |
|---|---|---|
| Ocean currents | CMEMS `GLOBAL_ANALYSISFORECAST_PHY_001_024` | OpenDrift ships a CMEMS reader; needs a free marine.copernicus.eu account |
| Currents (alt) | CMEMS `MULTIOBS_GLO_PHY_MYNRT_015_003` | Total = geostrophic + Ekman, 0 m and 15 m, hourly, 1/4 deg |
| Reanalysis | CMEMS `GLOBAL_MULTIYEAR_PHY_001_030` | For historical cases (our GoM 2023 fixtures) |
| Wind | ERA5 (reanalysis) or GFS (forecast) | CMEMS currents are themselves ERA5-forced, so ERA5 wind is the consistent pairing |
| India | INCOIS OOSA / ROMS / HYCOM / GODAS | Reference and cross-check only |

**Cache all forcing to local NetCDF.** The demo must run with no network.

## Validation strategy

[[P004]]'s three TPSL cases give published source coordinates and times, with free real AIS:

- **Forward check** — seed at Case 2's source (28 21 31.968 N, 89 13 31.332 W), run forward
  to the 00:02 UTC 15 May 2023 acquisition; the modelled slick should be ~19 km and
  southward-trending, matching the observed geometry.
- **Backward check** — seed from the observed slick polygon, run backward; the origin
  field's peak should contain that coordinate.
- **Metric** — backward hit-rate: does the 90% probability contour contain the true source?

This is a real, falsifiable test, and it is the strongest available for this problem.

## Prior art in drift-based attribution

From [[P004]] Sec. 3.7 — worth reading before finalising the scorer:
- **Busler et al. 2015** — probabilistic crossing of ship tracks with slick drift
  trajectories in space and time. Closest prior art to our approach.
- **Luo et al. 2024** — converts the slick area to trajectory points and uses a
  **bidirectional drift model** to find the most likely ship. Also very close.
- **Ciappa and Costabile 2014** (via [[P002]] refs) — oil spill hazard assessment using a
  **reverse trajectory method**, Egadi MPA, Mediterranean.

Our differentiator versus all three is not the backward run itself but that the backward
run produces a **probability field consumed as a scoring term** (`S_drift`) inside an
automated, explainable, multi-factor ranker — rather than a trajectory a human then
inspects.

## Open questions

- What N (particle count) and ensemble size balance origin-field fidelity against runtime
  for a live demo? Needs empirical tuning in Phase 4.
- Should seeding be weighted by damping ratio, or is uniform sampling within the mask
  adequate? Untested; uniform is the safe default.
- Can the ensemble be **calibrated** against the observed slick shape (Bayesian
  optimisation, [[P002]] / Accarino et al. 2025, +25% on MEDSLIK-II)? Recorded as a stretch
  goal, out of demo scope.
