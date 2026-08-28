# PHASE-03 — Characterisation, geometry, and the wind gate

## Objective
Turn each instance mask into the quantitative description the problem statement asks for —
geometric properties, head/tail, damping ratio — and apply the wind gate that makes a
detection trustworthy.

## Why it exists
Problem-statement part (a) asks explicitly for "geometric properties". Beyond that, three
downstream consumers need this stage: the drift ensemble needs the mask footprint for
seeding, the attribution scorer needs the **head** point for `S_proximity`, and the wind
gate is the layer that keeps look-alikes from becoming accusations.

## Dependencies
PHASE-02 (masks). Wind gate additionally needs PHASE-04's met-ocean readers — build those
readers first if working strictly sequentially, or stub the wind sample and backfill.

## Files to create
```
backend/characterize/geometry.py    area, medial axis, widths, shape stats, head/tail
backend/characterize/damping.py     in-mask vs annulus sigma0 contrast
backend/characterize/age.py         morphology prior only (drift age arrives in PHASE-04)
backend/characterize/windgate.py    continuous confidence multiplier
tests/test_geometry.py
tests/test_windgate.py
```

## Implementation details

### Geometry
From the instance mask, in a locally appropriate equal-area projection (never compute area
in EPSG:4326 degrees):
- `area_km2`
- **medial axis** via `skimage.morphology.medial_axis` / skeletonisation → `length_km`
- `width_m_profile` sampled perpendicular to the axis; `width_m_mean`
- `orientation_deg`, `elongation`, `compactness`, convex-hull deficiency
- `fragmentation` = connected part count

### Head and tail — the important one
Cerulean's method: **perimeter points far enough from the centreline to be a plausible
origin**, taking the extremes at each end of the medial axis.

Cerulean's redesign is the lesson to copy: scoring spread evenly along the perimeter
misattributed spills to infrastructure sitting in the slick's *middle*, where oil had merely
drifted. Concentrating score at the **tail ends** lifted top-1 accuracy from ~60% to ~90%.
**Where along the slick you look matters more than how you weight distance.**

Orientation (which end is head vs tail) is genuinely ambiguous from geometry alone. Emit
both, and let the drift field in PHASE-04 disambiguate.

### Damping ratio
Mean σ0 (dB) inside the mask vs mean σ0 in a surrounding annulus, with a stand-off buffer to
avoid the boundary gradient.

**Reporting rules (C2):** relative contrast index only; `damping_confidence` is always
`"low"`; **never** converted to an absolute thickness in microns. Uses: within-slick
relative thickness map, optional drift-seeding weight, weak look-alike tiebreak.

### Wind gate (C9)
Sample ERA5/CMEMS wind at the detection centroid at acquisition time.
- Below ~3 m/s: insufficient Bragg roughness for oil to suppress — the sea is already dark
- Above ~10–12 m/s: wind mixes oil down and re-roughens the surface

**Implement as a continuous multiplier in [0,1], not a hard cut.** Band edges are soft and
regionally variable, and P002 challenge #2 warns against assuming they transfer. Surface
`wind_speed_ms` on the evidence card so a detection at 2.1 m/s visibly carries lower
confidence rather than silently vanishing.

Foundational citation: Espedal 1999, *Satellite SAR oil spill detection using wind history
information*.

### Age at this stage
Morphology prior only (Fay-spreading-consistent width growth). The real estimate comes from
drift convergence in PHASE-04. Emit `{low, best, high}` + `age_method` from the start —
never a bare scalar (C1).

Worth noting for later: for a linear OOS from a moving vessel, the along-slick width
gradient **is** an age gradient — the slick is a time series laid out in space. P004 Case 2
observed exactly this ("the width of the head and tail showed distinct changes"). Recorded
as a stretch goal, not demo scope.

## Inputs / outputs
- In: `Detection` mask + the σ0 raster + a wind field
- Out: `Characterisation` row (`INTERFACES.md` §2)

## Relevant interfaces
`INTERFACES.md` §1 (`characterize`), §2 (`Characterisation`).

## Relevant research
`RESEARCH/topics/slick-age-estimation.md` (why age is handled this way);
`RESEARCH/topics/lookalike-discrimination.md` (Layer 3, wind gate);
`RESEARCH/topics/ais-attribution-and-scoring.md` (Cerulean head/tail method).

## Tests
- Geometry on synthetic shapes with analytically known area/length/orientation.
- Area computed in an equal-area projection, not degrees (regression guard).
- Head/tail on a synthetic elongated blob lands at the extremes.
- Wind gate multiplier is monotonic and continuous at the band edges.
- `age_hours` is never returned as a scalar (type-level guard).

## Acceptance criteria
- [ ] Area and length within **5%** of manual QGIS measurement on 3 hand-checked slicks
- [ ] Case 2 length ~19 km, Case 1 ~5.5 km, Case 3 ~5 km (P004-reported)
- [ ] Head within 1 km of each paper-stated source tip across the three cases
- [ ] Wind gate demonstrably suppresses a known low-wind false positive
- [ ] `damping_confidence == "low"` on every record
- [ ] `age_hours` always a triple with `age_method`

## Known failure conditions
- Skeletonisation spurs on ragged masks → prune short branches before measuring length.
- Multipart slicks: which part's head? → per-part characterisation, aggregate at the
  detection level.
- Annulus overlapping land or another slick → mask both out before computing damping.
- Wind field temporal resolution (hourly) vs acquisition instant → nearest-neighbour in
  time is adequate; record the offset.
