# PHASE-06 — Attribution engine

## Objective
Filter irrelevant traffic, score candidate polluters on six explainable terms, collate
vessels against infrastructure onto one scale, and emit an evidence card per suspect.

## Why it exists
This is problem-statement part (c) and the point where the whole system's claim is settled.
It is also where the project's novelty lives: **`S_drift`**, conditioning attribution on the
physical backward-drift field rather than on slick geometry as a proxy.

## Dependencies
PHASE-04 (origin field), PHASE-05 (AIS tracks + behaviour), PHASE-02 (CFAR for dark
vessels), PHASE-03 (head/tail).

## Files to create
```
backend/attribute/candidates.py   spatiotemporal gating; dark vessels; infrastructure
backend/attribute/features.py     the six S_* terms
backend/attribute/scoring.py      weighting, collation, ranking
backend/attribute/evidence.py     evidence card assembly
backend/attribute/weights.py      explicit, documented, version-stamped weights
tests/test_features.py, tests/test_scoring.py, tests/test_fixtures_p004.py
```

## Implementation details

### Stage 1 — candidate generation (filtering irrelevant traffic)
Order matters for cost:

1. **Spatiotemporal gate on `origin_field`** — keep tracks with points where
   `P(lat, lon, t)` exceeds a threshold, **at the matching backward time**. This is the
   primary filter and the physically-motivated one; it removes the overwhelming majority of
   traffic in a single step. This is what the problem statement means by filtering
   irrelevant traffic.
2. Outer time bound: Cerulean's **−8 h / +6 h** around acquisition for fresh slicks,
   extended to the full backward horizon for legacy slicks.
3. **Dark vessels** — CFAR bright targets with no AIS match within tolerance;
   Cerulean's rules: **> 30 m** estimated length, high confidence, **≤ 50 km**.
4. **Infrastructure** — from the SAR Fixed Infrastructure Dataset.

### Stage 2 — the six terms, each in [0,1] and independently reportable

| Term | Definition | Origin |
|---|---|---|
| `S_drift` | agreement between the track and the origin field at matching times | **ours** |
| `S_parity` | slick length vs its projection on the AIS track (parallelism) | Cerulean |
| `S_proximity` | `exp(-d / lambda)`, d = slick **head** → nearest track point, decay ≈ 4.0 | Cerulean |
| `S_temporality` | recency weighting toward acquisition time | Cerulean |
| `S_behaviour` | rules + Isolation Forest composite (PHASE-05) | P003 + GFW |
| `S_prior` | vessel type/size prior (tanker, bulk > fishing); draught change | P004, domain |

**Open design question (`SYNTHESIS` §9 Q3):** should `S_drift` be the **max** over track
points, or an **integral** of the track through the field? The integral rewards a vessel
that *lingered* in the high-probability region and is likely better for Case 3.
**Implement both, and let the Case 3 fixture decide.**

### Stage 3 — collation and ranking
Weighted combination, then normalise vessels, dark vessels and infrastructure onto one
**collation score** (Cerulean) so source types compete fairly. P004's Case 1 — platform
leak, no vessel within 5 km — must fall out of this naturally rather than via a special case.

**Weights are hand-set and documented in `weights.py`, not fitted.** We have three
ground-truth cases; fitting six weights on three cases is overfitting
(`SYNTHESIS` §9 Q4). Report sensitivity instead.

### Stage 4 — evidence card (C4, non-negotiable)
Per `INTERFACES.md` §2. Each suspect must expose: all six term values **and** their weights;
the geometry that produced each term; the matched track segment; the origin-window overlap;
anomaly flags **with their raw series**; caveats (e.g. "wind 2.1 m/s — below gate"); a
thumbnail.

P002 challenge #3: opaque models are "difficult for emergency personnel to evaluate…under
high-stakes, time-critical conditions". Here the output is an accusation of an environmental
crime. A bare score is not an acceptable artefact.

Also required (C3): when the origin field is too diffuse, return **`insufficient_evidence`**
with the contour area, not a forced ranking.

## Inputs / outputs
- In: `DriftRun` (origin field), AIS tracks + behaviour, CFAR targets, infrastructure
- Out: `candidates` + `scores` rows with embedded evidence cards

## Relevant interfaces
`INTERFACES.md` §1 (`attribute`), §2 (`Candidate`, `SuspectScore`, `EvidenceCard`),
§3 (`/detections/{id}/suspects`, `/suspects/{id}/evidence`).

## Relevant research
`RESEARCH/topics/ais-attribution-and-scoring.md` (the whole note);
`RESEARCH/papers/P004.md` (the three cases, §3.7 prior art);
`RESEARCH/SYNTHESIS.md` §4, §8.

## Tests
- Each `S_*` term: monotonic in its driving variable; bounded to [0,1]; sane at degenerate
  inputs (zero-length track, single AIS point, empty origin field).
- `S_proximity` decay matches `exp(-d/4.0)` at known distances.
- Collation places a vessel and a platform on a comparable scale.
- Gating on a synthetic origin field admits exactly the intended tracks.
- **`test_fixtures_p004.py`** — the three real cases (below).

## Acceptance criteria

| Case | Expected top-1 | Tests |
|---|---|---|
| 1 (2023-04-09) | **Infrastructure** | Collation ranks infrastructure above vessels when none is within 5 km |
| 2 (2023-05-15) | **BOCHEM LONDON** | The straightforward moving-vessel case |
| 3 (2023-12-05) | **BRANDON BORDELON** (berthed since 3 Dec) | **The adversarial case** |

- [ ] All three cases return the correct top-1
- [ ] Score separability reported per case
- [ ] **Case 3 term-ablation run:** scoring with `S_drift` removed drops the true source in
      rank. *This single comparison is the cleanest evidence for the project's central claim
      and must be recorded.*
- [ ] Both `S_drift` variants (max vs integral) evaluated; the choice recorded with its reason
- [ ] All five synthetic Indian-waters scenarios resolve correctly, **including the null case
      naming nobody**
- [ ] Every suspect exposes all six terms with weights and geometry
- [ ] A deliberately diffuse origin field yields `insufficient_evidence`
- [ ] Scoring completes in < 10 s per detection

## Known failure conditions
- **Case 3 is genuinely hard.** Cerulean's parity and proximity both fail on it — the vessel
  was stationary and its track does not parallel the slick. If `S_drift` + `S_behaviour`
  cannot carry it, revisit the `S_drift` formulation (integral over max) before touching
  weights. Do not tune weights to force a fixture to pass.
- Dark-vessel candidates have no identity — rank them but never name them.
- MMSI reassignment/spoofing means a "vessel" may not be one vessel.
- Infrastructure dataset incompleteness → a missing platform becomes a false vessel
  accusation. Surface infrastructure-coverage status as a caveat on the card.
- Over-tight gating drops the true source before scoring → test recall of the gate itself,
  not just final ranking.
