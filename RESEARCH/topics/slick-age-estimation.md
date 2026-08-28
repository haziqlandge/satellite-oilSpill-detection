# Topic — Slick age and thickness estimation

Sources: web research (NOAA ORR, EGU/Copernicus presentations, damping-ratio literature),
[[P004]] Sec. 3.8, [[P002]], [[drift-modelling-and-hindcasting]].

The problem statement asks to characterise the spill "and age **if feasible**". That
qualifier is well placed. This note records what is and is not defensible, so that later
sessions do not over-claim.

## The honest finding

**There is no reliable direct SAR-to-age regressor in the literature.**

What exists is a chain of weak inferences:

```
SAR backscatter contrast  ->  damping ratio  ->  relative thickness  ->  (weakly) age
        measurable            derived           early-stage             not established
```

Each arrow loses information:

- **Damping ratio** (contrast between clean-sea and in-slick backscatter) is used
  operationally and can *sometimes* identify relatively thicker regions within a slick. It
  is a **relative, within-scene** measure, not an absolute thickness.
- Thickness remote sensing overall is described by NOAA and EGU sources as at an **early
  development stage**. Thermal-infrared and multi-sensor methods do better than SAR but need
  sensors we do not have.
- Thickness does not map cleanly onto age anyway: it depends on release volume, oil type,
  emulsification state, sea state and dispersion — several of which are unknown at
  detection time.

Additionally, [[P002]] notes that weathering processes change the detection signal itself
(Garcia-Pineda et al. 2020), so the observable is a function of age, oil type and
conditions jointly — not of age alone.

**Conclusion: do not build or claim a SAR-to-age model.** Anyone presenting a single
"slick age: 14 hours" number derived from imagery alone is over-claiming.

## What *is* defensible: age from backward-drift convergence

The physically-grounded estimate falls out of the machinery we are already building for
part (b).

**Method.** Run the backward ensemble ([[drift-modelling-and-hindcasting]]). At each
backward timestep, measure the **spatial concentration** of the particle cloud. Two
signals identify the release time:

1. **Convergence minimum.** A slick released as a point or short line and then advected and
   diffused should, run backward, contract toward its release geometry before diffusion
   dominates and it re-spreads. The timestep of maximum concentration is the release-time
   estimate.
2. **Source coincidence.** The backward timestep at which the origin field's high-probability
   region **intersects a candidate source** (a vessel track point, or fixed infrastructure)
   is a second, independent estimate — and it is the one that matters operationally, because
   it is the same quantity the attribution scorer needs.

**Uncertainty comes for free.** The ensemble spread at that timestep *is* the confidence
interval. Report `{low, best, high}` in hours, never a bare number.

**Honest limit.** Diffusion is irreversible; running a diffusive process backward spreads
rather than focuses. So the convergence minimum can be shallow or absent for older slicks,
and beyond roughly 24–48 h the estimate degrades to "older than the horizon". That is a
legitimate answer and must be reportable as such.

## Secondary cross-check: morphology

A weak independent prior, useful only to sanity-check the drift estimate:

- **Fay spreading** — gravity-viscous spreading gives an expected width-versus-time growth
  for a free slick. A slick much wider than a fresh release would be is probably older.
- **Elongation and fragmentation.** [[P004]]'s class scheme already encodes a version of
  this: fresh, vessel-linked OOSs are **linear and narrow**; older slicks become
  **irregular, broken and multipart**. Cerulean similarly scores "size, compactness,
  elongation, and multipart structure" in its slick-confidence model.
- **Head/tail width differential.** [[P004]] Case 2 explicitly notes "the width of the head
  and tail showed distinct changes" over the 19 km slick — consistent with a continuously
  discharging vessel laying oil that then spreads with time-since-release along its length.
  **The along-slick width gradient is itself an age gradient.**

That last point is worth noting: for a linear OOS from a moving vessel, the slick is a
*time series laid out in space*. The tail is oldest, the head youngest (or vice versa
depending on transit direction). This is a genuinely useful structure and it is directly
observable from an instance mask.

## Damping ratio — what we will actually compute

Worth computing despite its weakness, because it is nearly free and useful as a **relative**
descriptor and a look-alike tiebreak ([[lookalike-discrimination]]).

**Definition:** mean Sigma0 (dB) inside the instance mask versus mean Sigma0 in an annulus
of clean sea surrounding it, at a stand-off distance to avoid the boundary gradient.

**Rules for reporting it:**
- Present as a **relative contrast index**, never as an absolute thickness in microns
- Attach an explicit low-confidence flag
- Use it for: within-slick relative thickness maps; weighting drift-particle seeding toward
  thicker regions; a weak look-alike discriminator (very weak contrast favours a biogenic film)
- Do **not** use it for: absolute volume estimates, or as the primary age signal

## What we report

The characterisation output for each detection carries:

| Field | Method | Confidence |
|---|---|---|
| `area_km2` | instance mask + geocoding | high |
| `length_km`, `width_m` profile | medial axis / skeletonisation | high |
| `orientation`, `elongation`, `compactness`, `fragmentation` | shape statistics | high |
| `head` / `tail` points | perimeter points far from centreline (Cerulean method) | medium |
| `damping_ratio` | in-mask vs annulus Sigma0 | **low — relative only** |
| `age_hours` `{low, best, high}` | **backward-drift convergence** | medium, with interval |
| `age_method` | `drift_convergence` \| `source_coincidence` \| `beyond_horizon` | — |
| `wind_speed_ms` at acquisition | ERA5/CMEMS sample | high (used by the wind gate) |

`age_hours` is **never emitted as a scalar** and is always accompanied by `age_method`.

## Relation to [[P004]]'s future work

[[P004]] Sec. 3.8 item 1 proposes classifying OOSs by **temporal state** rather than
estimating a continuous age:

1. **ongoing discharge** — directly linked to a vessel still present
2. **recent discharge** — slick detached, source vessel still nearby
3. **legacy slick** — source long departed

This is a more honest target than a continuous regression, and it maps naturally onto our
drift output: the state is determined by *where in the backward field a candidate source
first appears*, not by imagery. **Adopt this three-state label as the headline age product,
with the continuous interval as supporting detail.**

## Open questions

- How sharp is the convergence minimum in practice for a 19 km slick over 12–24 h of
  backward integration? Unknown until Phase 4; this is the main risk to the age deliverable.
- Can the along-slick width gradient be calibrated into a relative age gradient, giving an
  age *profile* rather than a single number? Attractive and novel, but unvalidated —
  record as a stretch goal.
- Is the three-state classification better learned from the mask directly (a third head on
  the detector) or derived from the drift output? Derived is more interpretable and needs no
  new labels. Start there.
