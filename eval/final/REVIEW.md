# Final model review — corrected 2026-09-17

> **Independent continuation audit:** Read [INDEPENDENT_AUDIT.md](INDEPENDENT_AUDIT.md) for the newly completed final-release/control operational comparison, frozen threshold and one-time test results. The tables below comparing L1/L4 operational measures are screening evidence, not final-release measurements. L1 is not uniformly better than the control on false alarms, Dice or recall. Overflow was identified in a BatchNorm statistics buffer, not learned LSK weights; the `.004` heuristic below is not a statistical parity tolerance. Test is now consumed.

## Recommendation

**Choose `L1-ciou`.** It is the strongest segmentation model across both comparable checkpoint evaluations and the completed 100-epoch final training curves. Masks are the primary project output because they drive geometry, drift seeding and attribution.

`L4-ciou` is the reserve when false-alarm suppression or box quality matters more than mask coverage. `none-ciou` remains the control and a usable fallback, but the evidence does not support selecting it over L1.

This selection now has a verified release artifact. The FP32-safe reproduction completed 100 epochs and an independent fresh load reproduced validation performance within 0.00054 mask mAP50-95. The earlier report incorrectly treated the old serialization defect as evidence that plain YOLO was the better model; it was not.

## Evidence inventory

All 45 current project-authored Markdown files were reread; generated `.venv` and cache documentation was excluded. The current status documents now record completed finalist training, L1 selection and the verified FP32 release. Primary artifacts establish that all finalists and the release reproduction finished.

Evidence is separated into:

1. `eval/screening/aggregate.json`, per-model `summary.json`, `matched_recall.json`, and `paired_bootstrap.json`: identical 585-image evaluator and full operational metrics. Missing `none-ciou` screening weights mean this layer compares L1 and L4 only.
2. `eval/final_preflight/validation_v2/{L1-ciou,L4-ciou}/summary.json`: independent reevaluation on the revised 484-image `final-v2` validation split.
3. `runs/final/*/results.csv` and `runs/final_recovery_fp32/L4-ciou/results.csv`: fresh 100-epoch `final-v11` comparison including none.
4. `run.json`, logs, recovery provenance and hashes: completion, numerical and artifact-lifecycle evidence, not substitutes for multiattribute evaluation.

No held-out test prediction was used. The full budget is complete: 60 reference + 720 screening + 300 final = **1,080 epochs**.

## AP results

### Common 585-image evaluator

| Model | Mask AP50-95 | Mask AP50 | Mask AP75 | Box AP50-95 | Box AP50 | Box AP75 |
|---|---:|---:|---:|---:|---:|---:|
| `L1-ciou` | **0.194748** | **0.420831** | **0.161112** | 0.260767 | **0.444768** | 0.269158 |
| `L4-ciou` | 0.189070 | 0.412064 | 0.157318 | **0.264022** | 0.442953 | **0.271523** |

### Revised 484-image `final-v2` reevaluation

| Model | Mask AP50-95 | Mask AP50 | Mask AP75 | Box AP50-95 | Box AP50 | Box AP75 |
|---|---:|---:|---:|---:|---:|---:|
| `L1-ciou` | **0.197083** | **0.417604** | **0.167401** | 0.258292 | **0.438420** | 0.267527 |
| `L4-ciou` | 0.190419 | 0.407515 | 0.162492 | **0.260181** | 0.434850 | **0.267758** |

L1 wins every mask AP measure in both evaluations; L4 has a small box edge.

### Fresh 100-epoch `final-v11` training

All three retained CSVs contain 100 finite epochs.

| Model | Peak mask AP50-95 | Epoch | Peak mask AP50 | Epoch | Peak box AP50-95 | Epoch |
|---|---:|---:|---:|---:|---:|---:|
| `L1-ciou` | **0.15622** | 71 | **0.35903** | 67 | 0.19015 | 66 |
| recovered `L4-ciou` | 0.15076 | 48 | 0.35785 | 52 | **0.19555** | 57 |
| `none-ciou` | 0.14837 | 66 | 0.34370 | 58 | 0.17673 | 79 |

L1 again leads segmentation; L4 leads boxes; none trails both LSK models on peak mask AP. L4's original AMP run developed persistent NaNs. Its retained run resumes epoch 11 and uses FP32 for epochs 12–100, so it is not a perfectly precision-matched comparison.

## Operational behavior at confidence 0.25

Expanded none metrics are unavailable because its screening checkpoint was missing; the differently initialized reference baseline is not a substitute.

| Measure | `L1-ciou` | `L4-ciou` |
|---|---:|---:|
| Instance recall | **0.3282** | 0.3047 |
| Instance precision | 0.6536 | **0.6719** |
| Union Dice | **0.7811** | 0.7728 |
| Union IoU | **0.6817** | 0.6754 |
| Boundary F1 | **0.5124** | 0.5040 |
| Pixel precision | 0.9135 | **0.9170** |
| Pixel recall | **0.7862** | 0.7842 |
| Relative area bias | **-13.94%** | -14.47% |

L1 recovers 964/2,937 instances versus L4's 895. Both still miss many small components, so Dice near 0.78 is not operational detection accuracy.

