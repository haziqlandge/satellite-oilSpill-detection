# PHASE-02 ablation — LSK placement x IoU loss

## Final outcome — 2026-09-17

All 1,080 planned selection epochs are complete, plus the separate 100-epoch FP32 artifact reproduction. L1-CIoU remains the selected single-class research model. Fresh common final-v11 validation mask AP50–95 is .154474 for the released L1 and .147085 for the plain-YOLO control. The L1 test split was evaluated once after freezing confidence .20; mask AP50–95 is .149918. See [independent audit](../../eval/final/INDEPENDENT_AUDIT.md) for operational tradeoffs and limitations.

**Does L5 transfer as the preferred segmentation placement? Not supported by this experiment.** In the common 60-epoch screen L5-CIoU mask AP was .18854 versus L1's .19475, with weaker Part III coverage and more look-alike alarms at matched recall. L5 was not promoted to a fresh100 finalist. This is a conditional result on one seed and this dataset, not proof that L5 cannot help segmentation. The intended MPDIoU interaction remains unanswered because of the documented coordinate-scale defect. The historical table below is preserved.

## Historical screening record

Screened at **60 epochs**, not the 100 of P004 §2.7. **A screened grid is not a 100-epoch grid** and these numbers are not directly comparable to Zhao et al. Table 1 without saying so.

Segmentation mask metrics (`M`), single `slick` class — this is a **binary baseline**, not the two-class `oos` / `slick_unknown` model, which needs the human relabelling pass first.

`workers` records the loader setting used on each machine. Hardware and mid-run physical-batch changes are documented in `HANDOFF.md`; `nbs=32` is retained, but does not guarantee numerical equivalence across batches.

## Interpretation updated after multiattribute review — 2026-09-15

[Detailed review](../../eval/screening/REVIEW.md) and [prospective protocol](../../PLAN/SCREENING_REVIEW.md) are the selection evidence. **Finalists: none-ciou, L1-ciou, L4-ciou; reserve L5-ciou.** Below are original recorded training-summary metrics, not the common FP32 re-evaluation.

The old ~.004 noise floor was an epoch-jitter heuristic, not a statistical threshold. Single-seed, mixed-hardware runs cannot establish statistical equivalence or causality. None-ciou's original screen checkpoint is missing; its summary must not be replaced by the differently initialized baseline-screen. MPDIoU-labeled runs used a grid/pixel normalization mismatch and represent the implementation as trained, not a validated intended-MPDIoU comparison. Two train/val duplicate pairs were found. Read the limitations before interpreting rankings.

All eleven available curves still have positive last-ten-epoch trends; this supports the planned fresh100 comparison without guaranteeing convergence or deployment reliability. **780/1080 overall epochs done; 300 final epochs remain.**

**Progress: 12 of 12 screening cells complete.**

| LSK | Loss | mAP50-95 (M) | mAP50 (M) | batch | workers |
|---|---|---|---|---|---|
| none | CIOU | 0.198 | 0.429 | 8 | 4 |
| L1 | CIOU | 0.199 | 0.431 | 8 | 3 |
| L2 | CIOU | 0.190 | 0.420 | 8 | 2 |
| L3 | CIOU | 0.188 | 0.413 | 4 | 2 |
| L4 | CIOU | 0.191 | 0.417 | 4 | 2 |
| L5 | CIOU | 0.193 | 0.421 | 4 | 2 |
| none | MPDIOU | 0.188 | 0.411 | 4 | 2 |
| L1 | MPDIOU | 0.190 | 0.413 | 4 | 2 |
| L2 | MPDIOU | 0.184 | 0.406 | 4 | 2 |
| L3 | MPDIOU | 0.188 | 0.413 | 4 | 2 |
| L4 | MPDIOU | 0.192 | 0.415 | 4 | 2 |
| L5 | MPDIOU | 0.192 | 0.418 | 4 | 2 |
