# SYNTHESIS — consolidated understanding

Last updated: 2026-08-28. Corpus: 4 user-supplied papers read in full + targeted web
research. This is the document to consult during engineering work.

---

## 1. The problem, restated technically

Given a SAR scene and an AIS archive, produce a **ranked, explainable list of candidate
polluters** for each detected slick, together with the slick's geometry, an estimate of
where and when it was released, and a forecast of where it will go.

Three coupled sub-problems:

| Part | Task | Core difficulty |
|---|---|---|
| (a) | Detect + characterise slicks; geometry; age | **Look-alikes.** A dark SAR patch is not oil-specific |
| (b) | Hindcast to origin point+time; forecast forward | **Backward diffusion is irreversible.** Reversal spreads, it does not focus |
| (c) | Reconstruct traffic, filter, score suspects | **No labelled ground truth.** Polluter behaviour has no training set |

---

## 2. What the literature agrees on

Consensus across all four papers plus the operational reference system:

1. **SAR (Sentinel-1, C-band, IW, VV, 10 m) is the right sensor.** All-weather, day/night,
   wide swath. Oil damps capillary waves so slicks read as dark patches.
   *(all four papers; Cerulean independently)*
2. **Look-alikes are the dominant failure mode** and cannot be solved by the model alone.
   Low wind, biogenic films, ship wakes, sea ice. *(all four; [[P002]] quoting Jafarzadeh
   2021: SAR alone is "unreliable")*
3. **Wind-field information is the standard remedy** — traceable to Espedal 1999 and
   reaffirmed by [[P004]] Sec. 3.6, [[P002]], [[P001]].
4. **Attention mechanisms are the consensus architectural answer** to look-alike confusion
   and shape discrimination. *([[P004]] LSK; Arnob 2025 spatial attention; Zhang 2025c SimAM)*
5. **Lagrangian particle models (OpenDrift, MEDSLIK-II) are physically correct**; their
   limitation is compute and real-time adaptation, not accuracy. *([[P002]])*
6. **Probabilistic output requires ensembles**, not single trajectories. *([[P002]] via
   Kampouris 2021)*
7. **AIS cannot detect spills and can be switched off.** Dark vessels must be first-class
   candidates. *([[P001]], [[P002]], Cerulean)*
8. **Automated attribution is the field's open frontier.** Every prior method surveyed by
   [[P004]] Sec. 3.7 is manual or semi-automatic.

---

## 3. Major approaches and our selections

| Decision | Options | **Selected** | Why |
|---|---|---|---|
| Detector family | classical/CFAR; semantic seg; object detection; **instance seg** | **YOLO-seg + LSK(L5) + MPDIoU + SAHI** | Only family giving class + contour + small-object sensitivity + full-scene inference. [[P004]]'s architecture upgraded along its own stated future work |
| LSK position | L1–L5 | **L5** (all heads) | Ties L2 numerically (71.6%) but is the **only** variant that reliably detects *and* classifies OOSs; best look-alike suppression |
| Loss | CIoU / **MPDIoU** | **MPDIoU** | Faster convergence, better small-dataset generalisation ([[P004]] Table 1) |
| Class scheme | binary / **2-class** / 5-class | **`oos` + `slick_unknown`**, seawater as background | The class label is itself an attribution signal ([[P004]]) |
| Drift engine | OpenDrift / MEDSLIK-II / GNOME / learned | **OpenDrift OpenOil** | Named by [[P004]]; best-documented backward support; [[P002]] confirms physics is sound |
| Backward mechanism | adjoint / reverse-advect / **negative timestep** | **negative `time_step`** | Native, documented, maintainer-confirmed |
| Drift output | trajectory / **probability field** | **`origin_field P(lat,lon,t)`** | [[P002]]/Kampouris: ensembles, not point predictions |
| Attribution | rules / AHP+expert / **multi-factor scoring** | **Cerulean terms + `S_drift`** | Cerulean is operationally validated (~90% top-1); `S_drift` is our addition |
| Anomaly detection | supervised / **unsupervised** | **Isolation Forest + rules** | No labelled polluter behaviour exists ([[P003]]) |
| Ship detection | learned / **CFAR** | **CFAR** | No labels needed; bright targets on water are the easy case |

