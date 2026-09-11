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
| C12 | **The demo must degrade gracefully without network** | Amended from "runs fully offline". The database is hosted, so a snapshot export plus a `DEMO_OFFLINE=1` read path is now the mechanism (PHASE-09). Venue wifi must not be a single point of failure | Discovering on demo day that nothing loads |

## Data constraints

| Constraint | Detail |
|---|---|
| **Sentinel-1 revisit** is ~6–12 days | A slick is observed once, not tracked across passes. No multi-temporal tracking in scope |
| **Free real AIS exists only for US waters** | Drives the dual-region design. Indian waters are synthetic by necessity, as the problem statement anticipates |
| **Zenodo masks are binary**; our scheme needs 2 foreground classes | Requires a relabelling pass — **the largest hidden cost in the plan** (PHASE-01/02). **"Binary" means after a correct threshold, not as stored** (measured 2026-08-30): the masks are **RGB** with three identical channels, and ~28% of them carry a lossy-compression halo of intermediate values. Thresholding at `> 0` bridges neighbouring slicks into one instance — a corrupted instance-segmentation label. Threshold at **half the observed maximum** (not a fixed 128, which would empty a `{0,1}` mask). Handled in `relabel.binarise`; any other mask loader must do the same |
| **Krestenitis/MKLab is request-gated** | Cannot be a dependency. Request day one; proceed without it |
| **CMEMS resolution ~1/12°** is coarser than slick scale | Widens the origin field; must be reflected in the uncertainty interval, not hidden |
| **Forcing must be cached to local NetCDF** | CMEMS auth/quota is a top live-demo failure risk |
| **Database is hosted (Supabase)** | Decision 2026-08-28. The pipeline now requires network. See the amended offline rule below and `scripts/SETUP_DATABASE.md` |
| **AIS must be clipped at ingest** | Supabase free tier is 500 MB / Pro 8 GB. Clip to the AOI bbox and acquisition window *before* insert; keep raw CSVs on local disk. **Clipping alone is not sufficient — measured 2026-08-30.** Over the three Case 1 days, AOI + 48 h window reduces 25,273,138 national rows to 2,955,407: a **9×** reduction, not the ~1000× this constraint implicitly assumed. At ~250 B/row with the GIST index that is ~700 MB for **one** fixture case, against a 500 MB ceiling |
| **Only `ais_tracks` is inserted; `ais_points` is not populated for real AIS** | **Decided with the user 2026-08-30**, following the measurement above. One `LINESTRING M` row per vessel (~2,172/case, ~70 MB) replaces 2.9 M point rows (~700 MB), so all three fixture cases fit the free tier. This is also the *designed* query path: the M ordinate carries epoch seconds, so a spatiotemporal gate is a single PostGIS operation without joining a point table (`INTERFACES.md`, `PHASE-05`). Raw CSVs and the clipped subset stay on local disk under `data/raw/`, so nothing is lost — `ais_points` can still be populated for a narrow window if PHASE-06 or PHASE-07 ever needs per-message detail |

## Technical constraints

| Constraint | Detail |
|---|---|
| **Geocoding error < 1 px round-trip** | P004 §2.3: geometric correction is what makes SAR↔AIS matching valid. Any error propagates straight into proximity scoring. Asserted in Phase 1 tests |
| **SNAP must not be driven through `esa_snappy` on Windows** | **Amended 2026-08-29.** Originally "SNAP must run in a Linux container", justified by `esa_snappy` being a known Windows install hazard. That hazard is specific to the *Python bindings*. `graphs/s1_grd_preprocess.xml` is a **GPT graph** run by `gpt`, a plain Java CLI with no Python binding involved, so `backend/ingest/sar/preprocess.py` invokes it by subprocess natively (SNAP 14, `winget install EuropeanSpaceAgency.SNAP`). The intent — never fight `esa_snappy` on Windows — is preserved. **Reason for the change:** Supabase removed the database's need for Docker, Docker Desktop would not start on the training machine, and `docker/ingest.Dockerfile` had already been deleted, so a container bought nothing but a blocker. Revert to a container if a Linux runner ever becomes the target |
| **σ0 is converted to dB last, after speckle filtering and terrain correction** | **Recorded 2026-08-30**, decided with the user. Deviates from the literal chain order in P004 §2.3 (calibrate-to-dB, *then* Refined Lee). **Reason:** (a) speckle is multiplicative in the **linear** domain, which is what Refined Lee's coefficient-of-variation model assumes — a log transform makes the noise additive and invalidates the filter; (b) Terrain-Correction resamples, and averaging radar power linearly is the correct arithmetic mean, whereas averaging in dB is a geometric mean that biases interpolated pixels low; (c) the Zenodo corpus is σ0 in dB, so the final product must be dB or the model would infer on a different quantity than it trained on. **P004's order was never actually running:** measured 2026-08-30 on the Case 1 fixture, `Calibration` with `outputImageScaleInDb` `true` vs `false` is byte-identical — SNAP silently ignores the flag — so Refined Lee has always received linear input. What was missing was any dB conversion at all. Implemented as a `LinearToFromdB` node before `Write` in `graphs/s1_grd_preprocess.xml` |
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

**Amended 2026-08-28 (Supabase).** Every figure above now includes a network round trip to
a hosted database. Query latency depends on region choice, and a free-tier project waking
from pause can take seconds on the first connection. `DB_CONNECT_TIMEOUT` defaults to 15 s
for this reason. Measure against the real instance before treating these targets as met.

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


## Machine limits (added 2026-08-31, set by the user)

This runs on a laptop the user also works on. These are operational constraints, not
preferences, and a run that breaches them is a defect regardless of its results.

