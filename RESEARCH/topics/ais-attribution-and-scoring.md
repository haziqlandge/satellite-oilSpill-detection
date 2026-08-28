# Topic — AIS-based vessel attribution and suspect scoring

Sources: SkyTruth **Cerulean** methods (primary, operational), [[P004]] (cases + prior-art
survey), [[P003]] (AIS features + anomaly baselines), [[P001]] (AIS limitations),
Global Fishing Watch AIS-disabling methodology (web).

**This topic is problem-statement part (c).**

## What AIS is and is not

AIS broadcasts vessel identity, position, speed, course and heading over VHF, received by
coastal stations, satellites and other ships. Two limitations, stated plainly in [[P001]]:

1. **Vessels can deliberately switch off their transponders.** Dark vessels must therefore
   be first-class attribution candidates, not a coverage gap.
2. **AIS carries no environmental information.** It can place a vessel; it can never detect
   a spill. Attribution is always AIS *plus* imagery *plus* transport physics.

## Data schema (settled)

`marinecadastre.gov` (US coastal waters, since 2015, 1-minute filtered, Zstd-compressed
daily CSV) — the source [[P004]] used:

```
MMSI, BaseDateTime, LAT, LON, SOG, COG, Heading,
VesselName, IMO, CallSign, VesselType, Status,
Length, Width, Draft, Cargo, TransceiverClass
```

**Design decision:** the Indian-waters synthetic generator emits this **exact schema**, so a
single ingest and feature-extraction path serves both regions. This also means the
synthetic path is validated by the real path.

The feature subset [[P003]] used and we inherit: `SOG`, `COG`, `ROT`, `Heading`, `Draught`,
plus position and timestamp.

## The reference implementation: SkyTruth Cerulean

The only operational, publicly documented system doing exactly part (c) at global scale.
Free, and integrated into Skylight. Its detection side is a ResNet34 U-Net on Sentinel-1 VV
at 80 m; its attribution side is what matters here.

### Vessel source association — three scored terms

| Term | Definition |
|---|---|
| **Parity** | Compares slick length to its projected length along the AIS track — i.e. how parallel the slick is to the vessel's path |
| **Proximity** | Distance from the **head** of the slick to the nearest point on the vessel's AIS track |
| **Temporality** | Timestamp proximity; scores higher for more recent pollution |

**AIS window: 8 hours before the image timestamp to 6 hours after.**
Only **long, linear** detections qualify for vessel association — matching the expected
transiting-vessel signature.

### Infrastructure source association

Identifies offshore platforms from the **SAR Fixed Infrastructure Dataset**. It finds
perimeter points **far enough from the slick's centreline to be plausible origins**, then
applies **exponential distance decay** to score nearby infrastructure.

The redesign detail is instructive: the earlier version spread scores **evenly along the
perimeter**, which misattributed spills to infrastructure sitting in the slick's *middle*,
where oil had merely drifted. Concentrating score at the **tail ends** of the polygon
raised **top-1 source accuracy from ~60% to ~90%**. Optimal decay rate found to be **4.0**.

> This is a strong empirical lesson: **where along the slick you look matters more than how
> you weight distance.** Our head/tail extraction in Phase 3 must be good.

### Dark vessel association

When neither AIS vessels nor infrastructure match, Cerulean evaluates non-broadcasting
vessels: SAR-detected objects **> 30 m estimated length**, high confidence, within a
**50 km radius**, scored on distance and angular deviation from predicted vessel paths.

### Collation score

Normalises vessel and infrastructure scores onto one scale for an "apples-to-apples"
comparison of which **source type** is likeliest. We adopt this — it is what makes
[[P004]]'s Case 1 (platform, no vessel within 5 km) resolve correctly without a special case.

### Cerulean's evaluation metrics — we adopt these
- **Top-1 source rate** — how often the true source ranks highest
- **Top-3 source rate**
- **Score separability** — margin between source and non-source scores

## Where Cerulean stops, and our contribution

Cerulean has **no drift model**. It uses the slick's own geometry (head position, axis
orientation) as a *proxy* for where the oil came from. That proxy is good for fresh, linear,
transiting-vessel slicks — which is exactly the case it restricts itself to.

It is weak or silent for:
- slicks whose source has departed (a legacy slick's head is not the release point after
  hours of advection)
- slicks deformed by current shear so the axis no longer reflects the vessel's heading
- **stationary sources that are not infrastructure** — e.g. [[P004]]'s Case 3, a *berthed
  vessel* discharging, where the track does not parallel the slick and the source is not a
  platform

**Our addition: `S_drift`.** Replace geometric proxy with physics — score a vessel by how
much of its track falls inside the backward-drift `origin_field P(lat, lon, t)` at the
matching time. See [[drift-modelling-and-hindcasting]].

## Prior art in the literature ([[P004]] Sec. 3.7)

| Work | Method | Automation |
|---|---|---|
| Liu et al. 2021 | AIS within 12 h; Analytic Hierarchy Process + expert scoring | manual |
| **Busler et al. 2015** | Probabilistic crossing of ship tracks with slick **drift trajectories** in space and time | semi |
| **Luo et al. 2024** | Slick area to trajectory points; **bidirectional drift model** for most likely ship | semi |
| Mizukoshi et al. 2019 | Human detection of discharging ships; AIS for identity | manual |
| Ivanov and Kucheiko 2014 | SAR + AIS + auto ship detection; manual ship-info check | manual |

