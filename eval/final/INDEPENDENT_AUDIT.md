# Independent continuation audit — 2026-09-17

The L1 FP32 artifact is usable. Training completion is verified, but neither Phase 02 nor operational reliability is complete. This report supersedes earlier claims that a chosen model means the phase is finished.

## Evidence checked

Read the current and historical handoff, project README, every PLAN phase and design document, the screening protocol and detailed review, release reports, setup/queue instructions, research synthesis, four paper notes, six topic notes and citation index. The paper notes were used for broader literature context; this is an engineering audit, not an independent replication of every cited paper. Frontend ownership remains with the other session.

Recomputed all four artifact hashes in the L1 release manifest. Each matches. All four retained finalist/reproduction CSVs have 100 consecutive finite rows. The original L1 and FP32 reproduction curves match exactly in every column except elapsed time. The model has only class `slick`.

The oversized tensor in the inspected release is **`model.10.cv1.bn.running_var`**, a BatchNorm buffer with maximum **18,835,282**, not a learned LSK weight. FP16 conversion cannot represent it. The previous description of overflowing learned weights was inaccurate. A new save/load regression specifically preserves this buffer. Other original LSK checkpoints remain excluded from release.

The saved checkpoint's own mask AP metric is **0.15550**; the previous fresh-load result **0.155680** differs by **0.000180**. The report's **0.15622** was the maximum mask AP over the entire curve, not necessarily the saved checkpoint's metric (checkpoint fitness combines box and mask scores). The old `.004` epoch-jitter heuristic is not a statistical parity tolerance. The new common FP32 evaluator gives **0.154474**; its batch, precision and prediction cap differ from the historical validation.

## Automatic evaluation and frozen operating point

`scripts/evaluate_final_release.py` completed five sequential stages without a continuation prompt:

1. L1 validation threshold sweep, 482 tiles.
2. Plain YOLO final-control validation sweep on the same tiles/settings.
3. L1 validation at its selected operating point.
4. Control validation at its selected operating point.
5. Exactly one L1 held-out test evaluation, 627 tiles / 2,859 instances.

The protocol was recorded before inference. Threshold policy: maximum pooled validation instance F1 at mask IoU .5 over the predefined sweep, ties selecting higher confidence. This is a research operating point, not a validated safety requirement. It selected **L1 confidence .20**, control **.15**. The checkpoint, evaluator source, image/annotation bytes, split lists, settings and versions are hashed. `operational/frozen.json` was written before test inference and its hash is embedded in the test result. A started marker prevents an interrupted test from automatically rerunning. The held-out test is now **consumed**; do not use it for further tuning.

Common settings: 1024 input, batch4, workers2, CUDA0, FP32, rectangular padding, confidence floor .001, NMS IoU .7, maximum 1,000 predictions. The confidence floor is for AP; operating counts use the separately frozen threshold. No test-based architecture or threshold selection occurred.

## Results

| Measure | L1 validation (.20) | Control validation (.15) | L1 held-out test (.20) |
|---|---:|---:|---:|
| Mask AP50–95 | .154474 | .147085 | .149918 |
| Mask AP50 | .355973 | .341304 | .363622 |
| Box AP50–95 | .190672 | .176135 | .197096 |
| Instance precision | .5354 | .4303 | .5050 |
| Instance recall | .3373 | .3680 | .3557 |
| Instance F1 | .4138 | .3967 | .4174 |
| Positive-tile union Dice | .7610 | .7821 | .7437 |
| Positive-tile union IoU | .6558 | .6773 | .6343 |
| Boundary F1 | .4645 | .5029 | .4449 |
| Background alarm tiles | 19/53 | 17/53 | 12/61 |
| Look-alike alarm tiles | 13/23 | 10/23 | 8/11 |
| Look-alike FP instances | 38 | 64 | 17 |
| Small-instance recall | .1181 | .1562 | .1096 |

These operating points have different recalls; fewer FP instances at one point is not proof of better suppression. At the same confidence .25, L1/control produce **29/24** look-alike FP instances. At matched 30% recall: **29/26** instances, **11/8** alarm tiles. At matched 35% recall: **41/56** instances but **13/10** alarm tiles. There is a tradeoff, not uniform superiority. **The stricter look-alike acceptance gate remains open.**

At common confidence .25, paired validation-tile bootstrap (3,000 resamples) gives L1 minus control Dice **+.000369**, 95% interval **[-.017268, +.017614]**; instance recall **+.007579**, interval **[-.004377, +.020480]**. The look-alike alarm-rate difference is **+.130435**, interval **[-.043478, +.304348]**. These intervals exclude seed uncertainty, unknown scene dependence and model-selection bias. A universal “L1 leads all operational measures” claim is unsupported. L1 remains the selected mask-AP research candidate.