---

## 4. The gap — and our thesis

| System | Detect | Contour | Backward drift | Auto AIS attribution | Explainable |
|---|---|---|---|---|---|
| [[P004]] YOLOv8-LSK | 2-class | boxes only | **no** (stated future work) | **no** — manual | no |
| Cerulean | binary | yes | **no** — geometry as proxy | yes | partial |
| [[P003]] | binary | yes | **no** | correlation box, unspecified | no |
| [[P001]] | survey | — | — | — | — |
| **This project** | 2-class | **instance seg** | **ensemble origin field** | **drift-conditioned** | **evidence cards** |

**Thesis.** Close the loop: instance segmentation to geometric characterisation to a
**backward stochastic drift ensemble producing a 4-D origin probability field**, to AIS
traffic reconstructed **inside that spatiotemporal envelope**, to multi-factor explainable
scoring.

No system in the corpus conditions AIS attribution on a physical backward-drift field.
Cerulean substitutes slick geometry; [[P004]] does it by hand; [[P003]] has an unspecified
"correlation" box where the drift model should be.

**[[P004]] Sec. 3.8 is effectively our specification** — it names OpenDrift reverse
trajectories, instance segmentation, and temporal-state classification as the things it did
not do. All three are in our scope.

---

## 5. Contradictions and tensions in the corpus

| Tension | Resolution |
|---|---|
| [[P001]] recommends U-Net / DeepLabv3+ / Swin by fiat; [[P004]] shows YOLO+LSK beats prior work on a task neither of those addresses | Follow [[P004]] — it has an ablation; [[P001]] has no experiments |
| [[P003]] claims DeepLabv3+ mIoU 0.85 beating U-Net 0.78; [[P002]] cites DeepLabv3+ favourably too | Both plausible for *semantic* segmentation, but neither addresses the 2-class OOS problem. [[P003]]'s numbers are unreliable regardless (see its note) |
| [[P003]]'s Figure 7 (all AIS features at 0.084) contradicts its own Table 3 (SOG 0.35, course deviation 0.27...) | Internally inconsistent. **Discard both.** Derive our own feature importances |
| [[P004]] claims to solve "high artificial dependency in previous methods", yet its own AIS correlation is manual per-case | Overstatement. It automates *detection*, not *attribution*. This is precisely the opening for our work |
| [[P003]] triggers satellite tasking **from** AIS anomalies; the problem statement is spill-first | Both directions are valid; ours is the specified and harder one (forensic attribution) |
| Cerulean restricts vessel association to "long, linear" slicks; [[P004]] Case 3's source was **berthed** | Cerulean's restriction is a scoping decision that excludes exactly the hard case. Our `S_drift` + behavioural terms must cover it |

---

## 6. Limitations and failure modes to design against

**Detection**
- Ship wakes are linear + dark and adjacent to a vessel — the most dangerous look-alike,
  because attributing one accuses the vessel that made it. [[P004]]'s baseline and L2 both
  made this error.
- Low-wind cells and biogenic films are physically indistinguishable from oil in SAR alone.
- Untested: whether LSK-at-L5 transfers from a detection head to a **segmentation** head.
  This is the main technical risk of Phase 2.

**Drift**
- **Reversal is not information recovery.** Diffusion is irreversible; the backward cloud
  legitimately widens. Report it; never tune it away.
- Beyond ~24–48 h the origin field may be too diffuse to discriminate. Required behaviour:
  degrade to **"origin window too diffuse to attribute"** rather than force a suspect.
- Naive random-walk diffusion creates **spurious accumulation** (Nordam 2019) — which in a
  backward run becomes a false, confident-looking origin. Use OpenDrift's own mixing.
- Forcing resolution (~1/12 deg) is coarser than slick scale.

**Attribution**
- No labelled polluter corpus exists; we have **three** ground-truth cases. Weights must be
  hand-set and defensible, not fitted — fitting on three cases is overfitting.
