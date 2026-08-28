# CONSTRAINTS

Project-specific constraints only. Generic engineering hygiene is assumed, not listed.

## Scientific integrity constraints

These come from `RESEARCH/SYNTHESIS.md` §7 and are the ones most likely to be violated
under demo pressure. **Each is a correctness requirement, not a style preference.**

| # | Constraint | Why | Violation looks like |
|---|---|---|---|
| C1 | **Age is never a bare scalar.** Always `{low, best, high}` + `age_method` | No reliable SAR→age regressor exists (`slick-age-estimation`) | UI showing "Age: 14 h" |
| C2 | **Damping ratio is relative, never an absolute thickness** | Thickness remote sensing is early-stage (NOAA/EGU) | "Thickness: 12 µm" |
| C3 | **A diffuse origin field must degrade to `insufficient_evidence`**, never force a suspect | Backward diffusion is irreversible; the field legitimately widens | Ranking a vessel #1 from a 400 km² origin contour |
| C4 | **Every suspect score decomposes into named terms with the geometry that produced them** | P002 challenge #3; the output is an accusation of a crime | A bare "87% match" |
| C5 | **Backward drift must be an ensemble**, never a single trajectory | P002 / Kampouris 2021 | One backward line on the map |
| C6 | **Use OpenDrift's built-in mixing**; never hand-roll diffusion | Nordam 2019: spurious accumulation becomes a false confident origin | A custom Gaussian random walk |
| C7 | **A raw AIS gap is not evidence** — normalise by expected reception density | GFW; reception varies hugely by region/vessel | Flagging every gap as "went dark" |
| C8 | **Look-alike FP count reported separately from mAP**, never folded in | P004's most operationally important result | A single headline accuracy number |
| C9 | **Wind gate is a continuous multiplier, surfaced in the UI**, not a silent hard cut | Band edges are soft and regionally variable | Detections silently disappearing |
| C10 | **Synthetic AIS ground truth is authored, never detector-derived** | P003's circularity | Auto-labelling with Isolation Forest then evaluating against it |
| C11 | **Do not cite P003's metrics or P001 refs [1]–[3]** | Unreliable / unverified (`CITATION_GRAPH`) | "Prior work achieves 0.85 mIoU" in the deck |

## Data constraints

| Constraint | Detail |
|---|---|
| **Sentinel-1 revisit** is ~6–12 days | A slick is observed once, not tracked across passes. No multi-temporal tracking in scope |
| **Free real AIS exists only for US waters** | Drives the dual-region design. Indian waters are synthetic by necessity, as the problem statement anticipates |
| **Zenodo masks are binary**; our scheme needs 2 foreground classes | Requires a relabelling pass — **the largest hidden cost in the plan** (PHASE-01/02) |
| **Krestenitis/MKLab is request-gated** | Cannot be a dependency. Request day one; proceed without it |
| **CMEMS resolution ~1/12°** is coarser than slick scale | Widens the origin field; must be reflected in the uncertainty interval, not hidden |
| **Forcing must be cached to local NetCDF** | Demo runs offline; CMEMS auth/quota is the top live-demo failure risk |

## Technical constraints

| Constraint | Detail |
|---|---|
| **Geocoding error < 1 px round-trip** | P004 §2.3: geometric correction is what makes SAR↔AIS matching valid. Any error propagates straight into proximity scoring. Asserted in Phase 1 tests |
| **SNAP must run in a Linux container** | `esa_snappy` on Windows is a known install hazard. Do not attempt native |
| **SAHI required for full scenes** | S1 IW scenes are far larger than 1024 px; downscaling loses small slicks |
| **Rotation augmentation forbidden on geocoded imagery** | Invalidates the pixel↔geo mapping. Mirroring only (as P004 used) |
| **Weights must declare their class scheme** | `backend/detect` refuses mismatched weights (`INTERFACES.md` §6) |
| **API is read-only** | No pipeline execution behind an HTTP request — demo reliability |

## Performance targets (demo scope, not production SLAs)

| Operation | Target | Basis |
|---|---|---|
| Detection on one full S1 scene | < 60 s | P004 reports 17 s with SAHI on an RTX 4090 |
| Backward ensemble (N particles × M members, 48 h) | < 5 min | Batch, offline; tune N and M in Phase 4 |
| Attribution scoring for one detection | < 10 s | Dominated by the PostGIS spatiotemporal gate |
| API response | < 500 ms | Read-only against precomputed results |
| Frontend: AIS points rendered | 50k+ without stutter | Why deck.gl over Leaflet |

Nothing expensive runs while a judge is watching. Phase 9 pre-seeds everything.

## Scope boundaries — explicitly out

| Excluded | Reason |
|---|---|
| Response robotics, USV/AUV coordination | P002 §4.2, out of scope |
| Remediation materials / sorbent manufacturing | P002 §4.3 |
| Pipeline failure forecasting, predictive maintenance | P002 §2.2 — prevention, not attribution |
| Toxicology, ESI, ecological impact scoring | Impact assessment, not detection/attribution |
| AIS-anomaly-triggered satellite tasking | P003's direction; the inverse of our problem statement |
| Blockchain spill reporting | P003 speculative future work |
| Learned drift surrogate | No evidence it beats the physics (P002) |
| Real-time streaming ingest | Forensic attribution is not real-time |
| Multi-scene slick tracking | Revisit interval makes it infeasible |

## Ethical and legal constraints

The system's output names specific vessels as suspected polluters. That carries real
consequences for real crews and operators.

1. **Never present a ranked suspect as a determination.** UI language is "candidate",
   "suspected", "score" — never "guilty", "responsible", "confirmed".
2. **Always show the score breakdown and caveats** alongside any name (C4).
3. **Always show the alternative hypotheses** — including infrastructure and dark vessels —
   not just the top-ranked vessel.
4. **`insufficient_evidence` must be visually prominent**, not buried (C3).
5. AIS may be commercially sensitive and state-restricted (P002 §2.1). Do not redistribute
   ingested AIS beyond the demo.
6. Vessel names in this repository (`BOCHEM LONDON`, `BRANDON BORDELON`) come from a
   published peer-reviewed paper's case studies and are used solely to validate the method
   against its stated ground truth.