Raw evidence: `operational/*/summary.json`, `images.jsonl`, `validation_comparison.json`. Source/size/elongation results are recorded. Union metrics use evaluator-resolution masks, not geocoded physical area. **The border stratum is invalid for source-tile boundaries because it tests padded tensor edges**; its zero count must not be interpreted as zero border objects. Test AP75 was not persisted; it is not claimed, and test inference was not repeated to add it. Known overlap quarantine is not proof of scene-independent generalization. Only 11 named look-alike test tiles is a sparse sample.

## Windows execution repair

Sandbox setup logs identified failure parsing `C:/Users/adi/.codex/.sandbox/deny_read_acl_state.json`. Its 22 bytes were all zero. Preserved it as `deny_read_acl_state.corrupt-20260917.json`; sandbox setup regenerated state and ordinary sandbox shell commands now work. No broad ACL grants, security disabling or data deletion were used. The restricted account still cannot launch the installed Python interpreter, so Python runs used the approved execution path. No user action is needed for this session's execution. A later usage-limit review rejection cleared after its stated retry time; it was not bypassed.

## Remaining blockers and project corrections

- Two-class `oos`/`slick_unknown` training and per-class claims still require human-confirmed annotations. Current weights must never be presented as those classes.
- Mask AP50 .364 on test is far below the plan's .90 target; that target comes from a different paper/dataset and is not demonstrated here.
- L4 is an architectural reserve, not a verified final deployable artifact. Its retained training uses an FP32 recovery and its original saved model remains unsuitable for release.
- The six old MPDIoU runs still have the documented grid/pixel scale mismatch. They cannot validate intended MPDIoU efficacy.
- The available December GeoTIFF is `20231205T000214`, while the Case 3 specification requires `2023-12-05 23:57:19 UTC`. It is not the exact published case fixture. Reconcile acquisition and footprint before any Case 3 claim.
- Existing SAR TIFFs have unnamed bands. Scene benchmarking explicitly records the historical band2 VV/dB assumption; metadata alone does not verify it.
- Full regression suite: **454 passed, 8 skipped**, 208.08 seconds. Six database tests skipped because the configured session pooler returns tenant/user not found; two require a hybrid CPU. Existing historical database population claims were not reverified. Connection settings/project availability must be checked before downstream integration.
- External Aikido scanning remains unperformed: the earlier automatic approval review rejected source transfer without explicit authorization. That restriction was preserved; no external security result is claimed.

## Next implementation milestone

Added byte-preserving research export and a hash/class-checked loader. The default loader refuses `slick` weights when the requested scheme is `oos/slick_unknown`; research use is explicit. Streaming GeoTIFF inference reuses existing tiling, uses native-resolution masks, preserves holes, excludes invalid/land-zero pixels and maps pixel edges through the affine transform. SAHI supplies candidate seam groups; actual mask overlap is required before union and matching repeats to resolve partial-tile chains. Synthetic raster tests exercise the complete tiling-to-GeoJSON path.

Three full scenes completed automatically, each as 864 native-resolution tiles:

| Acquisition | Seconds | Raw predictions | Merged polygons |
|---|---:|---:|---:|
| 2023-04-09 00:02:06 | 48.009 | 112 | 86 |
| 2023-05-15 00:02:08 | 53.547 | 313 | 240 |
| 2023-12-05 00:02:14 | 46.835 | 57 | 40 |

Timing includes model loading, raster reading, inference, merging and georeferencing; excludes GeoJSON serialization. These are single runs, not percentile latency guarantees. Every exported polygon is nonempty, valid, finite and inside its source scene bounds. Maximum geographic-to-pixel edge roundtrip error is 1.17e-10 pixels. This checks coordinate arithmetic, not external geolocation accuracy or detection truth. Synthetic tests additionally verify holes, seam merging, class/hash rejection and explicit missing-band assumptions: **3 passed**. Evidence and output hashes: `scenes/benchmark.json`.

Phase 02 has **9/13 checklist items complete (69%)**, an unweighted acceptance count rather than an estimate of effort spent. Architecture training is 100% complete. Four accuracy/classification gates remain open; no defensible completion date exists until human relabeling scope and achievable model quality are established. Geometry/wind gating is the next implementation milestone; integration scope and manual validation still need assessment. Research detections must not be promoted automatically to operational accusations.