| Resource | Limit | How |
|---|---|---|
| **CPU** | **80% ceiling**; current mask is 16/24 E-cores (67%) | `cap_cpu()` in `ml/train/train.py`, applied **in-process before the dataloader workers spawn** |
| **RAM** | **24 GB hard, machine-wide** | `RAM_CEILING_GB` in `ml/train/train.py`. An absolute figure since 2026-09-01, not a fraction |
| **GPU** | **about 80%, training process only** | `GPU_MEMORY_FRACTION = 0.80` plus `GPU_COMPUTE_FRACTION = 0.80` in `ml/train/train.py` |
| **Temperature** | **pause at 90 C**, resume at 80 C | GPU guard plus post-epoch CPU checks in Armoury Crate |

### Temperature: 90 C, with Armoury Crate CPU supervision

The user set **90 C** for both CPU and GPU, with resume at **80 C**. During the completed
`L2-ciou` run, post-epoch CPU readings sometimes reached 90–96 C. Only the training process
tree was paused; it resumed after the CPU cooled to 80 C or below. GPU stayed below the
ceiling, with a highest observed post-epoch reading of 78 C in the final stretch.

> **The shell guard cannot read the CPU die on this laptop.** Its log correctly records
> `cpu_available: false` and therefore automates the GPU limit only. CPU temperature must be
> read from Armoury Crate after each completed epoch; if it is at or above 90 C, pause the
> exact training tree and resume only at 80 C or below. A missing sensor remains `null`, never
> a cold reading.

### CPU: corrected 2026-09-01 after the user saw 100% again

The 2026-08-31 diagnosis — *"affinity alone does not cap CPU"* — **was wrong**, and acting on
it left the real cause in place. A process tree pinned to 19 of 24 cores cannot exceed
19/24 = 79% machine-wide, however many threads it spawns. That is arithmetic.

Three things were actually wrong, measured:

| Cause | Why it was invisible |
|---|---|
| **OpenCV was never capped** | It keeps its **own** thread pool, not governed by `OMP_NUM_THREADS`. It defaulted to **24 threads in every dataloader worker** — and the workers are where all decode, resize and mosaic work happens. This was the real source |
| **`cap_cpu.ps1` cannot reach the workers** | It only touches processes alive when it runs. Dataloader workers spawn *afterwards*, so the processes doing the work were never capped. The script is structurally incapable of the job, not merely mis-run |
| **`cap_cpu_threads` overrode the environment upward** | `CPU_FRACTION = 0.50` set 12 torch threads, silently discarding an exported `OMP_NUM_THREADS=8` |

The fix is `cap_cpu()`, called **in-process, before the workers exist**, because Windows
children inherit the parent's affinity mask. OpenCV also sizes its pool from that mask
(measured: 24 threads before, 19 after), so pinning fixes it as well; it is set explicitly
too, and `cap_worker_threads()` patches ultralytics' `seed_worker` so each worker caps its
own pool. **That hook must be a module-level function** — Windows pickles `worker_init_fn`
by qualified name and a closure dies with `Can't get local object` before the first batch.

Measured on the same configuration, before → after: **CPU max 93.1% → 67.6%**, mean
30.6% → 22.7%, and GPU utilisation *rose* 60.7% → 69.6%.

### CPU placement: a percentage is not enough, the core *type* matters

**Added 2026-09-01 after the user reported high temperature at low utilisation.**

A utilisation cap says how much CPU is used. It says nothing about *which* cores, and on a
hybrid part that is the difference between 92 C and something survivable. Read from
`GetLogicalProcessorInformationEx` on this Core Ultra 9 275HX (24 cores, no SMT):

```
P-cores  0, 1, 10, 11, 12, 13, 22, 23
E-cores  2-9, 14-21
```

**The core types are interleaved, so assuming a layout inverts the fix.** The obvious
`range(19)` mask is correctly under 80% and lands on **6 of the 8 P-cores** — the hottest,
highest-power silicon on the die. `allowed_cores()` therefore reads the topology and pins to
the 16 E-cores: 67% machine-wide, `p_cores_used: 0`, and every P-core left free for the
user's own interactive work — which is what the CPU ceiling exists to protect.

> **Now measured.** With the 16-E-core mask restored, most post-epoch CPU readings during
> epochs 41–52 were about 70–72 C, but later epochs still produced brief 90–96 C readings.
> The affinity reduces sustained load but does not eliminate thermal spikes. CPU and GPU
> share heatpipes, so GPU load can heat the CPU regardless of core placement.

### RAM: the ceiling is machine-wide, and the machine's own baseline is most of it

Measured 2026-09-01 by differencing machine-wide readings across a worker sweep — the only
honest way to answer a machine-wide question. Per-process figures cannot: working set
undercounts shared pages, summed RSS over-counts pages shared *between* workers, and both
earlier constants came from per-process numbers and were both wrong.

| workers | machine-wide RAM | GPU util | min/epoch |
|---|---|---|---|
| 0 | **17.70 GB** | 37.5% | 3.25 |
| **2** | **24.18 GB** | **70.4%** | **1.41** |
| 4 | 29.63 GB | 67.6% | 1.33 |

**`workers=2` is the operating point** (`DEFAULT_WORKERS`): it maximises GPU utilisation
*and* sits at the ceiling. Note the shape — going past 2 costs 5.5 GB of RAM to *lower* GPU
utilisation, and dropping to 0 to "spare the CPU" halves it. Neither intuition survives
measurement.

The user's own applications held **14.06 GB** at the time, so ~10 GB of the 24 is what
training actually gets. If the ceiling ever needs to buy more workers, closing applications
is the lever — not raising the cap.
