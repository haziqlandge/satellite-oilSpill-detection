# Final model completion and next-session handoff

> **Superseded continuation status, 2026-09-17:** The operational comparison, validation-only threshold freeze (.20), and one-time held-out test evaluation are complete. Research export and streaming full-scene inference are implemented. Read [INDEPENDENT_AUDIT.md](INDEPENDENT_AUDIT.md) and the current HANDOFF for verified results and remaining gates. The untouched-test statements below describe the earlier handoff. Learned-weight and `.004` parity-tolerance claims below are corrected in the audit.

**Completed:** 2026-09-17  
**Selected model:** `L1-ciou`  
**Held-out test status:** untouched

## What has been completed

1. Completed the 60-epoch reference run, all twelve 60-epoch screening cells, and all three 100-epoch finalists: **1,080 selection epochs**.
2. Re-evaluated the model evidence and selected `L1-ciou`. It leads repeated mask AP comparisons and has the best recall, Dice, boundary F1, small-object recall and source coverage. `L4-ciou` remains the precision/box-quality reserve; `none-ciou` remains the control/fallback.
3. Diagnosed the failed L1/L4 checkpoint reloads. Ultralytics converted the live FP32 EMA to FP16 while saving; large finite LSK values saturated and were sanitized, corrupting the serialized model.
4. Added the FP32-safe release/resume checkpoint path and a regression test. A two-epoch L1 smoke test passed save, reload, prediction and validation.
5. Reproduced the selected L1 model for 100 epochs using the frozen `final-v11` data, shared initialization, seed and hyperparameters. All epochs are finite; stderr is empty.
6. Independently loaded the completed release in a new Python process and validated it on the frozen 482-image validation split with the exact training-validator settings.

## Verified release evidence

| Item | Result |
|---|---:|
| Reproduction epochs | 100/100 |
| Runtime | 13,882 s (3.86 h) |
| Live peak mask mAP50-95 | 0.15622 at epoch 71 |
| Fresh-load mask mAP50-95 | 0.155680 |
| Fresh-load mask mAP50 | 0.357024 |
| Fresh-load box mAP50-95 | 0.189755 |
| Fresh-load box mAP50 | 0.367098 |
| Live/reload mask delta | 0.00054 |
| Allowed within-run tolerance | approximately 0.004 |
| Training stderr | 0 bytes |

Release checkpoint:

`runs/final_l1_fp32_release/L1-ciou/weights/best-fp32.pt`

SHA-256:

`d4a74906e3a9b692c14f28305baf3cb20ba63da4c38bc30dbabd14c5c6d1fc6c`

The recomputed hash matches `runs/final_l1_fp32_release/L1-ciou/release.json`. Exact fresh-load settings and metrics are stored in `eval/final/release_validation.json`.

## What the next session must do

1. Use **only the validation split** to run the full operational evaluator against `best-fp32.pt`: AP/AP75, precision/recall, Dice/IoU/boundary F1, negative/look-alike false alarms, source/size/shape strata, matched-recall checks and speed.
2. Choose and record the operating confidence threshold and every inference setting needed to reproduce it. Do not tune anything on the test split.
3. Freeze the checkpoint hash, threshold and inference configuration together.
4. Run exactly one evaluation on the untouched test split and report it separately from validation/model-selection results.
5. Run full-scene SAHI acceptance: seam de-duplication, no downscaling, geocoded-mask integrity and the <60 s scene target.
6. Continue Phase 03 and downstream integration: geometry/head-tail, null-scene wind gate, drift seeding, AIS attribution and evidence cards.

## GPU requirement

No additional heavy training is required for the immediate next session. The next tasks are inference/evaluation and should use the GPU for short or moderate runs, not multi-hour training.

A future heavy GPU run is required only if the project proceeds to its original two-class `oos`/`slick_unknown` claim. That work is blocked on human relabeling; do not start it before the labels and acceptance protocol are frozen.
