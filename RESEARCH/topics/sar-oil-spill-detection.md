# Topic — SAR-based oil spill detection

Sources: [[P004]] (primary), [[P002]] (review), [[P001]] (framing), [[P003]] (weak),
plus SkyTruth Cerulean methods (web).

## Physics

Oil films suppress capillary and short gravity waves on the sea surface, reducing **Bragg
backscatter** of the radar signal. Slicks therefore appear as **dark patches** against a
brighter, wind-roughened sea ([[P004]] Sec. 1; [[P001]] Sec. I.A).

Consequences that follow directly from the physics:
- Detection depends on there **being** wind-driven roughness to suppress. Below ~3 m/s the
  sea is already dark and the contrast vanishes; above ~10–12 m/s wind mixes the oil down
  and the slick disappears. This is the physical basis of the wind gate
  ([[lookalike-discrimination]]).
- Anything else that damps waves — biogenic films, low-wind cells, rain cells, sea ice,
  ship wakes, current shear — produces the same dark signature. **The dark patch is not
  oil-specific.**

## Sensor configuration (settled)

| Parameter | Value | Source |
|---|---|---|
| Platform | Sentinel-1 C-band SAR | [[P004]] Sec. 2.2 |
| Mode | Interferometric Wide (IW) swath, 250 km | [[P004]] |
| Resolution | 10 x 10 m | [[P004]] |
| Polarisation | **VV** | [[P004]], citing Garcia-Pineda et al. 2013 |
| Product | GRD | [[P004]]; Cerulean |

Cerulean independently uses **Sentinel-1 VV GRD**, resampled to 80 m for its U-Net. The
choice of VV is consistent across both operational and research systems.

## Pre-processing chain (settled)

From [[P004]] Sec. 2.3, using ESA SNAP. Order matters:

1. **Calibration** to Sigma0 (dB)
2. **Refined Lee** speckle filter — reduces speckle while preserving slick detail
3. **Land masking** — prevents land being detected as oil
4. **Geometric / terrain correction** to a geographic CRS (EPSG:4326)

> [[P004]] states explicitly that geometric correction is what **"ensure[s] the alignment of
> images and geographic coordinate systems to match the SAR images with the AIS data"**.
> Geocoding fidelity is therefore not a nicety — it is the precondition for the entire
> attribution stage. Any pixel-to-geo error propagates directly into proximity scoring.

## Method families

### Classical (pre-deep-learning)
Threshold/dark-spot segmentation, then hand-crafted features, then a statistical
classifier. Anchors: Solberg et al. 1999 and 2007; Fiscella et al. 2000; Karantzalos and
Argialas 2008 (level sets); Espedal 1999 (wind history). Later ML variants use SVM and
Random Forest (Conceicao et al. 2021; Zou et al. 2016, via [[P004]]).
**Role for us:** a CFAR/threshold baseline is cheap, needs no labels, and is still the right
tool for **bright-target (ship/platform) detection**. Keep it for that.

### Semantic segmentation
U-Net, DeepLabv3/v3+, VGG16- and DenseNet-based encoder-decoders for pixel-level boundary
delineation ([[P004]] Sec. 1; [[P002]] Table 2: Zakzouk et al. 2025 DeepLabv3+;
Arnob et al. 2025 CNN encoder-decoder + spatial attention). Cerulean uses a **ResNet34
U-Net** at 80 m on 512x512 overlapping tiles, averaging confidence on the overlaps.
**Strength:** precise contours, hence area and shape. **Weakness:** binary oil/not-oil —
gives no OOS vs unknown-origin distinction, and no instance separation when two slicks touch.

### Object detection
Faster R-CNN, YOLOv4, YOLOX variants, YOLOv8 ([[P004]] Table 2). [[P004]] argues object
detection suits **operational** spill monitoring because the first-stage objective is
presence + location for rapid source tracing, not precise boundaries; it is also more
sensitive to small objects, cheaper to label, and faster.
**Weakness:** bounding boxes give no area and no contour — [[P004]]'s own stated limitation.

