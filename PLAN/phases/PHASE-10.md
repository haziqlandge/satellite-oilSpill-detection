# PHASE-10 — Bonus: national coverage (Indian coastline)

> **GATED.** Do not start this phase until PHASE-01 through PHASE-09 are complete and the
> demo runs end-to-end. This is scope expansion, and expanding scope before the core works
> is the most reliable way to finish with neither. Explicit user instruction, 2026-08-28:
> *"we do this only after our current scope works out."*

## Objective
Extend the pipeline beyond the two demo regions to additional Indian maritime zones, so the
system reads as a national capability rather than a single-site demonstration.

## Why it exists
The core scope validates on the Gulf of Mexico (real AIS, published ground truth) and
demonstrates on one Indian region with synthetic AIS. For an NTRO-facing deliverable, the
natural question is *"does this cover our coastline?"* — this phase answers it, but only
once the answer is worth giving.

## Entry criteria — all must hold
- [ ] PHASE-08 acceptance met: all three P004 cases resolve correctly
- [ ] PHASE-09 demo runs offline, end-to-end, from a clean clone
- [ ] No open correctness issues in detection, drift or attribution

If any is unmet, work on that instead. This phase adds breadth, not capability.

## Candidate regions

Prioritised by oil-spill risk and data availability, not by coastline length.

| Zone | Why | Notes |
|---|---|---|
| **Gulf of Kutch / Kandla** (Gujarat) | Highest tanker density in India; Vadinar and Sikka crude terminals; ecologically sensitive marine national park | Likely the strongest second region |
| **Mumbai High** (offshore Maharashtra) | Dense **offshore platform** cluster + heavy traffic | Exercises the infrastructure branch of the collation score, mirroring P004 Case 1 |
| **Chennai / Ennore** (Tamil Nadu) | Site of the January 2017 Ennore collision spill; **published INCOIS trajectory studies exist** | Best cross-check for the drift engine against an independent operational model |
| **Paradip / Haldia** (Odisha, West Bengal) | Major crude terminals; Bay of Bengal cyclone regime | Tests drift under very different forcing |
| **Kochi / Vizhinjam** (Kerala) | Refinery outfall + a new transhipment hub | Lower priority |
| **Andaman & Nicobar approaches** | Strategic shipping lanes, sparse AIS coverage | Good **dark-vessel** test case; poor validation data |

## Implementation notes

Most of the work is configuration and data, not new code — the pipeline is already
region-agnostic by design. What actually changes:

1. **AOI registry** — promote hard-coded demo regions to a config file
   (`config/regions.yaml`): bounding box, CRS hint, forcing product, infrastructure layer.
2. **Forcing coverage** — CMEMS global products cover Indian waters, but resolution and
   skill differ from the Gulf of Mexico. Cross-check against **INCOIS OOSA** (NOAA GNOME,
   Indian Ocean domain) where a comparable event exists.
3. **Infrastructure layer** — the SAR Fixed Infrastructure Dataset must be verified for
   Indian offshore platforms. **Gaps here turn a platform leak into a false vessel
   accusation** — surface coverage status as a caveat on every evidence card in the region.
4. **Synthetic AIS per region** — realistic traffic density and vessel-type mix per zone.
   A scenario with sparse traffic does not test the filtering that matters.
5. **Wind-gate thresholds** — the 3 and 10–12 m/s bounds come from studies in other basins.
   **Indian monsoon wind climatology is materially different** and the bounds may not
   transfer (`RESEARCH/topics/lookalike-discrimination.md`, open question). Re-derive or at
   minimum re-validate per region; do not silently reuse.

## The honest limitation to state up front

P002's challenge #2 — models trained in one region fail in another due to differing
hydrodynamics, sensor characteristics and oil weathering — is named in that review as the
**highest-priority** open problem in the field.

Adding synthetic scenarios in more Indian zones tests **the pipeline's logic**, not the
detector's transfer to real Indian SAR imagery. Genuine national coverage requires real
Sentinel-1 scenes with confirmed Indian spills, labelled. Until that exists:

> **Claim:** "the pipeline operates over these zones."
> **Do not claim:** "detection accuracy generalises to Indian waters."

That distinction must appear in the demo and any write-up.

## Acceptance criteria
- [ ] Region registry drives all AOI-dependent behaviour; no hard-coded extents remain
- [ ] At least two additional zones configured end-to-end with authored scenarios
- [ ] Infrastructure coverage verified per zone, gaps surfaced as evidence-card caveats
- [ ] Wind-gate bounds re-validated per zone, or explicitly flagged as unvalidated
- [ ] Ennore drift cross-checked against a published INCOIS trajectory, if obtainable
- [ ] Generalisation limitation stated explicitly in the demo and README

## Known failure conditions
- Scope creep displacing core fixes — re-read the entry criteria.
- Sparse AIS coverage in remote zones producing spurious "dark vessel" candidates: with low
  expected reception, *everything* looks dark. The GFW reception-density normalisation
  (PHASE-05) is what prevents this, and it must be recalibrated per region.
- Presenting synthetic-scenario success as evidence of real-world Indian performance.
