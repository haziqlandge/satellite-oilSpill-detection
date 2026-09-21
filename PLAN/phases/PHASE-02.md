# PHASE-02 — Detection model (the research contribution)

## Current status — 2026-09-17

Closure continuation: annotation-pipeline bugs are fixed and a 24-tile review pilot is ready. Publisher descriptions confirm that Zenodo's Oil/Lookalike/No oil folders do not supply the required oil-origin classes. See `eval/phase2-closure/STATUS.md` for verified evidence, fixes, workload and ETA dependencies. Acceptance remains 9/13 (69%); do not count the review pilot as completed relabeling.

Architecture training is complete. The released L1 remains a single-class research candidate. Validation-only confidence .20 and inference settings are frozen; the held-out test was evaluated exactly once (mask AP50–95 .149918, AP50 .363622). Research export and a manifest-checked streaming SAHI/geocoded inference path are implemented. See `eval/final/INDEPENDENT_AUDIT.md` for the fresh control comparison, false-alarm failures and full-scene status. Two-class acceptance remains blocked on human `oos`/`slick_unknown` relabeling; do not tune on the consumed test split.

## Objective
Train and ship an **evidence-selected YOLO-seg / LSK** instance-segmentation model that detects
and classifies slicks as `oos` or `slick_unknown`, with SAHI inference over full SAR scenes,
and reproduce P004's LSK placement ablation as our own evidence.

## Why it exists
This is where the project's technical contribution begins. P004 achieved multi-class
detection with **bounding boxes** and named instance segmentation as future work #3.
Segmentation is not cosmetic here — the mask is what gives us area, the medial axis, the
head/tail points, and the seeding footprint for the drift ensemble. Boxes cannot do any of
that.

## Dependencies
PHASE-01 (labelled tiles, negative pool, relabelled classes).

## Files to create
```
ml/datasets/oos_dataset.py        YOLO-format assembly, 8:1:1, mirroring, negatives
ml/models/lsk.py                  Large Selective Kernel attention module
ml/models/mpdiou.py               MPDIoU loss
ml/models/yolo_seg_lsk.py         model assembly, LSK insertion at L1..L5
ml/train/train.py                 training entry point
ml/ablation/run_ablation.py       12 runs: {none,L1..L5} x {CIoU,MPDIoU}
ml/ablation/results.md            committed ablation table
ml/export/export.py               weights + manifest (INTERFACES §6)
backend/detect/yolo_lsk/infer.py  SAHI-wrapped inference
backend/detect/cfar/detector.py   cell-averaging CFAR bright-target detector
tests/test_detect.py
```

## Screening review and final selection — 2026-09-15

**12/12 sixty-epoch screens complete.** Selected fresh100 finalists: **none-ciou, L1-ciou, L4-ciou**; reserve L5-ciou. [Review protocol](../SCREENING_REVIEW.md) and [detailed review](../../eval/screening/REVIEW.md) supersede historical status, metric-significance and default-winner claims below. The original all-head/MPDIoU architecture is a hypothesis, not a mandatory outcome.

MPDIoU implementation has a grid/pixel scale mismatch; six archived runs cannot establish intended-loss efficacy. No old artifact was changed. Missing none-ciou screen weights, mixed batches, single seed, duplicate train/val images and one-class labels constrain conclusions. Final three runs remain unstarted; total budget 780/1080 done.

A completed 60-epoch screen is not a completed 100-epoch full-grid reproduction or shipped Phase 02 model. Keep remaining acceptance criteria open. Existing CSV trend/jitter observations below are historical, not statistical significance tests.

## Implementation details

### Model
Base: `ultralytics` YOLOv8-seg or YOLO11-seg. Three modifications from P004 §2.5:

- **LSK attention** — insert at the five candidate positions. L1 = before SPPF;
  L2/L3/L4 = before the small/medium/large heads; **L5 = before all heads**.
  P004 defers the module's full description to its Supporting Text S1, which we do not
  have — **read Li et al. 2023 if the implementation is non-obvious**
  (`CITATION_GRAPH` Tier 1).
- **MPDIoU** replacing CIoU (Ma and Xu 2023).
- **SAHI** at inference for full-scene processing.

### Training (P004 §2.7)
`epochs=100, imgsz=1024, lr=0.01, workers=8`, official defaults otherwise — P004
deliberately avoided tuning so the architecture is what is being measured. We match that so
our ablation is comparable to theirs.

