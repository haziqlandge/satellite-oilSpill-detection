# Citation graph — expansion state

Tracks what has been processed, what is queued, and what was deliberately skipped.
**Check here before reading any paper**, to avoid duplicate work.

Last updated: 2026-08-28.

## Expansion state

**Reference expansion was NOT performed.** The researchSolution skill scopes recursive
reference expansion out unless the user explicitly asks for it, and the user stated only
four papers were needed. The queue below is therefore a **ranked backlog**, not a to-do
list. Pull from it only if a specific engineering question demands it.

Current judgement: the four supplied papers plus targeted web research cover the core
problem, the major approaches, the important alternatives, and the failure modes.
Additional reading would be mostly redundant or peripheral for the demo scope. The
exceptions are marked **[BLOCKING-IF]** below.

## Processed

| ID | Citation | Identifier | Note |
|---|---|---|---|
| P001 | Senthilnathan et al. — Maritime Environment Safety: Advanced Oil Spill Detection through AIS and Remote Sensing | no DOI | [[P001]] |
| P002 | Wang, Huang, Zhang, Wang, Chen, Mulligan, Li, Elektorowicz, Li, Lee, An (2026) — AI for marine oil spill management. *Mar. Environ. Res.* | doi:10.1016/j.marenvres.2026.108108 | [[P002]] |
| P003 | Balsaraf, Ambekar, Kokate, Ghadge, Ghorpade, Patil — Automated Oil Spill Detection System | no DOI | [[P003]] |
| P004 | Zhao, Zheng, Peng, Jia, Wang, Hu (2025) — Improved object detection for operational oil spill detection and tracking in SAR. *Mar. Pollut. Bull.* | doi:10.1016/j.marpolbul.2025.118608 | [[P004]] |

## Web sources consulted (not papers)

| Source | URL | Used for |
|---|---|---|
| SkyTruth Cerulean — methods | `skytruth.org/cerulean/methods` | Parity/proximity/temporality, AIS window, dark-vessel rules, model spec |
| SkyTruth — stationary polluters blog | `skytruth.org/blog/leveling-up-ceruleans-ability-to-reveal-stationary-polluters` | Distance decay 4.0, tail-end scoring, 60%→90% top-1, collation score |
| OpenDrift docs + discussion #1777 | `opendrift.github.io`, `github.com/OpenDrift/opendrift/discussions/1777` | Negative `time_step` backward mechanism |
| Copernicus Data Space Ecosystem | `dataspace.copernicus.eu` | S1 access post-SciHub; STAC/OData/S3 |
| Zenodo records 8346860 / 8253899 / 13761290 / 15298010 | zenodo.org | Dataset specs |
| MarineCadastre vessel traffic | `hub.marinecadastre.gov/pages/vesseltraffic` | AIS schema |
| GFW AIS-disabling-high-seas | `github.com/GlobalFishingWatch/AIS-disabling-high-seas` | Gap-vs-coverage methodology |
| INCOIS OOSA | `services.incois.gov.in/portal/osf/oosa.jsp` | Indian operational reference (GNOME) |
| NOAA ORR / EGU thickness sources | various | Age/thickness feasibility |

## High-value unread references — ranked queue

### Tier 1 — [BLOCKING-IF] we hit the specific problem named

| Ref | Why it would matter | Trigger to read |
|---|---|---|
| **Li et al. 2023 — LSK attention for remote sensing object detection** | We must implement LSK. [[P004]] defers the full description to its Supporting Text S1, which we do not have | **If Phase 2 LSK integration is non-obvious.** Most likely Tier-1 read |
| **Ma and Xu 2023 — MPDIoU loss** | Must implement; [[P004]] defers to Supporting Text S2 | If the loss implementation is ambiguous |
| **Dagestad et al. 2018 — OpenDrift** | The drift engine's own paper | If OpenDrift's API docs prove insufficient in Phase 4 |
| **Akyon et al. 2022 — SAHI** | Slicing-aided inference; deferred to Supporting Text S3 | If SAHI's library defaults do not fit 1024px SAR tiles |

### Tier 2 — closest prior art to our specific contribution