At confidence 0.25, background FP images/instances are 5/17 for L1 and 4/11 for L4; look-alike FP images/instances are 4/6 and 3/3; both have one no-oil FP tile. L4 is more conservative at this threshold, but the 23-look-alike sample is small and the paired bootstrap interval spans improvement and harm.

At matched 30% recall L1/L4 have 3/2 look-alike alarm tiles; at 40%, 7/5. The tradeoff is not global: at 40% recall total background alarm tiles are 8 versus 10, and at 45% recall the look-alike result reverses to 7 versus 8. L4 is complementary, not universally safer.

## Size, shape and source robustness

| Recall stratum | `L1-ciou` | `L4-ciou` |
|---|---:|---:|
| Small, n=1,273 | **0.1178** | 0.0801 |
| Medium, n=659 | **0.2701** | 0.2489 |
| Large, n=1,005 | **0.6328** | 0.6259 |
| Elongated, n=46 | 0.3696 | **0.4130** |
| Border, n=1,251 | **0.5004** | 0.4964 |

L1's small-object lead is the practically important difference. L4's elongated advantage represents two objects in a sparse subset.

Positive-image Dice / instance recall for L1 versus L4 is **0.878 / 0.103** versus 0.763 / 0.082 on Part III, **0.776 / 0.435** versus 0.771 / 0.430 on Refined SOS, and **0.782 / 0.278** versus 0.780 / 0.231 on Part I. L1 leads source coverage consistently; Part III remains sparse.

## Speed and cost

Common-evaluator inference is 6.13 ms/image for L1 and 6.02 for L4; peak allocated CUDA memory is 430.7 and 434.5 MiB, and both checkpoints are about 6.29 MiB. Revised-evaluator inference is 6.48 and 6.29 ms. These are not repeated latency benchmarks and exclude full-scene SAHI; differences are too small to decide selection. The final none checkpoint is smaller (6,096,484 bytes versus 6,603,732), but its mask deficit matters more than roughly 0.5 MB.

## Provenance and checkpoint anomaly

The common/revised evaluations use screening checkpoints recorded in `eval/screening/provenance.json` (L1 SHA-256 starts `c40acad...`; L4 `0f9cd7c...`). Fresh final `best.pt` hashes are:

- none: `d94f24306ffd8a551a754bce1c2088d03bb6aaf17f6a893d304c4bf50b68b1d0`
- L1: `543b6dcb8a722371c4c54fff3f12bc51125cdbf6c3d32f0972ea45be8582132b`
- recovered L4: `c6e2c3b49b8759d561a517465438d014eebb04418fd3207ed2f2873e239ab660`

The original final L1/L4 `run.json` validations and later reload attempts fell far below their in-training CSV metrics, while none reloaded consistently. Those original files remain unsuitable for release, but the verified FP32 L1 artifact closes the blocker without changing the architecture ordering: L1 leads mask AP in the common evaluation, revised-data reevaluation and final training.

The cause is now proven in the installed Ultralytics save path: it deep-copies the live FP32 EMA, converts it with `.half()`, then sanitizes non-finite values. Finite LSK weights above FP16's maximum (65,504) overflow during that conversion and are irreversibly replaced, while live FP32 validation remains healthy. This explains why L1/L4 collapse after reload and the none control does not. The corrected trainer serializes the EMA in FP32; its two-epoch L1 save/reload smoke test reproduced identical validation metrics.

## Final ranking

1. **`L1-ciou` — selected.** Best repeated mask quality, recall, small-object coverage and source robustness, at effectively the same cost as L4.
2. **`L4-ciou` — reserve.** Better boxes, fixed-threshold precision, look-alike counts and elongated recall, but weaker mask coverage and a mixed-precision recovery.
3. **`none-ciou` — control/fallback.** Smallest and currently reloadable, but lowest final peak mask result and missing expanded screening evidence.

This remains a single-class `slick` model selected on internal validation, not a certified two-class `oos`/`slick_unknown` detector or proof of external scene generalization.

## Verified release

The FP32-safe reproduction completed 100/100 finite epochs with zero stderr. Its curve reproduced the original final L1 run: peak mask mAP50-95 0.15622 at epoch 71 and peak box mAP50-95 0.19015 at epoch 66. Independent exact-setting fresh-load validation scored mask mAP50-95 0.155680, mask mAP50 0.357024, box mAP50-95 0.189755 and box mAP50 0.367098. The 0.00054 mask delta is inside the project's ~0.004 within-run tolerance, so the release gate passes.

Artifact: `runs/final_l1_fp32_release/L1-ciou/weights/best-fp32.pt`; SHA-256 `d4a74906e3a9b692c14f28305baf3cb20ba63da4c38bc30dbabd14c5c6d1fc6c`. The hash was recomputed and matches `release.json`. The untouched test split remains unused.

## Next step

Run the full operational evaluator on the verified release checkpoint using validation only, then freeze the confidence threshold and complete inference configuration. Evaluate exactly once on the untouched test set. Next complete full-scene SAHI seam/runtime checks, geocoded mask geometry, real null-scene wind gating and downstream drift/AIS attribution.

No additional architecture training is planned. A future two-class `oos`/`slick_unknown` retrain remains necessary for the original two-class claim, but it is blocked on human relabeling and must not be conflated with the immediate release evaluation.
