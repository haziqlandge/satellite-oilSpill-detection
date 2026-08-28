# PHASE-05 — AIS pipeline and synthetic generator

## Objective
Ingest real AIS (Gulf of Mexico), generate schema-identical synthetic AIS (Indian waters),
build queryable vessel trajectories in PostGIS, and compute behavioural features.

## Why it exists
Part (c) requires reconstructing vessel traffic around the origin window. This phase makes
that traffic queryable and gives the scorer its behavioural evidence. The synthetic
generator exists because free real AIS covers US waters only, which the problem statement
explicitly anticipates.

**This phase is independent of PHASE-02/03/04 and can be built in parallel.**

## Dependencies
PHASE-00. Needs PHASE-04's origin field only at PHASE-06 integration time.

## Files to create
```
backend/ingest/ais/loader.py        marinecadastre Zstd CSV -> normalised records
backend/ingest/ais/clean.py         dedupe, impossible-jump removal, resampling
backend/ingest/ais/trajectory.py    per-MMSI LINESTRING M in PostGIS
backend/ingest/ais/synthetic.py     Indian-waters generator (identical schema)
backend/ingest/ais/behaviour.py     speed drop, course deviation, loitering, gaps
backend/ingest/ais/gaps.py          gap normalisation by expected reception density
tests/test_ais_clean.py, tests/test_synthetic_ais.py
```

## Implementation details

### Schema (fixed — `INTERFACES.md` §5)
```
MMSI, BaseDateTime, LAT, LON, SOG, COG, Heading,
VesselName, IMO, CallSign, VesselType, Status,
Length, Width, Draft, Cargo, TransceiverClass
```
**Both the real loader and the synthetic generator emit this exact schema**, so one
downstream path serves both regions and the synthetic path is validated by the real one.

### Cleaning
Drop duplicate `(MMSI, BaseDateTime)`; drop physically impossible jumps (implied speed above
a threshold); drop null/sentinel positions (`91.0`/`181.0`); normalise `COG`/`Heading`
sentinels (`360`/`511`). Resample to 1-minute (marinecadastre is already 1-minute filtered).
Build `LINESTRING M` with the M ordinate carrying epoch seconds, so a spatiotemporal query
is a single PostGIS operation.

Index: GiST on geometry, BRIN on `base_date_time`.

### Synthetic generator (Indian waters)
Regions: **Gulf of Kutch**, **Mumbai High** (offshore platforms + dense traffic),
**Ennore/Chennai** (a real 2017 spill site with published INCOIS trajectory studies).

Recipe adapted from P003 — noise injection into normal trajectories, abrupt speed changes,
irregular routing, Gaussian and time-series perturbation — with **one correction**:

> **Ground truth is authored, never detector-derived (C10).** P003 auto-labelled anomalies
> with Isolation Forest and then evaluated against those labels — circular. Our sidecar
> records the scripted discharging MMSI, release time and release position, written by us.

Scenarios to author (mirroring the P004 fixtures so both regions test the same logic):
1. Moving tanker, continuous discharge — Case 2 analogue
2. Berthed/anchored vessel discharge — **Case 3 analogue, the adversarial one**
3. Platform leak with vessels transiting nearby — Case 1 analogue; tests traffic filtering
4. **Dark vessel** — discharger with AIS off; appears only as a CFAR bright target
5. **Null case** — a look-alike, no spill; the system must name nobody

Realistic background traffic density matters: a scenario with three vessels does not test
filtering. Target realistic vessel counts for the region.

### Behavioural features
Per track, over a configurable window: speed drop, course deviation, ROT spikes, loitering
(low SOG over time), draught change, distance from a historical route.
Feature set from P003: `SOG, COG, ROT, Heading, Draught` + position + time.

**Isolation Forest** trained on normal traffic as the unsupervised baseline — correct family
here because **labelled polluter behaviour does not exist**. Combine with explicit rules so
the score remains explainable (C4); a raw isolation score alone is not inspectable evidence.

### AIS gaps — handle with care (C7)
Global Fishing Watch's method (Welch et al. 2022): model **how often a vessel's signal
should be received** first, then classify gaps as intentional vs satellite-coverage
artefacts. Reception density varies enormously by region and vessel class, and GFW documents
legitimate reasons to go dark (piracy avoidance).

**A raw gap is not evidence.** Normalise by expected reception rate before treating a gap as
anomalous, and always surface the raw gap plus the expected rate on the evidence card.

## Inputs / outputs
- In: marinecadastre Zstd CSVs; synthetic scenario configs
- Out: `ais_points`, `ais_tracks` in PostGIS; behavioural features; synthetic ground-truth
  sidecars

## Relevant interfaces
`INTERFACES.md` §5 (AIS contract), §2 (`Candidate`), §3 (`/vessels/{mmsi}/track`).

## Relevant research
`RESEARCH/topics/ais-attribution-and-scoring.md`;
`RESEARCH/topics/datasets-and-data-access.md` §3;
`RESEARCH/papers/P003.md` (features, anomaly baselines, the circularity to avoid).

## Tests
- Cleaning removes a known impossible jump; keeps a legitimate fast transit.
- Sentinel values (`91.0`, `181.0`, `360`, `511`) handled, not ingested as data.
- Trajectory build round-trips: points → LINESTRING M → points.
- Spatiotemporal query returns the expected vessels for a synthetic box+window.
- **Synthetic output validates against the same schema and loader as the real data**
  (the key test — it is what makes the synthetic path trustworthy).
- Gap detection does not flag a gap explained by low expected reception.

## Acceptance criteria
- [ ] marinecadastre data for 2023-04-09, **2023-05-15**, 2023-12-05 loads cleanly
- [ ] **`BOCHEM LONDON` queryable by name**, track present in the acquisition window
- [ ] **`BRANDON BORDELON` queryable**, and its mooring at 18:59:12 UTC 2023-12-03 is
      visible as a loitering/berthed signal
- [ ] Synthetic generator produces all five Indian-waters scenarios with authored ground truth
- [ ] Synthetic records pass the real loader unchanged
- [ ] Spatiotemporal query over a full fixture day returns in < 2 s
- [ ] Gap detection normalised by expected reception density

## Known failure conditions
- MMSI is not a stable vessel identity (reassignment, spoofing) → prefer IMO where present;
  record both.
- Vessel metadata (`VesselName`, `Length`) is often missing or wrong in AIS → treat as
  optional; never let a missing name break scoring.
- Zstd decompression memory on full-day national files → stream, do not load whole.
- Synthetic traffic too sparse to exercise filtering → check density against the real GoM
  day before trusting scenario results.