| Ref | Why | Read if |
|---|---|---|
| **Busler et al. 2015** — probabilistic crossing of ship tracks with slick drift trajectories | The closest published relative of `S_drift`. Would sharpen our novelty claim and possibly the scoring maths | Writing up the contribution, or if `S_drift` design stalls |
| **Luo et al. 2024** — bidirectional drift model to find the most likely spilling ship | Second closest. "Converts oil spill area into trajectory points" — our seeding step | Same as above |
| **Ciappa and Costabile 2014** — oil spill hazard assessment using a **reverse trajectory** method (Egadi MPA) | Explicit reverse-trajectory methodology | Phase 4, if backward-run design needs precedent |
| **Liu et al. 2021** — AIS + AHP + expert scoring; also the wind-field look-alike source | Both an attribution baseline and the wind-gate citation | If defending wind thresholds or comparing scorers |

### Tier 3 — detection-side alternatives

| Ref | Why | Read if |
|---|---|---|
| Krestenitis et al. 2018, 2019 | The benchmark dataset's own papers; class definitions and baselines | When the MKLab dataset arrives |
| Arnob et al. 2025 — CNN encoder-decoder + spatial attention for SAR look-alikes | Alternative attention approach targeting our dominant failure mode | If LSK underperforms on look-alikes in Phase 2 |
| Jiang et al. 2023 — object-oriented fuzzy logic separating slicks from **ship wakes** (Sentinel-2) | Directly targets our most dangerous look-alike | If wake false positives persist after Phase 2/3 |
| Zhang et al. 2025c — YOLO-ADHF-SimAM (YOLOv11) | Recent YOLO+attention for slicks; parameter-free attention | If considering a YOLOv11 base |
| Garcia-Pineda et al. 2013 | Justifies VV polarisation | Only if VV is questioned |

### Tier 4 — classical baselines (context, low urgency)

Espedal 1999 (**wind history** — the wind-gate foundation, promote to Tier 2 if the gate is
challenged); Solberg et al. 1999, 2007; Fiscella et al. 2000; Karantzalos and Argialas 2008;
Fingas and Brown 2014; Espedal and Johannessen 2000.

### Tier 5 — physics/uncertainty (read only if the drift ensemble misbehaves)

Kampouris et al. 2021 (MEDSLIK-II forcing ensembles, wind phase sensitivity);
**Nordam et al. 2019** (random-walk diffusion artifacts — promote if we see suspicious
particle accumulation); De Dominicis et al. 2013a/b (MEDSLIK-II theory and validation);
Accarino et al. 2025 (Bayesian calibration, +25%, our stretch goal);
Vasconcelos et al. 2025 (cost limits of Lagrangian models).

## Deliberately skipped, with reasons

| Reference / area | Reason |
|---|---|
| [[P001]] refs [1]–[3] (Garcia and Thomas 2020; Lu and Zhao 2019; Manfreda and Tarantino 2021) | **Could not be verified.** Generic titles/author pairs typical of fabricated citations. **Do not cite without independent verification** |
| [[P002]] Section 4.2 — oil spill response robots, informative path planning, cooperative source seeking | Out of scope. We do detection and attribution, not response |
| [[P002]] Section 4.3 / Table 4 — intelligent manufacturing of sorbents and aerogels | Entirely out of scope |
| [[P002]] Section 2.2 — pipeline failure forecasting, predictive maintenance, corrosion | Out of scope: prevention, not attribution |
| [[P002]] toxicology / ESI / sediment-toxicity references | Impact assessment, not detection or attribution |
| [[P001]] / [[P003]] architecture walkthroughs (Swin, U-Net, DeepLabv3+) | Generic reproductions of the original architecture papers; superseded by our YOLO-seg choice |
| [[P003]] blockchain, AUV, reinforcement-learning future work | Speculative; out of scope |
| Peripheral YOLO-variant papers beyond [[P004]] Table 2 | Diminishing returns; [[P004]]'s comparison table is sufficient |

## Deduplication

Identifiers checked before adding: DOI, then title, then authors+year, then arXiv ID.
No duplicates found across the four supplied papers — they cover four distinct
contributions (anchor architecture, review, student system, survey).

Note: [[P001]] and [[P003]] both cite Isolation Forest and DeepLabv3+ material; and
`oil.txt` is substantially derived from [[P001]] Section II — recorded so a future session
does not mistake `oil.txt` for an independent fifth source.

## If expansion is requested later

Recommended order: **Tier 1 in full** (needed to implement), then **Busler 2015 + Luo 2024**
(to position the contribution precisely), then Tier 3 only if the corresponding failure mode
actually appears in Phase 2 evaluation.

Stop when new papers stop changing engineering decisions.
