# Topic — Look-alike discrimination

Sources: [[P004]] Sec. 3.2/3.6 (quantitative), [[P002]] (Jafarzadeh 2021; Arnob 2025;
Jiang 2023), [[P001]], Espedal 1999 (foundational).

**All four papers independently identify look-alikes as the dominant failure mode of SAR
oil spill detection.** This is the most cross-validated finding in the entire corpus, and
it is the difference between a demo that impresses and one that visibly cries wolf.

## The problem

Oil damps capillary waves and appears dark in SAR. **So does everything else that damps
capillary waves or reduces backscatter.** The dark patch is not oil-specific.

Confirmed look-alike classes ([[P004]] Fig. 5; [[P001]]; [[P002]]):

| Look-alike | Mechanism |
|---|---|
| **Low-wind areas** | No Bragg roughness to suppress; sea is already dark |
| **Biogenic / natural films** | Same wave-damping physics as oil |
| **Ship wakes** | Linear, dark, **and shaped exactly like an OOS** |
| **Sea ice** | Different backscatter regime |
| **Waves / choppy areas** | Shadowing |
| Rain cells, current shear, upwelling | Local roughness modification |

[[P002]], quoting Jafarzadeh et al. 2021, states the ceiling directly: distinguishing oil
from natural surface films **using SAR imagery alone is unreliable**, particularly at low
wind speed.

**Ship wakes are the most dangerous class for us**, because a wake is linear, dark, and
adjacent to a vessel — i.e. it satisfies every heuristic for an `oos` *and* would then be
attributed to the very vessel that made it. [[P004]]'s baseline YOLOv8 and the L2 variant
both made exactly this error (Fig. 4, Scene a). Jiang et al. 2023 ([[P002]] Table 2)
addressed precisely this with object-oriented fuzzy logic on Sentinel-2, distinguishing
slicks from "morphologically similar ship wakes".

## Defence in depth — four independent layers

No single mechanism solves this. [[P004]] Sec. 3.6 is explicit that model optimisation alone
**cannot eliminate** look-alikes, "as some look-alikes have the same characteristics as oil
spills".

### Layer 1 — negative training samples
[[P004]] Sec. 2.4: look-alike images were added as **explicit background samples** —
200 train / 25 val / 25 test out of 2048/231/231, i.e. roughly **10% of every split**.

Result ([[P004]] Fig. 5, five look-alike-only scenes with no oil present):

| Model | False positives |
|---|---|
| YOLOv8 baseline | **14** |
| YOLOv8-LSK (L2) | 5 |
| YOLOv8-LSK (L5) | 5 |

A ~64% reduction. **This is the single highest-leverage intervention available and it costs
only data curation.** Zenodo Part II (`8253899`) is explicitly a no-oil/look-alike set —
use it as the negative pool.

### Layer 2 — attention architecture
Three independent sources converge on attention as the answer to look-alike confusion:
- [[P004]]: LSK dynamic large receptive field, best at L5 (all heads)
- [[P002]]/Arnob et al. 2025: spatial attention specifically for "lookalike interference,
  class imbalance, and blurry boundaries"
- [[P002]]/Zhang et al. 2025c: SimAM to "suppress interference from complex water surface
  backgrounds"

### Layer 3 — wind gate (post-detection, physical)
The oldest and best-grounded remedy. **Espedal 1999**, *Satellite SAR oil spill detection
using wind history information* — the foundational citation. Reaffirmed by [[P004]] Sec. 3.6
(citing Liu et al. 2021: wind-field information "can significantly reduce or eliminate the
false detection of look-alikes"), [[P002]] and [[P001]].

**Physical basis, both bounds:**
- **Below ~3 m/s** — insufficient Bragg roughness for oil to suppress; the sea itself is
  dark, so contrast is meaningless and low-wind cells masquerade as slicks
- **Above ~10–12 m/s** — wind mixes oil into the water column and re-roughens the surface;
  real slicks become undetectable, so a dark patch is probably not oil

**Implementation:** sample the ERA5/CMEMS wind field at the detection's centroid at
acquisition time; downweight or reject outside the band. We already fetch this wind for the
drift engine, so the gate is nearly free. Report the wind speed on the evidence card —
a detection at 2 m/s should visibly carry lower confidence.

**Caveat:** the band edges are soft and regionally variable. Prefer a **continuous
confidence multiplier** over a hard cut, and always surface the value rather than silently
dropping detections.

### Layer 4 — optical cross-check (optional)
[[P004]] Sec. 3.6, citing Huang et al. 2022: optical satellite observation can establish
whether a SAR dark patch is oil-related. Sentinel-2 (10 m MSI) or Sentinel-3 OLCI, where a
cloud-free acquisition exists near in time.

**Reality check:** temporal coincidence between S1 and a cloud-free S2 pass is uncommon, so
this is a bonus confirmation path, not a dependable layer. Implement as optional
enrichment; never make the pipeline depend on it.

## Additional discriminators available to us for free

Because we run instance segmentation and a drift model, we get discriminators the cited
work did not use:

| Discriminator | Rationale |
|---|---|
| **Attached to a bright target + V-divergence** | Ship wakes originate at the vessel and diverge; an OOS trails behind and does not widen in a V |
| **Backward-drift plausibility** | If no plausible source exists anywhere in the backward origin field, the detection is more likely a look-alike |
| **Damping ratio** | Very weak contrast argues for a biogenic film over thick oil (weak signal, use as a tiebreak only — see [[slick-age-estimation]]) |
| **Shape statistics** | Cerulean's slick-confidence model scores size, compactness, elongation and multipart structure to estimate resemblance to confirmed vessel pollution |
| **Persistence across passes** | A slick persists and advects coherently; a low-wind cell does not |

## Evaluation requirement

[[P004]]'s look-alike false-positive count (14 -> 5) is arguably its **most practically
important result** — more so than the mAP figures, because false alarms are what destroy
operational trust and, here, would mean accusing an innocent vessel.

**Therefore: look-alike false-positive count on a held-out look-alike-only subset is a
first-class evaluation metric in `PLAN/EVALUATION.md`, reported alongside mAP — never
folded into it.**

## Open questions

- Do the 3 m/s and 10–12 m/s bounds hold in Indian waters (monsoon regimes, very different
  wind climatology from the Bohai Sea and the Gulf of Mexico)? Untested; flag in the demo
  rather than assuming.
- Can the wind gate be learned as a feature rather than applied as a rule, given wind is
  already an input? Cleaner in principle; risks the model learning a shortcut. Rule first.
- Does adding a third explicit `lookalike` **class** beat using look-alikes as background
  negatives? [[P004]] chose background samples; Krestenitis's dataset has look-alike as a
  labelled class. Worth one ablation in Phase 2.
