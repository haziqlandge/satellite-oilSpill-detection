# RESEARCH — Index

Persistent technical knowledge for the SAR + AIS oil spill detection and vessel attribution
project. **Start with [[SYNTHESIS]]** — it holds the consolidated understanding and the
design commitments. Come here to find where a specific detail lives.

## Status

| Item | State |
|---|---|
| Research phase | **Sufficient for engineering.** Core problem, approaches, alternatives, failure modes and contradictions are understood and translated into engineering implications |
| Papers read in full | 4 / 4 user-supplied |
| Web research | Complete for the gaps the papers left open (backward drift mechanics, operational attribution, dataset access, age feasibility) |
| Reference expansion | **Not performed** — the skill scopes this out unless explicitly requested. High-value unread references are queued in [[CITATION_GRAPH]] |
| Last updated | 2026-08-28 |

## Read this first

**[[SYNTHESIS]]** — problem restated technically; what the literature agrees on; every
design decision with its justification; the gap and our thesis; contradictions; failure
modes; nine non-negotiable design commitments; validation strategy; open questions.

## Papers

| Note | Paper | Quality | Role |
|---|---|---|---|
| [[P004]] | Zhao et al. 2025, *Mar. Pollut. Bull.* — YOLOv8-LSK for operational oil spills | **High** — peer-reviewed, ablated, real cases | **The anchor.** Architecture, class scheme, dataset recipe, and three ground-truth attribution cases. Its Sec. 3.8 future work is effectively our specification |
| [[P002]] | Wang et al. 2026, *Marine Environmental Research* — AI for marine oil spill management | **High** — peer-reviewed review, open access | Settles the drift-engine choice; supplies the seven open challenges we design against |
| [[P003]] | Balsaraf et al. — Automated Oil Spill Detection System | **Low** — no venue, circular evaluation, internally contradictory | AIS feature set, unsupervised anomaly baselines, synthetic-anomaly recipe. **Its architectural flaw defines our contribution by contrast.** Do not cite its numbers |
| [[P001]] | Senthilnathan et al. — Maritime Environment Safety | **Low** — survey, no experiments | Framing and vocabulary. `oil.txt` derives from it. Points to the classical SAR literature (Espedal 1999 etc.) |

## Topics

| Note | Covers |
|---|---|
| [[sar-oil-spill-detection]] | SAR physics; sensor config; pre-processing chain; method families; why instance segmentation; LSK placement; failure modes; performance reference points |
| [[drift-modelling-and-hindcasting]] | Why a drift model is structurally necessary; OpenDrift choice; the negative-timestep mechanism; building the origin field; honest limits of backward drift; forcing data; validation |
| [[ais-attribution-and-scoring]] | AIS schema; Cerulean's parity/proximity/temporality/collation; dark vessels; the six scoring terms; candidate filtering; evidence cards; the three validation fixtures |
| [[lookalike-discrimination]] | The dominant failure mode; four defence layers; the wind gate and its physical basis; ship wakes; evaluation requirement |
| [[slick-age-estimation]] | Why direct SAR-to-age is not defensible; age from backward-drift convergence; damping ratio's real (limited) use; the three-state temporal label |
| [[datasets-and-data-access]] | Sentinel-1 access post-SciHub; labelled datasets and the binary-to-2-class relabelling cost; AIS real and synthetic; met-ocean forcing; Phase 1 checklist |

## References

**[[CITATION_GRAPH]]** — papers processed, high-value unread references ranked, what was
deliberately skipped and why, deduplication state.

## Where specific things live

| Looking for | Go to |
|---|---|
| Why we chose YOLO-seg + LSK(L5) | [[SYNTHESIS]] §3, [[sar-oil-spill-detection]] |
| The LSK ablation table to reproduce | [[P004]] "Table 1" |
| SNAP pre-processing chain | [[sar-oil-spill-detection]], [[P004]] Sec. 2.3 |
| How to run OpenDrift backwards | [[drift-modelling-and-hindcasting]] |
| The six scoring terms | [[ais-attribution-and-scoring]] |
| Why Case 3 matters most | [[SYNTHESIS]] §8, [[P004]], [[ais-attribution-and-scoring]] |
| Wind gate thresholds and their basis | [[lookalike-discrimination]] |
| Whether we can estimate slick age | [[slick-age-estimation]] |
| Where to download anything | [[datasets-and-data-access]] |
| What we must not claim | [[SYNTHESIS]] §6, §7; [[P003]] reliability assessment |

## Reading rule

Do not load every note each session. Read [[SYNTHESIS]], then only the topic note relevant
to the current phase. Paper notes are for detail lookups, not routine reading.
