# PHASE-02 — Detection model (the research contribution)

## Objective
Train and ship a **YOLO-seg + LSK(L5) + MPDIoU** instance-segmentation model that detects
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
| anything under 8 GB | - | will not train | - |

These are **starting points, not measured limits.** Confirm on the first run and raise if
there is headroom. `nbs=32` keeps the *effective* batch at 32 on every machine, so the
ablation stays comparable to Zhao et al. Table 1 regardless of which box ran it.

**Record the physical batch actually used** in `ml/ablation/results.md`, and note if you
switched machines mid-grid: an unreported batch change invalidates the comparison, and a
grid split across two GPUs is only comparable because of the accumulation, not in spite of it.

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
**Mirroring only** (horizontal + vertical), as P004 used. **No rotation** — it invalidates
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
- Out: `weights/yolo-seg-lsk-l5-mpdiou.pt` + manifest; `detections` rows;
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

## Acceptance criteria
- [ ] Full 12-run ablation complete, table committed to `ml/ablation/results.md`
- [ ] Shipped variant >= baseline YOLO-seg on multi-class mAP50-95
- [ ] mAP50 >= 0.90 (P004: 94.2%)
- [ ] **Look-alike FP count strictly fewer than baseline**, reported separately (C8)
- [ ] Per-class mAP reported for both classes, not just the average
- [ ] SAHI processes a full S1 IW scene without downscaling, < 60 s
- [ ] Weights manifest present and validated on load
- [ ] Whether LSK-at-L5 transfers to a segmentation head is **explicitly answered** in
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