- Dark vessels are invisible to AIS by construction.
- A raw AIS gap is **not** evidence; normalise by expected reception density (GFW).

**Age**
- No reliable direct SAR-to-age regressor exists. See [[slick-age-estimation]].

**Cross-cutting** — [[P002]]'s challenge #2: models trained in one region fail in another.
Our dual-region design tests this rather than hiding it.

---

## 7. Non-negotiable design commitments

Derived from the above; these are requirements, not preferences.

1. **Look-alike negatives at ~10% of every split.** Highest-leverage single intervention
   (14 to 5 false positives, [[P004]] Fig. 5), and it costs only data curation.
2. **Wind gate on every detection**, reported on the evidence card, as a continuous
   confidence multiplier rather than a hard cut.
3. **Ensemble backward drift**, never a single trajectory.
4. **OpenDrift's built-in mixing**, never hand-rolled diffusion.
5. **Evidence card per suspect** with per-term score decomposition and the geometry behind
   each term. [[P002]] challenge #3; and the output is an accusation of an environmental
   crime, so opacity is not acceptable.
6. **Age as `{low, best, high}` + `age_method`**, never a bare scalar.
7. **An explicit "insufficient evidence" state** when the origin field is too diffuse.
8. **Look-alike false-positive count as a first-class metric**, reported separately from mAP.
9. **Synthetic AIS in the marinecadastre schema**, with ground truth authored rather than
   detector-derived (avoiding [[P003]]'s circularity).

---

## 8. Validation strategy

[[P004]]'s three Port of South Louisiana cases are **published, peer-reviewed ground truth
coinciding with free real AIS** — the strongest verification available for this problem, and
the reason for the dual-region choice.

| Case | Date (UTC) | Truth | Tests |
|---|---|---|---|
| 1 | 00:02, 9 Apr 2023 | Platform leak, no vessel within 5 km | Collation ranks infrastructure above vessels |
| 2 | 00:02, 15 May 2023 | **BOCHEM LONDON**, moving, ~19 km slick | Top-1 correctness; forward+backward drift consistency |
| 3 | 23:57:19, 5 Dec 2023 | **BRANDON BORDELON**, berthed since 3 Dec, track does **not** match slick | **The adversarial case** |

**Case 3 is the discriminating test.** Cerulean's parity and proximity terms both fail on
it — the vessel was stationary for two days and its track does not parallel the slick. Only
a backward-drift field reaching the berth at the right time, plus a berthed/loitering
behavioural signal, ranks it correctly. **Solving Case 3 is the concrete demonstration that
this system does something the literature and the reference implementation do not.**

Metrics: mAP50 / mAP50-95 and look-alike FP count (detection); top-1 / top-3 source rate and
score separability (attribution, Cerulean's metrics); backward hit-rate — does the 90%
origin contour contain the true source (drift).

---

## 9. Unresolved questions

1. Does LSK-at-L5 transfer to a segmentation head? *(Phase 2 — main technical risk)*
2. How sharp is the backward convergence minimum in practice? *(Phase 4 — main risk to the
   age deliverable)*
3. `S_drift` as **max** over track points, or as an **integral** of the track through the
   field? The integral should favour a lingering vessel and is likely better for Case 3.
4. Term weights: hand-set (defensible, no overfitting) vs learned (needs a corpus we lack).
   Default hand-set; report sensitivity.
5. Third explicit `lookalike` **class** vs look-alikes as background negatives?
   [[P004]] chose negatives; Krestenitis labels it as a class. One ablation in Phase 2.
6. Do the 3 and 10–12 m/s wind bounds hold under Indian monsoon wind climatology?
7. `oos` vs `slick_unknown` relabelling cost on the binary Zenodo masks — the largest
   hidden cost in the plan. *(Phase 1/2)*

---

## Index of notes

Papers: [[P001]] [[P002]] [[P003]] [[P004]]
Topics: [[sar-oil-spill-detection]] [[drift-modelling-and-hindcasting]]
[[ais-attribution-and-scoring]] [[lookalike-discrimination]] [[slick-age-estimation]]
[[datasets-and-data-access]]