### Our choice: instance segmentation
**YOLO-seg + LSK attention (L5) + MPDIoU + SAHI.** This is [[P004]]'s architecture upgraded
along the axis it names as future work #3. It uniquely gives all four things we need:

| Need | Provided by |
|---|---|
| `oos` vs `slick_unknown` class | multi-class detection head ([[P004]]) |
| precise contour, area, medial axis | segmentation mask (our upgrade) |
| small/narrow slick sensitivity | LSK dynamic receptive field |
| full-scene inference without downscaling | SAHI |

## What the attention mechanism buys

Three independent sources converge: attention is the consensus answer to look-alike
confusion and shape discrimination.

- [[P004]]: **LSK** dynamic large receptive field, to "capture the shape features that
  distinguish linear OOSs from irregular slicks". L5 (all heads) cut look-alike false
  positives 14 -> 5 vs baseline.
- [[P002]] Table 2: Arnob et al. 2025 use **spatial attention** specifically for
  "lookalike interference, class imbalance, and blurry boundaries".
- [[P002]] Table 2: Zhang et al. 2025c use **SimAM** parameter-free attention on a YOLOv11
  base to "suppress interference from complex water surface backgrounds".

## LSK placement — the empirical result to reproduce

[[P004]] Table 1. Best average mAP50-95 = **71.6%** at both **L2** (small-object head) and
**L5** (all heads), with MPDIoU. Baseline 68.3%. L4 (large-object head) with MPDIoU
*degrades* to 67.5%.

The tie is broken qualitatively, and the qualitative result is what matters:
- **L2** — higher small-object sensitivity, but emits redundant boxes, fires on tiny dark
  spots, and **misclassified an OOS as unknown-origin** (Fig. 4 Scene c).
- **L5** — balanced across scales, **the only model that reliably detects AND classifies
  OOSs**, best look-alike suppression.

**=> Ship L5.** Reproduce the full ablation as our own evidence rather than asserting it.

## Known failure modes

| Failure | Cause | Mitigation | Source |
|---|---|---|---|
| Ship wake called an OOS | Wake is linear and dark, like an OOS | L5 attention; wake geometry is attached to a bright target and diverges in a V | [[P004]] Fig. 4(a) |
| Low-wind area called oil | No Bragg roughness to suppress | Wind gate 3–12 m/s | [[P004]] 3.6, [[P002]], [[P001]] |
| Biogenic film called oil | Same damping physics | Wind gate + optical check; shape/context | all four |
| Sea ice, rain cells | Dark in SAR | Background negative samples in training | [[P004]] 2.4 |
| Two touching slicks merged | Semantic segmentation has no instances | Instance segmentation | our upgrade |
| Very large scene downscaled | Loses small slicks | SAHI tiled inference | [[P004]] 2.5 |

## Performance reference points

| System | Task | Metric | Note |
|---|---|---|---|
| YOLOv8 baseline | 2-class | mAP50-95 68.3% | [[P004]] |
| **YOLOv8-LSK (L5) + MPDIoU** | 2-class | **mAP50 94.2%, mAP50-95 71.6%** | [[P004]], our target |
| Best prior binary | 1-class | mAP50 86.76% (YOLOX-S-ECA-FFDNet) | [[P004]] Table 2 |
| Runtime | full SAR image | 15 s -> 17 s with all three modules | [[P004]] 3.5 |

Do **not** use [[P003]]'s mIoU 0.85 / Dice 0.88 as a target — see the reliability
assessment in that note.

## Open questions

- Does LSK-at-L5 transfer to a **segmentation** head as cleanly as it did to a detection
  head? [[P004]] only tested detection. This is genuinely untested and is our main
  technical risk in Phase 2.
- Does the L5 result hold when the training set includes Zenodo/Refined-SOS data rather
  than [[P004]]'s Bohai + MKLab mix? Cross-dataset transfer is [[P002]]'s challenge #2.