Busler and Luo are the closest prior art to `S_drift`. The field's ceiling is
semi-automatic, human-in-the-loop scoring. [[P004]] itself claims to solve "high artificial
dependency" but its own AIS correlation is manual per-case analysis — an overstatement that
marks the opening.

## Our scoring design

### Stage 1 — candidate generation (filtering irrelevant traffic)

The problem statement explicitly requires filtering irrelevant traffic. Order matters for
cost:

1. **Spatiotemporal gate on `origin_field`** — keep tracks whose points fall where
   `P(lat, lon, t)` exceeds a threshold, at the matching backward time. This is the primary
   filter and kills the overwhelming majority of traffic in one physically-motivated step.
2. Outer time bound: Cerulean's **-8 h / +6 h** for fresh slicks, extended to the full
   backward horizon for legacy slicks.
3. Add **dark-vessel** candidates: CFAR bright targets with no AIS match (> 30 m, <= 50 km).
4. Add **fixed infrastructure** candidates.

### Stage 2 — features, each normalised to [0,1] and independently reportable

| Term | Definition | Source |
|---|---|---|
| `S_drift` | max over track points of origin-field probability at (position, time) | **ours** |
| `S_parity` | slick length vs its projection on the AIS track (parallelism) | Cerulean |
| `S_proximity` | `exp(-d / lambda)`, d = slick head to nearest track point, decay ~4.0 | Cerulean |
| `S_temporality` | recency weighting toward acquisition time | Cerulean |
| `S_behaviour` | anomaly composite (below) | [[P003]] + GFW |
| `S_prior` | vessel type/size prior (tanker, bulk > fishing); draught change | [[P004]], domain |

### `S_behaviour` — behavioural anomaly

Rule-based features (speed drop, course deviation, ROT spikes, loitering, draught change)
combined with an **Isolation Forest** trained on normal traffic as an unsupervised baseline
([[P003]]). Unsupervised is the correct family here because **labelled polluter behaviour
does not exist**.

**AIS gaps require care.** Global Fishing Watch's method (Welch et al. 2022, repo
`GlobalFishingWatch/AIS-disabling-high-seas`) first models **how often a vessel's signal
should be received**, then classifies gaps as intentional versus satellite-coverage
artefacts using boosted regression trees. A raw gap is not evidence — reception density
varies hugely by region and vessel class. **Normalise gaps by expected reception rate**
before treating them as anomalous. Note also that GFW documents legitimate reasons for
going dark, including piracy avoidance.

### Stage 3 — collation and ranking
Weighted combination, then normalise vessels, dark vessels and infrastructure onto a single
collation scale (Cerulean) so source types compete fairly.

### Stage 4 — evidence card (non-negotiable)

[[P002]] challenge #3: *"Many deep learning models operate as opaque black boxes, making
outputs difficult for emergency personnel to evaluate, especially under high-stakes,
time-critical conditions."*

A ranked list of vessel names with a bare score is precisely that black box — and here the
output is an **accusation of an environmental crime**. Each suspect therefore gets:

- rank, total score, and the **per-term breakdown**
- the **geometry that produced each term** (which track segment, which slick head point,
  which origin-field cell and timestep)
- anomaly flags with their raw evidence (the actual speed/course series, the gap and its
  expected reception rate)
- a map thumbnail
- an explicit **"insufficient evidence"** state when the origin field is too diffuse

## Validation fixtures — [[P004]]'s three TPSL cases

| Case | Date (UTC) | Truth | What it tests |
|---|---|---|---|
| 1 | 00:02, 9 Apr 2023 | Platform leak; **no vessel within 5 km** | Collation must rank infrastructure above all vessels |
| 2 | 00:02, 15 May 2023 | **BOCHEM LONDON**, moving, track matches ~19 km slick | The straightforward case; top-1 must be correct |
| 3 | 23:57:19, 5 Dec 2023 | **BRANDON BORDELON**, **berthed since 3 Dec**, track does **not** match slick shape | **The adversarial case** |

**Case 3 is the discriminating test.** Parity and proximity — Cerulean's core terms — both
fail: the vessel was stationary for two days and its track does not parallel the slick.
Only a backward-drift field that reaches the berth at the right time, combined with a
loitering/berthed behavioural signal, ranks it correctly. If our scorer solves Case 3, it
does something the reviewed literature and the reference implementation do not.

## Open questions

- **Term weights.** Learn them, or set them from domain reasoning? With three ground-truth
  cases we cannot fit weights without overfitting. Default: hand-set, defensible weights;
  report sensitivity. Learning them needs a labelled corpus we do not have.
- Should `S_drift` use the **max** over track points, or an integral of the track through
  the field (rewarding a vessel that lingered in the high-probability region)? The integral
  is likely better for Case 3. Test both.
- Multi-vessel and repeat-offender aggregation across scenes — out of demo scope.