**Batch size is detected, not hard-coded.** `backend/device.py` resolves the device and
derives a starting batch from actual VRAM, so the repository moves between machines with no
edit. `python -m backend.cli doctor` prints what it would use.

| GPU class | VRAM | Starting batch | Accumulate to nbs=32 |
|---|---|---|---|
| RTX 4090 (the paper's card) | 24 GB | 32 | x1 |
| **RTX 4060 Ti** | 16 GB | 12 | x2 |
| **RTX 5070 Ti laptop** | 12 GB | 8 | x4 |
| **RTX 4060 Ti, current variant** | **8 GB** | **4 (measured)** | target nbs=32 |
| anything under 8 GB | - | requires separate fit assessment | - |

These are starting points. Record physical batch and hardware per run. nbs=32 targets gradient accumulation; it does not guarantee numerical equivalence across physical batches, optimizer steps or BatchNorm statistics. The final comparison must use the same physical batch for all three models.

**Blackwell caveat (5070 Ti).** RTX 50-series is compute capability sm_120. Older CUDA
wheels (cu124 and earlier) may not ship kernels for it and fail at runtime with "no kernel
image is available for execution on the device". If you move to that laptop, install a
CUDA 12.8+ build and verify before trusting a long run:

```bash
python -c "import torch; print(torch.cuda.get_device_capability(0)); print(torch.zeros(1).cuda())"
```

**Wall-clock.** Twelve runs at 100 epochs is likely days, not hours, on either card: the
4060 Ti has roughly a quarter of the 4090's memory bandwidth and the 12 GB laptop is slower
still under thermal limits. Agree a plan with the user
before committing the compute. Suggested: screen all twelve at ~60 epochs to rank variants,
then full-train the top two plus the baseline, and record that this is what was done.

### Augmentation
**Intended: mirroring only** (horizontal + vertical), as P004 used. The completed screens actually retained mosaic, translation, scale and HSV defaults; see the review. Freeze explicit final augmentation for all finalists before training. **No rotation** — it invalidates
the pixel↔geo mapping on geocoded imagery (`CONSTRAINTS.md`).

### The open question this phase must answer
P004 ablated LSK on a **detection** head. We are attaching it to a **segmentation** head.
Whether L5 remains optimal is genuinely untested and is the main technical risk of the
project (`RESEARCH/SYNTHESIS.md` §9 Q1).

**A negative result is a legitimate finding.** If L5 does not transfer, report it, take the
best variant that does, and record why. Do not force the expected answer.

### CFAR bright-target detector
Cell-averaging CFAR for ships and platforms — bright targets on a dark sea. No labels
needed. Required for dark-vessel candidates (PHASE-06) and to reproduce P004's manual
"white spot corresponds to the platform group" reasoning in Case 1.

## Inputs / outputs
- In: labelled tiles from PHASE-01
- Out: `weights/<selected-variant>.pt` + manifest; `detections` rows;
  `ml/ablation/results.md`

## Relevant interfaces
`INTERFACES.md` §1 (`detect`), §2 (`Detection`), §6 (weights manifest — `backend/detect`
refuses weights whose class scheme does not match).

## Relevant research
`RESEARCH/papers/P004.md` (Tables 1 and 2, §2.5, §3.2);
`RESEARCH/topics/sar-oil-spill-detection.md`;
`RESEARCH/topics/lookalike-discrimination.md` (Layers 1 and 2).

## Tests
- LSK module: output shape equals input shape; gradients flow.
- MPDIoU: matches CIoU on identical boxes; degrades correctly on disjoint boxes.
- SAHI: tiled inference on a synthetic large image recovers a known object at a known
  position (guards tile-offset bugs).
- Inference on a look-alike-only batch returns few or no detections.

## Before running the rest of the grid — ANSWERED 2026-09-01

The 2026-08-31 questions were investigated from the curves already on disk. **Do not re-run
this investigation.**

### 1. Does 60 epochs overfit? No — it UNDER-trains

| Signal | `L1-ciou` | `baseline-screen` |
|---|---|---|
| best mask mAP50-95 at epoch | **59 of 60** | **59 of 60** |
| val box / seg / cls loss at epoch 60 | all still **falling** | all still **falling** |
| gain over epochs 50→60 | **+0.0098** | **+0.0119** |

No overfitting signature anywhere: every curve is still improving when training stops.

> **The framing correction matters and is the user's:** the ~1,020 epochs is **15 independent
> models**, not one model trained for 1,020 epochs. Overfitting is a per-run property, so the
> only question is whether *one* 60-epoch run on 4,606 images overfits. It does not.

> **Consequence: the screening depth CANNOT be shortened.** Cutting to ~30 epochs was the
> proposed way to halve the remaining cost. At epoch 30 the models are still climbing steeply
> (+0.024 over epochs 30→40), so a 30-epoch ranking would rank noise on an unconverged curve.
> If cost must come down, the lever is the input pipeline (done) or cells — never depth.

### 2. Are the variants separable? L2 is; none and L1 are not

Detrended epoch-to-epoch standard deviation of mask mAP50-95 over the last 10 epochs:
**±0.0012** (`L1-ciou`) and **±0.0009** (`baseline-screen`).

The `none` vs `L1` difference is **0.00036** — about **a third of one run's own
epoch-to-epoch jitter**. It is not a difference.

`L2-ciou` completed at mask mAP50-95 **0.19048**, which is **0.00769 below `none-ciou`**
and **0.00806 below `L1-ciou`**. Both gaps exceed the ~0.004 within-run threshold, so L2
is materially worse under CIoU in this single-seed screen. This does not substitute for
multi-seed significance testing, but it is large enough to affect the screening ranking.

**Do not declare a winner from cells differing by less than ~0.004.** If the remaining cells
land inside ±0.002 of each other, **that is the finding** — report it. `SYNTHESIS.md` §9 Q1
says explicitly that a negative result is legitimate.

### 3. If cells must be cut

Unchanged from 2026-08-31: L2 and L5 are the positions P004 found best, L4 is the one it
found *degrades* under MPDIoU, and `none-mpdiou` is the loss-axis control. Cut from the
middle, and record what was cut and why in `ml/ablation/results.md`.

### 4. Cost, measured rather than assumed

Across the completed timing records at the 2026-09-01 operating point (E-core pinned,
pre-resized cache), the current median is **1.66 min/epoch**. With 3/12 cells complete and
`L3-ciou` checkpointed at 43/60, **497 of 720 screening epochs remain, estimated at
~13.8 active hours**. The
`--list` estimator now reads `results.csv` instead of the stale 2.5 min/epoch constant, which
overstated the grid by 40%.

## Acceptance criteria
- [x] Twelve 60-epoch screening runs complete, table recorded in `ml/ablation/results.md`
- [x] Multiattribute validation review and final three-model selection documented
- [x] Three selected fresh 100-epoch final runs complete and reviewed (a full 12x100 grid remains outside this budget)
- [x] Selected L1 FP32 release checkpoint hash frozen and fresh-load validation parity passed
- [x] Operating threshold and immutable inference configuration frozen on validation only
- [x] Exactly one untouched-test evaluation completed and reported separately
- [ ] Shipped variant >= baseline YOLO-seg on multi-class mAP50-95
- [ ] mAP50 >= 0.90 (P004: 94.2%)
- [ ] **Look-alike FP count strictly fewer than baseline**, reported separately (C8)
- [ ] Per-class mAP reported for both classes, not just the average
- [x] SAHI processes a full S1 IW scene without downscaling, < 60 s (three research runs: 48.0 / 53.5 / 46.8 s; excludes output serialization; band2 assumption recorded)
- [x] Weights manifest present and validated on load (single-class research export; default operational loader rejects it)
- [x] Whether LSK-at-L5 transfers to a segmentation head is **explicitly answered** in
      `ml/ablation/results.md`

## Known failure conditions
- Class imbalance: `oos` is rarer than `slick_unknown` → monitor per-class mAP, not the
  average. P004's baseline scored 70.8 / 65.7 — the average hid a real OOS weakness.
- Overfitting on a small dataset → MPDIoU is P004's stated mitigation; watch `val/cls_loss`
  for the vertical-collapse signature P004 §3.4 describes in its baseline.
- SAHI tile-boundary duplicates → NMS across tile seams.
- Ship wakes classified as `oos` (P004 Fig. 4a) → this is expected at this stage; mitigated
  in PHASE-03 and PHASE-06, not here.
- Relabelling noise from PHASE-01 propagating into class confusion → spot-check the
  confusion matrix against hand-verified examples.
