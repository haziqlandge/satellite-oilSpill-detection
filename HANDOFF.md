# HANDOFF

Continuation state. **Read this first, then `PLAN/INDEX.md`, then your current phase file.**

**Last updated:** 2026-09-17

## Latest continuation — Phase 02 closure, labels verified with publisher

The user requested finishing Phase 02 rather than moving on to Phase 03. See `eval/phase2-closure/STATUS.md`. Verified actual extracted folders and Zenodo descriptions: Oil/Lookalike/No oil are supplied, but `oos` versus `slick_unknown` per-instance labels are not. P004's two-class data is available on request, not the same Zenodo category split. Phase 02 remains **9/13 (69%)**, not complete.

Fixed missing-review fallback to class0, component-ID shifts after speck filtering, CLI bypass of reviewer attribution, and stale-output risks. `--confirmed` now requires attributed, source-hash-bound review JSONs in a directory; two-class builds require a new output directory. Prepared `eval/phase2-closure/annotation-pilot/index.html` and 24 review documents; inventory covers 3,455 eligible positive train/val tiles and 17,402 existing polygons. All confirmations remain empty. The 24 regenerated single-class labels match existing labels exactly. No old training data, weights, frozen evaluator or test outputs were changed.

Full suite: 464 passed, 8 skipped; focused annotation/loss suites rerun after the final stale-output guard. No training was launched. Existing measured 100-epoch FP32 run took 3.86 hours; a two-model comparison is roughly 8 GPU-hours at comparable settings/data, after labels and data QA. Annotation time and attainable quality are unknown, so no guaranteed phase ETA. Continue Phase 02 with confirmed source labels and an independently frozen evaluation protocol; do not declare folder names equivalent to the missing classes or tune on the consumed test.

# CURRENT STATE — 2026-09-17, independent evaluation and full-scene inference complete

Read `eval/final/INDEPENDENT_AUDIT.md` first for current evidence and corrections. The earlier release narrative below is historical. **L1 remains the mask-AP research choice, but does not lead every operational metric.** It has one `slick` class, not the operational two-class scheme.

- Training: 1080/1080 planned reference/screening/final epochs plus 100/100 FP32 reproduction epochs complete. All retained finalist CSVs and release hashes independently checked. No training or evaluation queue remains running from this continuation.
- `scripts/evaluate_final_release.py` ran all five stages automatically. Validation selected L1 confidence **.20**, control **.15**; settings/data/source/checkpoint hashes were frozen before test. L1 validation mask AP50–95 **.154474**, control **.147085**; L1 test **.149918**, AP50 **.363622**. **The held-out test is now consumed: do not tune on it or repeat inference to fill missing metrics.** Evidence: `eval/final/operational/`.
- `scripts/analyze_final_release.py` compared saved validation predictions without new test inference. Look-alike performance is mixed, and paired intervals include zero. The strict look-alike superiority acceptance gate remains open. Border-stratum flags are invalid for unpadded source edges; test AP75 was not persisted. Neither is claimed.
- `ml/export/export.py` exports byte-identical `weights/L1-ciou-research.pt` plus manifest. Loader verifies checkpoint hash and classes; default operational class expectations reject these single-class weights. Selected SHA-256 remains `d4a74906e3a9b692c14f28305baf3cb20ba63da4c38bc30dbabd14c5c6d1fc6c`.
- `backend/detect/yolo_lsk/infer.py` implements streaming full-scene masks, SAHI candidate seam grouping with actual mask-overlap checks, hole preservation, invalid-pixel clipping and affine geocoding. Three scenes ran sequentially at native resolution (864 tiles each), in **48.0 / 53.5 / 46.8 seconds**. Outputs contain **86 / 240 / 40** merged polygons. All geometries are valid, finite and inside scene bounds; pixel-edge roundtrip error < 1.2e-10 pixels. See `eval/final/scenes/benchmark.json` and GeoJSONs. Timing excludes JSON serialization and is not a latency percentile guarantee.
- Legacy rasters have unnamed bands: runs explicitly assumed band2 VV Sigma0 dB and record that metadata is unverified. December acquisition **00:02:14** differs from required Case 3 **23:57:19**. Do not claim exact Case 3 replication or derive published-source attribution from this fixture.
- Full regression: **454 passed, 8 skipped** (208 s), then **3 focused scene-inference tests passed** after adding that path. Six DB tests skipped because the configured pooler reports tenant/user not found; two require a hybrid CPU. No DB health claim. External Aikido source transfer remains prohibited by the prior automatic approval rejection; no scan result claimed.
- Windows repair: a 22-byte zero-filled `.codex/.sandbox/deny_read_acl_state.json` caused setup parsing failure. Preserved it as `deny_read_acl_state.corrupt-20260917.json`; setup regenerated state and ordinary sandbox commands work. Python still uses approved execution because the restricted account cannot launch the installed interpreter. No broad ACL changes; no user action needed for current execution.

**Progress:** Phase 02 **9/13 acceptance items (69%)**, training **100%**. Remaining gates: multi-class comparison, AP50 >= .90, strict look-alike improvement and per-class reporting. This percentage is a checklist count, not a time estimate. Full phase ETA cannot be established before human labels and model-quality gates are resolved.

**Next authorized work:** geometry/characterisation and wind-gate integration (Phase 03), starting with inspection of existing implementations and met-ocean readers. Preserve ambiguous head/tail endpoints, project area to equal-area coordinates, and keep outputs research-only. Manual three-slick QGIS verification, correct Case 3 acquisition, band provenance and working DB configuration remain prerequisites for relevant operational acceptance. Do not alter `frontDemo/`, which another session owns. Do not retrain or rerun the consumed held-out test as a shortcut.

---

# HISTORICAL STATE — 2026-09-17, L1 release complete and verified

All planned architecture training is complete: 60 reference + 720 screening + 300 final + the 100-epoch artifact reproduction. The extra reproduction repairs release serialization; it is not a fourth candidate or a new model-selection experiment. **`L1-ciou` remains selected** for mask AP, recall, Dice, boundary F1, small-object recall and source coverage. `L4-ciou` is the precision/box-quality reserve; `none-ciou` is the control/fallback. Full evidence: `eval/final/REVIEW.md`.

The FP32-safe reproduction completed 100/100 finite epochs in 13,882 s with zero stderr. It reproduced the original live curve exactly: peak mask mAP50-95 **0.15622 at epoch 71** and peak box mAP50-95 **0.19015 at epoch 66**. An independent new-process reload using the exact validation settings (`imgsz=1024`, batch 8, CUDA FP16 inference) scored mask mAP50-95 **0.155680**, mask mAP50 **0.357024**, box mAP50-95 **0.189755** and box mAP50 **0.367098**. The mask delta from the live peak is **0.00054**, inside the project's ~0.004 within-run tolerance; the previous near-zero reload collapse is resolved.

Immutable release artifact: `runs/final_l1_fp32_release/L1-ciou/weights/best-fp32.pt`; SHA-256 **`d4a74906e3a9b692c14f28305baf3cb20ba63da4c38bc30dbabd14c5c6d1fc6c`**, independently recomputed and matched to `release.json`. The untouched test split has not been used.

Next session must: (1) run the full operational evaluator on this release checkpoint using validation only; (2) choose and record the confidence/operating threshold and immutable inference configuration; (3) evaluate once on the untouched test split; (4) run full-scene SAHI seam and <60 s runtime acceptance; then (5) continue geocoded mask geometry, wind gating and drift/AIS attribution. No heavy GPU training is required for these immediate tasks—only short/moderate inference. A future two-class `oos`/`slick_unknown` retrain is heavy GPU work, but it is blocked on human relabeling and is not the next task.

Detailed completion and next-session checklist: `eval/final/COMPLETION_SUMMARY.md`.
---

# HISTORICAL STATE - 2026-09-16, L4 FP32 recovery running

none-ciou and L1-ciou completed 100/100 each. Original L4 developed NaN training and
validation losses, retried library recovery, then failed at 18:00 IST. That queue exited.
Do not resume its `last.pt` or count its non-finite epochs as valid progress.

An isolated recovery launched around **19:02 IST**, launcher PID **18552**:
`.venv/Scripts/python.exe -u -m scripts.recover_final_l4`.
It resumes the preserved `epoch10.pt` (11 completed epochs) toward 100 total, with
**FP32 from epoch 12**, batch4 and the original optimizer/augmentation/data settings.
The two completed finalists used AMP throughout; this precision/recovery deviation
must accompany later comparisons. All original final artifacts and frozen source
hashes remain unchanged.

- Recovery output: `runs/final_recovery_fp32/L4-ciou/`.
- Recovery provenance: `runs/final_recovery_fp32/recovery.json`.
- Controller log/PID: `runs/session_logs/final_recovery_fp32/queue.stdout.log`,
  `queue.stderr.log`, `queue.pid`; worker log: `after-11.log` initially.
- Stop after current timed chunk: create `runs/session_logs/final_recovery_fp32/queue.stop`.
- Automatic resume uses the same global queue lock and Windows idle-sleep prevention.
  Errors halt the controller; reboot/logoff still require restarting the command.

Diagnosis: same 16 images/weights yielded non-finite head activations for original
last.pt under FP16 autocast but finite activations in FP32. The epoch-11 checkpoint
and optimizer state are finite. Installed Ultralytics sanitizes saved NaN/Inf tensors,
so tensor finiteness alone cannot certify later checkpoints. Evidence:
`eval/l4-nan-diagnostic.json`. Recovery uses the earlier clean checkpoint, not sanitized
late weights. The exact first triggering training minibatch was not replayed.

`FiniteFP32Trainer` forces AMP off after checkpoint argument restoration, checks losses
and gradients before optimizer updates, and checks losses/metrics/model/EMA/optimizer
before checkpoint writing. Completion requires all 100 consecutive finite CSV epochs.
**12 focused tests pass**, including failure guards, actual resume-argument behavior,
queue continuation and manifest checks; Ruff passes. No external security scan was
performed under the previously recorded source-transfer approval restriction.

Original progress is 200 completed finalist epochs plus 11 retained L4 epochs at
recovery start. Recovery repeats discarded work; it is not an extra fourth model.
Winner selection, held-out inference and full-system resolution verification still
await the user's later request. Check live progress before reporting completion/ETA.

---

# HISTORICAL STATE - 2026-09-16, final comparison queue launched

The final preflight passed. Background queue launched at **09:04 IST**, launcher PID
**31820**. Verify process identity before restarting. Order: **none-ciou -> L1-ciou ->
L4-ciou**, each 100 fresh epochs, then stop for the user's winner selection and final
resolution review. Training was observed in epoch 1; this records launch, not completion.

- Command: `.venv/Scripts/python.exe -u -m scripts.train_queue --final`.
- Logs/PID: `runs/session_logs/final/queue-20260916.stdout.log`, `.stderr.log`, `.pid`.
- Child logs: `runs/session_logs/final/queue-<cell>-<timestamp>.log`.
- Outputs: `runs/final/<cell>/`; configuration/source hashes: `runs/final/frozen.json`;
  preflight evidence/runtime versions: `runs/final/preflight_gate.json`.
- Stop after active run/chunk: create `runs/session_logs/final/queue.stop`.
- Instructions: `scripts/FINAL_TRAINING.md`. Timed checkpoints resume automatically;
  completion starts the next model; errors/no progress stop the queue.

Newer preflight code existed beyond the previous Markdown handoff. Its final-v1 gate
was blocked on cropped/rotated cross-split overlap. Continued conservative quarantine
through **final-v11: 3355 train / 482 validation / 627 test**. Post-removal registration
search found **zero candidates** across all split pairs. This is approximate image
matching, not proof of scene independence. Original files/versions remain intact.
1251 training and 103 validation tiles are excluded relative to the original split;
all test tiles remain reserved. No test inference or test-based threshold selection.
Final scores are not directly comparable to screening's different data/augmentation.

All three use the same 378 pretrained non-head tensors and identical initial head,
CIoU, seed0, batch4, workers2, nbs32, 1024px, AdamW lr=.002 and mirroring only.
The obsolete frozen configuration is archived in `runs/final/preflight_archive_20260915/`.
Training verifies source/data hashes and split membership; completed artifacts receive
checkpoint/CSV/argument/run-record hashes. Screening results are preserved: all eleven
available checkpoint hashes still match the review. Missing none-ciou screen weights
remain missing.

Checks: full suite **446 passed, 8 skipped**; after strengthened queue resume/advance/skip
and manifest-membership regressions, **8 focused checks passed**; changed files pass Ruff.
All three fresh two-epoch numerical smoke tests passed (finite losses, valid predictions,
checkpoint reload, resumable saved epoch). Their 40 train and 20 validation samples all
remain in final-v11. Smoke tests are separate from the final 300-epoch budget.
Evidence: `runs/final_sanity_20260916/`, `eval/session-tests-20260916.log`,
`eval/queue-checks-20260916.log`, `eval/retained-v11-overlap-audit.log`.

Database integration/hardware-dependent skips and full-system acceptance remain open.
External Aikido scanning remains unperformed under the prior source-transfer approval
restriction; no scan success is claimed. The user will request winner selection and
verification of remaining issues after these runs finish. Do not select a winner or
start held-out inference yet. Idle sleep is prevented; reboot/logoff require restart.

---

# HISTORICAL STATE — 2026-09-15, screening reviewed and finalists selected

**Read this header instead of the historical queue/PID entries below.** The queue finished normally at **19:07:18 IST**. Screening is **720/720**, plus the independent reference **60**: **780/1080 epochs done, 300 left**. No final training was launched in the review session.

## Decision and evidence

- Final comparison: **none-ciou, L1-ciou, L4-ciou**, each a fresh 100 epochs; reserve **L5-ciou**. This replaces the ambiguous “L5 baseline” assumption with an explicit plain-YOLO architecture control.
- Read **[PLAN/SCREENING_REVIEW.md](PLAN/SCREENING_REVIEW.md)** (protocol) and **[eval/screening/REVIEW.md](eval/screening/REVIEW.md)** (detailed evidence and continuation gates). Machine-readable choice: `eval/screening/selection.json`.
- All eleven available grid best.pt files were evaluated on the same **585 validation images / 2937 instances**, with raw per-image evidence, mask/box AP, fixed-confidence P/R, separate FP counts, union Dice/IoU/boundary F1, source/size/elongation/border strata, curves, paired tile bootstrap and inference resources. Three close CIoU candidates have exact matched-recall checks, common qualitative panels and max_det1000 sensitivity (no shortlist change).
- L1 common mask AP=.19475, Dice=.781, instance recall=.328 at .25. L4=0.18907, Dice=.773, recall=.305. L5=0.18854. At matched 40% recall: look-alike FP tiles L1/L4/L5=7/5/11 of 23. L4 is complementary, not universally safer. Tiny-object recall is poor for every candidate.

## Findings that must not be lost

1. `runs/ablation/none-ciou` contains run.json but no screen checkpoint or CSV. Completion is recorded but expanded baseline metrics are unavailable. `runs/segment/baseline-screen` used different initialization and is not a substitute.
2. Actual MPDIoU patch mixes grid-unit box corners and pixel image normalization: distance penalty is underweighted by stride squared (64/256/1024). Old weights were preserved; no loss patch changed. Corrected experiments require new names, tests and additional budget. The six old rows are empirical as-implemented results, not valid intended-MPDIoU evidence.
3. Two exact cross-split duplicates: train 8346860 Oil00357 / val Oil00356, and train Oil01339 / val Oil00007. See dataset_audit.json and train_val_manifest.json. Tile CRC32 splitting does not ensure scene independence. Excluding the two known val duplicates does not reverse the fixed-metric shortlist.
4. Data is one `slick` class. Train negatives=369/4606; val negatives=55/585; named look-alikes=116 train and 23 val. Part III was mixed into train/val, Part II skipped. Test images/labels were not read in this review.
5. All runs seed0, mixed GPUs/physical batches. nbs=32 is not numerical equivalence. Actual augmentation included mosaic/scale/translation/HSV despite mirroring-only prose. Auto optimizer selected AdamW lr=.002 in the verified log. Epoch jitter is not a statistical confidence interval.
6. The full system and Phase 02 acceptance are unfinished: human two-class labels, independent holdout, full-resolution/geocoded masks, SAHI seams, null-scene wind gating and downstream attribution remain gates. No reliability certification from this screen.

## Next session — concrete order

1. Preserve results and checkpoint hashes. Recover the original none-ciou weights from the prior machine/archive if available; otherwise retain the documented missing baseline limitation.
2. Version a duplicate/scene-aware final dataset/manifest; audit reserved test provenance without selecting on test results. Review sparse hard negatives and tiny/edge annotations. Keep the old dataset/results intact.
3. Freeze the same final configuration for all three: fresh100, imgsz1024, batch4, workers2, nbs32, seed0, CIoU and identical non-head transfer. Explicitly settle optimizer and augmentation as specified in the report; do not silently inherit defaults or alter only one finalist.
4. Implement/verify final-specific output and queue handling. **Do not resume screen last.pt and do not overwrite ml/ablation/results.md.** The current ablation runner automatically resumes directories and rewrites that table; final runs need a separate output/results path. The user requested analysis/selection this turn; final training remains unstarted.
5. Train only the three selected final runs when proceeding; tune thresholds on validation, freeze models/settings, then run reserved test and scene-level acceptance. Three runs remain 300 epochs; repeated seeds or a repaired MPDIoU grid are extra budget, not silently included.

## New artifacts and verification

`scripts/review_screening.py`, `scripts/audit_screening_artifacts.py`, `scripts/summarize_screening.py`, `scripts/plot_screening_review.py`, `tests/test_review_screening.py`. See report for commands and metric definitions. Two targeted tests and Ruff checks passed. Aikido external scan was rejected by automatic approval review because source transfer lacked explicit authorization; no scan success is claimed. Do not bypass that rejection.

Current hardware **RTX 4060 Ti 8 GB / 32 GB RAM**, full resources authorized. Historical laptop throttling and process IDs below are superseded; verify live processes before any future start. Repository contains extensive pre-existing uncommitted work; this session did not alter training losses, checkpoints, labels or frontDemo.

---
# HISTORICAL STATE — 2026-09-15 09:36 IST, queue restarted from checkpoint

The user requested continuation. All ten previously suspended processes had exited;
none of the old PIDs were resumed. No active project trainer or queue was found.
Verified L2-mpdiou last.pt: **51 completed epochs, optimizer state present**; CUDA test passed.
The incomplete portion of epoch 52 will be repeated from the saved epoch-51 checkpoint.

Started `python -u -m scripts.train_queue`, launcher PID **8412**.
Queue log: `runs/session_logs/overnight-queue-resumed-20260915-093640.stdout.log`
(stderr alongside). Current PID file: `runs/session_logs/overnight-queue.pid`.
Historical `paused-queue.json` is stale and must not be used to resume any process.

The queue retains batch=4, workers=2, imgsz=1024, nbs=32 and full-resource access.
Order: finish L2-mpdiou, then L3/L4/L5-mpdiou. Clean timed checkpoints resume automatically.
Stop after screening for model selection; the final 300 epochs remain planned, not queued.
The queue requests prevention of Windows idle sleep while running. No stop marker exists.

---
# PREVIOUS PAUSE — 2026-09-15

The user requested an immediate pause. The overnight queue and all Python training/loader
processes in its verified tree were suspended (not terminated). L2-mpdiou has **51/60
completed epochs**, with epoch 52 paused at batch 422/1152. No queued run can start while
the queue is suspended. RAM/VRAM remain allocated to preserve in-memory state.

Exact PIDs, creation times and command lines are recorded in
`runs/session_logs/paused-queue.json`. Verify these identities before resuming. Do not
launch a second trainer or queue. Resume only on user instruction. If the computer is
restarted, use the saved epoch checkpoint rather than these stale process IDs. The
existing four-hour chunk timer includes suspension time, so after a long pause it may
checkpoint at the next completed epoch and the queue will then resume it automatically.

---
# PREVIOUS STATE — 2026-09-14 23:47 IST, overnight screening queue ACTIVE

The user explicitly authorized unattended sequential training overnight and chose:
**finish all screening, then pause for model selection**. The three 100-epoch final runs
remain planned but must not be selected or launched by this queue.

`scripts/train_queue.py` is running independently of Codex, launcher PID **15136**.
It is waiting for the existing `none-mpdiou` trainer PID **28740**, which was verified
at epoch 22/60 (21 completed). Do not launch another training process while the queue runs.

Order: existing none-mpdiou -> L1-mpdiou -> L2-mpdiou -> L3-mpdiou -> L4-mpdiou -> L5-mpdiou.
Completed CIoU cells are skipped. Each run uses batch=4, workers=2, imgsz=1024, nbs=32,
full-resource access and a 240-minute checkpoint boundary. A clean timed boundary is
resumed automatically; a nonzero exit, malformed completion record or no-progress exit
halts the queue with an error rather than skipping a failed experiment.

Queue log: `runs/session_logs/overnight-queue.stdout.log` (stderr alongside it).
Queue PID: `runs/session_logs/overnight-queue.pid`.
Each new child gets `runs/session_logs/queue-<cell>-<timestamp>.log`.
The current none-mpdiou log remains `runs/session_logs/none-mpdiou-20260914-224349.stdout.log`.

Windows accepted a process-scoped idle-sleep prevention request; it is released when the
queue exits. Display sleep is unaffected. Powercfg request enumeration requires admin
and was unavailable. A Windows byte-range lock prevents two queue instances; this was
verified by trying a second instance and observing exit 1 before any training started.

**Graceful queue stop:** create `runs/session_logs/queue.stop`. The active cell/chunk
continues saving normally, and the queue launches no further child once it exits.
The queue does not automatically restart after a reboot, logoff or process termination.
See `scripts/TRAINING_QUEUE.md` for launch and stop commands.

Validation: 4 queue tests passed (skip/advance, timed checkpoint resume, failures/no progress,
stop marker); ruff clean; mypy clean. Aikido scan attempted; unavailable pending sign-in.

Overall accounting remains **1,080 = 60 reference + 720 screening + 300 final training**.
At the queue activation check, 60 + 381 + 0 = 441 epochs were complete; this is a snapshot.
The queue ends at 780/1,080 complete, with the final 300 awaiting model selection.

---
# PREVIOUS STATE — 2026-09-14 22:43 IST, none-mpdiou launched

## Overall epoch budget — clarified with the user 2026-09-14

The user's overall total is **1,080 epochs**, including the already completed separate
`baseline-screen` reference (60), the 12-cell screening grid (12 x 60 = 720), and the
three later full-training runs (3 x 100 = 300). The historical 1,020 figure excludes
that separate 60-epoch reference. Reporting 720 alone describes only screening, not
the full project budget. No screening/final epoch targets were reduced in this session.

At this check: baseline reference 60 completed, screening 363 completed (six finished
CIoU cells plus three completed none-mpdiou epochs), final training 0 completed:
**423/1,080 overall**, with none-mpdiou epoch 4 in progress. Recompute when reporting
later. Historical smoke/benchmark runs and discarded attempts are not budget progress.
All six CIoU screening cells are complete: none, L1, L2, L3, L4, L5, each 60 epochs.
Screening progress is **360/720 epochs (50%), 6/12 cells complete**. The none-ciou epoch
CSV is absent in its ablation directory; its completed 60-epoch run.json is the evidence
for counting that cell. Do not treat the separate baseline-screen CSV as the same run.

L5-ciou completed in 181.6 minutes. Final validation mask mAP50=0.42138319 and
mask mAP50-95=0.19270246. The six MPDIoU cells were unstarted at this review.

The user requested an epoch progress review and continuation. Launched **none-mpdiou**
for 60 epochs using the same RTX 4060 Ti 8 GB setup: batch=4, workers=2, imgsz=1024,
nbs=32, full-resource access. No prior training process was running.

Launcher PID: 28740. Log base: `runs/session_logs/none-mpdiou-20260914-224349`
(`.stdout.log`, `.stderr.log`, `.pid`). Check process identity and logs before another launch.
The run ends after this cell or saves a resumable checkpoint at the 240-minute boundary.
It does not automatically start L1-mpdiou. Expected cell duration is about three hours,
based on the last two complete runs; this is an estimate, not a measured MPDIoU time.

```powershell
.venv/Scripts/python.exe -u -m ml.ablation.run_ablation --screen --only none:mpdiou --batch 4 --workers 2 --full-resources --max-minutes 240
```

This records the launch, not completion. The remaining 360 screening epochs exclude the
later planned 100-epoch full-training runs for the selected variants.

---
# PREVIOUS STATE — 2026-09-14 18:39 IST, L5-ciou launched

`L4-ciou` completed 60/60 epochs in 169.8 minutes. Final validation mask mAP50 is
0.41671196 and mask mAP50-95 is 0.19068293. The screening grid is 5/12 complete.
The user explicitly requested the next cell, and `L5-ciou` has been launched.

Hardware/settings: RTX 4060 Ti 8 GB, batch=4, workers=2, imgsz=1024, nbs=32,
`--full-resources` (all 16 logical CPU cores available, no GPU duty-cycle throttle).
The target is 60 epochs, with a clean checkpoint boundary at 240 minutes if unfinished.
Only this cell runs; the next MPDIoU cell will not start automatically.

Launcher PID: 24092. Before launching another job, verify the process identity and logs.
Log base: `runs/session_logs/L5-ciou-20260914-183931` (`.stdout.log`, `.stderr.log`, `.pid`).
Expected runtime is roughly three hours based on L4; L5 has additional attention modules,
so this remains an estimate. This is a launch record, not a completion claim.

```powershell
.venv/Scripts/python.exe -u -m ml.ablation.run_ablation --screen --only L5:ciou --batch 4 --workers 2 --full-resources --max-minutes 240
```

---
# PREVIOUS STATE — 2026-09-14, L4-ciou launched

`L3-ciou` finished 60/60 epochs successfully in 48.3 minutes for its resumed segment.
Final validation mask mAP50=0.41332765, mask mAP50-95=0.18803537. The screening grid
is now 4/12 complete. The user explicitly requested the next run.

`L4-ciou` was launched as a new 60-epoch screen on the RTX 4060 Ti 8 GB, with
batch=4, workers=2, imgsz=1024, nbs=32, and `--full-resources`. CPU affinity allows
all 16 logical cores; six Torch threads avoid nested oversubscription. The same
pretrained backbone/neck transfer protocol is used as the earlier screening cells.

Launcher PID: 21092; verify process identity and logs before starting another job.
Logs: `runs/session_logs/L4-ciou-20260914.stdout.log` and `.stderr.log`.
PID file: `runs/session_logs/L4-ciou-20260914.pid`.

This invocation stops at completion of L4-ciou or checkpoints at a 240-minute training
boundary. It does not start L5 automatically. Estimate roughly three hours from the
previous run's actual epoch timing. The CLI grid ETA is unreliable here because resumed
CSV elapsed times reset between sessions; do not use its 0.79 min/epoch figure.

```powershell
.venv/Scripts/python.exe -u -m ml.ablation.run_ablation --screen --only L4:ciou --batch 4 --workers 2 --full-resources --max-minutes 240
```

The prior run's machine transition and epoch-43 backup are documented below. This note
records the launch; inspect logs for current progress and eventual completion.

---
# PREVIOUS STATE — 2026-09-14, RTX 4060 Ti 8 GB resume

Training was launched in the background on this machine to finish `L3-ciou`, starting
at epoch 44/60. Check the log and PID before starting another process; this note is a
launch record, not proof that the process is still alive or the run has completed.

- User explicitly authorizes full CPU/GPU/RAM use on this machine, superseding the old
  laptop utilization and RAM caps for this run. All 16 logical CPU cores are available,
  with six main-process Torch threads and two loader workers to avoid nested oversubscription.
  GPU memory fraction and compute duty cycle are both 1.0. No thermal guard was launched;
  the historical Armoury Crate readings belong to the previous laptop, not this desktop.
- Confirmed hardware: NVIDIA GeForce RTX 4060 Ti, 8188 MiB, 32 GB RAM.
- The relocated `.venv` was repaired using the installed Python 3.12.10 and the local
  editable package registration refreshed. Torch 2.11.0+cu128 and Ultralytics 8.4.135
  match the transferred environment; a CUDA allocation succeeded.
- Verified original checkpoint: epoch=42 (43 completed), optimizer present. An untouched
  backup of `last.pt`, `run.json`, `results.csv`, and `args.yaml` is in
  `runs/resume_backups/L3-ciou-epoch43-20260914/`.
- Physical batch changes **8 -> 4 at epoch 44** because this card has 8 GB VRAM.
  `imgsz=1024`, `nbs=32`, dataset split and model/loss are retained. This is a mixed-hardware,
  mixed-physical-batch continuation; accumulation does not make it numerically identical
  to the original run (e.g. batch-normalization statistics differ). Disclose this in comparisons.
- Added `--full-resources` to the ablation CLI. On resume, `save_dir` is explicitly set
  to the local run directory so the checkpoint's old `C:/Users/anshu/...` path is not used.
- Launcher PID: 20616. PID file: `runs/session_logs/L3-ciou-20260914.pid`.
  Logs: `runs/session_logs/L3-ciou-20260914.stdout.log` and `.stderr.log`.
- Verified after launch: epoch **44/60** completed, `last.pt` contains epoch=43 and
  optimizer state, and epoch **45/60** is progressing. Epoch 44 took 207.3 seconds
  including validation; mask mAP50-95=0.17932. The run is still in progress, not a final result.
- This invocation runs only L3-ciou, ending at epoch 60 or checkpointing at a 120-minute
  training boundary. It does not automatically launch the next cell.
- Local ML checks passed (tests/test_ablation.py, test_train.py, test_bench.py, excluding
  slow tests; two skips). Ruff passed. Aikido scanning was attempted but requires sign-in.

Command (run from repository root, only after verifying the existing job has exited):

```powershell
.venv/Scripts/python.exe -u -m ml.ablation.run_ablation --screen --only L3:ciou --batch 4 --workers 2 --full-resources --max-minutes 120
```

---

# PREVIOUS STATE — 2026-09-02 02:40 IST

**NOTHING IS RUNNING.** `L3-ciou` has a verified, resumable checkpoint after
**43/60 epochs**. Training was stopped after the epoch-43 checkpoint was verified because
the five-hour Codex window reached 94% used, preserving the requested 5% reserve. Resume
this same cell; its completed `run.json` results do not exist yet because the remaining
17 epochs have not run.

The screening grid remains **3/12 complete** (`none-ciou`, `L1-ciou`, `L2-ciou`), with
`L3-ciou` in progress at 43/60. The next action, only when explicitly requested, is to
resume `L3-ciou` from epoch 44. Across the whole screening grid, 497 of 720 epochs remain;
at the measured 1.66 min/epoch median that is about **13.8 active hours** before thermal
cooldown overhead.

The CPU/GPU temperature ceiling remains **90 C**, with resume after cooling to **80 C**.
The training process alone is capped to 16/24 E-cores plus six Torch threads, 80% CUDA
memory, and an ~80% GPU duty cycle. Armoury Crate remains necessary for post-epoch CPU
temperature supervision because shell sensor APIs cannot read the CPU die. In the latest
one-hour segment, the CPU reached 91 C after epoch 8; only the training tree was paused
and it resumed after Armoury Crate showed 65 C. All later post-epoch CPU readings were
80--88 C. GPU remained below the ceiling (highest observed reading: 74 C).

Ultralytics stripped optimizer state from the completed `last.pt` and reset its checkpoint
epoch metadata during finalization; this is expected for a fully completed run. Completion
is verified by the 60th row in `results.csv`, populated `run.json` results, and the clean
guard exit. Do not attempt to resume this completed cell.

Timed stops raise after `on_fit_epoch_end`, preserving optimizer state for incomplete
sessions before Ultralytics' normal finalization strips completed checkpoints. An explicit
session may be up to 240 minutes; the default remains 45 minutes. After the completion-state
updates, **441 tests pass**, ruff is clean, and mypy reports no issues in 68 source files.

The earlier stripped L2 attempt is preserved at
`runs/ablation/L2-ciou-incomplete-stripped-epoch38-20260901`; it is audit-only and must
not be resumed.

---

# HISTORICAL STATE — superseded by the current state above

**NOTHING IS RUNNING.** No training, no thermal guard, no benchmark. Verified: zero
`python.exe` processes. Nothing will restart on its own — the guard is stopped too, so it
cannot relaunch the grid.

**Everything is uncommitted.** 431 tests pass, ruff and mypy clean.

## The one open question that blocks resuming

**The user reported the CPU at 92 C (from Armoury Crate) while the guard reported "77 C" —
which was the GPU. The CPU temperature was never being read at all.** Training was stopped
on the user's instruction and has not resumed.

> **Do not resume training until someone reads the CPU temperature with the machine IDLE.**
> We never got that number. It decides everything:
>
> * **Idle CPU ~50-60 C** -> the 92 C was load-driven. The E-core fix below should cut it
>   substantially; resume and re-check under load.
> * **Idle CPU still ~90 C** -> this is airflow, fan curve or thermal paste. **No scheduling
>   change fixes it** and training should stay stopped until the hardware is sorted.

**The CPU sensor cannot be read from an unprivileged shell.** Re-verified 2026-09-01, all
four routes: `MSAcpi_ThermalZoneTemperature` Access denied; `AsusAtkWmi_WMNB` (Armoury
Crate's own interface) Access denied; `Win32_TemperatureProbe` returns 0 probes;
LibreHardwareMonitor/OpenHardwareMonitor WMI namespaces not installed.

`\Thermal Zone Information(*)\Temperature` **is** readable unprivileged but reported
**27.9 C** — an ACPI chassis/ambient zone, **not** the CPU die. It was deliberately **not**
wired into the guard: reporting 27.9 C as "CPU" while the real figure is 92 C is precisely
the blind-sensor failure the guard exists to prevent.

**To get real CPU coverage, run the guard from an ELEVATED terminal:**

```bash
.venv/Scripts/python.exe scripts/thermal_guard.py --command ".venv/Scripts/python.exe -m ml.ablation.run_ablation --screen --workers 2"
```

Every log line's `cpu_sensor` field says which coverage is in force.

## Two levers that belong to the user, not to the code

1. **The power scheme is ASUS "Turbo"** — Armoury Crate's most aggressive profile, holding
   high boost clocks and voltages under sustained load. Switching to Performance or Silent is
   likely a larger thermal win than anything available in code. Not changed: it is a system
   setting and the user's call.
2. **Elevation**, per above.

## Grid state

| | |
|---|---|
| `none-ciou`, `L1-ciou` | **done**, results in `run.json` |
| `L2-ciou` | interrupted twice. Has a partial `results.csv`; **no `results` in `run.json`**, so it correctly restarts from epoch 0 |
| remaining 9 cells | pending |

Nothing is corrupted. A cell counts as done only when `results` lands in its `run.json`.

---

# READ THIS FIRST — session of 2026-09-01

Supersedes the 2026-08-31 instructions below where they conflict. **Three of that day's
recorded conclusions were wrong and are corrected here.** 431 tests pass, ruff and mypy clean.

## 1. The overfitting question is answered: 60 epochs UNDER-trains

Read from the curves already on disk (`runs/ablation/L1-ciou/results.csv`,
`runs/segment/baseline-screen/results.csv`), not from a new run.

| Signal | L1-ciou | baseline-screen |
|---|---|---|
| best mask mAP50-95 at epoch | **59 of 60** | **59 of 60** |
| val box / seg / cls loss at epoch 60 | all still **falling** | all still **falling** |
| gain over epochs 50→60 | **+0.0098** | **+0.0119** |

**There is no overfitting signature anywhere.** Every curve is still improving when training
stops. The user's framing was right — 1,020 epochs is 15 independent models, and the question
is only ever whether *one* 60-epoch run on 4,606 images overfits. It does not.

> **Consequence: the screening depth CANNOT be shortened.** PHASE-02 and the old §3 below
> both proposed cutting to ~30 epochs as the way to halve the remaining cost. **The curves
> rule that out** — at epoch 30 the models are still climbing steeply (+0.024 over 30→40),
> so a 30-epoch ranking would be ranking noise on an unconverged curve. If cost must come
> down, the lever is the pipeline (done, see §3) or cells, not depth.

## 2. The 0.001 difference is noise, quantified

Detrended epoch-to-epoch standard deviation of mask mAP50-95 over the last 10 epochs:
**±0.0012** (L1-ciou) and **±0.0009** (baseline-screen).

The `none` vs `L1` difference is **0.00036** — about **a third of a single run's own
epoch-to-epoch jitter**. It is not a difference, and no number of further cells resolves
variants separated by less than the noise floor of one run. Watch for this across the
remaining cells: if they land inside ±0.002 of each other, **that is the finding**, and
`SYNTHESIS.md` §9 Q1 says a negative result is legitimate.

**Do not declare a winner from cells that differ by less than ~0.004.**

## 3. CPU was still hitting 100% — the 2026-08-31 diagnosis was wrong

The user reported 100% CPU again on 2026-09-01. **`scripts/cap_cpu.ps1` never could have
worked**, and "affinity alone does not cap CPU" was the wrong conclusion drawn from it.

- **A tree pinned to 19 of 24 cores cannot exceed 79% machine-wide.** That is arithmetic.
- **What failed was delivery.** `cap_cpu.ps1` only touches processes alive when it runs;
  dataloader workers spawn afterwards, so the processes doing every bit of the image work
  were never capped.
- **OpenCV was never capped at all.** It keeps its own pool, is *not* governed by
  `OMP_NUM_THREADS`, and defaulted to **24 threads in every worker**. This was the real cause.
- **`cap_cpu_threads` overrode the environment upward** — `CPU_FRACTION=0.50` set 12 torch
  threads, discarding an exported `OMP_NUM_THREADS=8`.

Fixed by `cap_cpu()` in `ml/train/train.py`, called **in-process before the workers spawn**
(Windows children inherit the affinity mask), plus `cap_worker_threads()` which patches
ultralytics' `seed_worker`. **That hook must be module-level** — Windows pickles
`worker_init_fn` by qualified name, and the closure version I wrote first died with
`Can't get local object` before the first batch. Pinned by a test.

Same configuration, before → after: **CPU max 93.1% → 67.6%**, mean 30.6% → 22.7%, and GPU
utilisation *rose* 60.7% → 69.6%. `scripts/cap_cpu.ps1` is now redundant for training.

### 3b. Then the CPU hit 92 C anyway — placement, not percentage

**A second, separate defect, found only because the user read Armoury Crate.** Utilisation was
a well-behaved ~21% and the CPU was still at 92 C. A percentage cap cannot express the reason.

**Intel hybrid parts interleave the core types, and assuming the layout gets it backwards.**
Read from `GetLogicalProcessorInformationEx` on this Core Ultra 9 275HX (24 cores, no SMT):

```
P-cores  0, 1, 10, 11, 12, 13, 22, 23
E-cores  2-9, 14-21
```

The obvious `range(19)` mask — 19 of 24, correctly under 80% — therefore lands on **6 of the
8 P-cores**, concentrating the dataloader on the hottest, highest-power silicon on the die.
The count was right and the placement was the worst available.

`allowed_cores()` now reads the topology and pins to the **16 E-cores**: `p_cores_used: 0`,
16/24 = 67% machine-wide (still inside the ceiling), and every P-core left free for the
user's own work. Pinned by `test_the_cap_avoids_the_performance_cores` and
`test_the_topology_is_read_not_assumed`.

> **This fix is in the code but its effect on temperature was never measured.** The user
> stopped everything before a reading was taken under the new affinity. Treat "E-cores will
> fix the 92 C" as an untested hypothesis, not a result. Note also that CPU and GPU share
> heatpipes on this chassis, so a GPU drawing ~80 W heats the CPU regardless of where our
> threads run — the E-core change reduces our contribution, it does not remove the coupling.

## 4. Pipeline re-optimised: what moved and what did not

**`cache="disk"` stores the decoded image UN-resized.** `load_image` then re-resizes it every
epoch, every run. The 2026-08-31 note calling the cache "letterboxed" is wrong — letterboxing
happens in the transform pipeline regardless.

`scripts/presize_cache.py` pre-applies that resize for the **1,315** entries that were
2048x2048 (12.58 MB each). Measured per image: **13.66 ms → 1.43 ms**, and 12.4 GB of disk
freed. **Bit-identical** to what training saw before — same `cv2.resize`, same
`INTER_LINEAR`, same target — so it is an input-pipeline change and **not a deviation to
report**. `--verify` asserts that against the PNG source; `--revert` undoes it.

> **The 3,291 256x256 entries are deliberately left alone.** `load_image` *upscales* them 4x
> to 1024. Materialising that would turn 0.20 MB into 3.15 MB each: +9.6 GB of cache and
> +9.6 GB of read per epoch, to save a 0.5 ms resize. **Pre-resizing everything is the
> obvious implementation and a net loss.**

## 5. The measured operating point: workers=2, batch=8

`scripts/benchmark_pipeline.py` runs two real epochs per configuration (~4 min) and reports
CPU/RAM/GPU/VRAM/throughput. Full sweep, all post-fix:

| config | min/ep | img/s | GPU util | VRAM | RAM (cap 24) | CPU max | 12-cell grid |
|---|---|---|---|---|---|---|---|
| w0 b8 | 3.25 | 25.4 | 37.5% | 7.8 G | **17.70** | 52% | 39.0 h |
| **w2 b8** | **1.41** | 59.9 | **70.4%** | 8.2 G | **24.18** | 55% | **16.9 h** |
| w4 b8 | 1.33 | 63.5 | 67.6% | 7.8 G | 29.63 | 71% | 16.0 h |
| w4 b16 | 1.31 | 65.1 | 62.6% | 9.9 G | 31.35 | 74% | 15.7 h |

**`workers=2` maximises GPU utilisation *and* meets the RAM ceiling.** Both intuitions fail
here: more workers cost 5.5 GB to *lower* GPU utilisation, and fewer workers to "spare the
CPU" halve it. Batch 16 is fastest in wall-clock but worse on GPU utilisation and 7 GB worse
on RAM, so it is not used.

`TRAINER_BASE_GB` and `PER_WORKER_GB` were re-derived from **machine-wide** differences
(4.0 and **2.9**, was 1.3). Per-process figures cannot answer a machine-wide question in
either direction — working set undercounts shared pages, summed RSS over-counts pages shared
between workers, and both earlier constants came from per-process numbers.

**The user's own applications held 14.06 GB**, so ~10 GB of the 24 is what training gets. If
more workers are ever wanted, close applications — do not raise the cap.

## 6. The interactive runner now exists

`run.bat` (menu) + `scripts/progress.py`. It did not exist before; §4 of the old notes asked
for it. Live cells done/pending, epochs done/remaining, ETA and finish time, plus CPU/RAM/GPU
against the ceilings.

**Rates are measured from `results.csv`, never assumed.** `run_ablation.py --list` estimates
from a hard-coded 2.5 min/epoch which is now stale by 40% — it claims ~30 h for a grid that
takes ~17. `--watch` attaches to a run already going, and **Ctrl-C stops watching, not the
run**.

## 6b. Thermal guard: 85 C, STOPPED, and GPU-only coverage

Limit lowered 93 -> **85 C** (resume 75) by the user 2026-09-01, for CPU *and* GPU. **It is
not running** — see the state header at the top of this file.

Resume margin is 75 rather than something tighter because the GPU's *normal* load
temperature here is 73-77 C; a resume threshold inside that band restarts the job into a
temperature it immediately re-reaches, which is a thrash cycle that looks busy and makes no
progress.

> **The guard enforced only half of the user's instruction and that is worth being blunt
> about.** The limit was set for "CPU and GPU under 85 C". The GPU sat 8 C *below* the limit
> while the CPU was 7 C *above* it, and the guard logged `ok` throughout — correctly, because
> `cpu_c` was `null` every time. It never claimed a CPU reading it did not have, but a run
> supervised only on GPU should not be described as thermally supervised.

Run it from an **elevated** terminal to get CPU coverage. `cpu_sensor` in every log line says
which coverage is active. Log: `data/thermal_guard.log`.

## 7. Where to pick up

**First, settle the thermal question in the state header.** Then:

```bash
.venv/Scripts/python.exe -m ml.ablation.run_ablation --screen --workers 2
```

or `run.bat` → [2]. Completed cells are skipped; `L2-ciou` restarts from epoch 0.

Watch it, from a second terminal, with `run.bat` → [1] or:

```bash
.venv/Scripts/python.exe scripts/progress.py --watch
```

| | |
|---|---|
| Screening grid | **2 of 12 done**, ~14 h left at 1.38 min/epoch (measured) |
| **Blocked on a temperature reading** | **idle CPU temp, from Armoury Crate — see the state header** |
| Blocked on the user | a free **CMEMS account** unblocks 3 PHASE-04 criteria |
| Blocked on annotation | the **relabelling pass** gates the two-class model |

### What is safe to work on without touching the GPU or the CPU thermals

PHASE-04 and PHASE-05 need no GPU. The relabelling pass, the coastline overlay and the SAR
Fixed Infrastructure Dataset are all PHASE-01 remainders that do not train anything. If the
thermal question stalls, these are the productive direction.

---

## 8. What changed on disk, 2026-09-01

**New files**

| File | What it is |
|---|---|
| `ml/bench/__init__.py`, `ml/bench/monitor.py` | `ResourceMonitor` — background sampling of CPU / machine-wide RAM / GPU / VRAM / temp. A missing GPU reading is `None`, never `0`, because 0% and "the driver did not answer" are the same number for opposite reasons |
| `ml/bench/pipeline.py` | Runs 2 real epochs per configuration on the real split and reports what the machine did. Quotes the **last** epoch, never the first (warmup) |
| `scripts/benchmark_pipeline.py` | CLI: `--sweep workers|batch|cache`. Writes to `runs/bench`, never `runs/ablation` |
| `scripts/presize_cache.py` | Pre-applies `load_image`'s resize to the cache. `--dry-run`, `--verify`, `--revert` |
| `scripts/progress.py` | Live progress: cells, epochs, ETA, finish time, resources vs ceilings |
| `run.bat` | Interactive menu — progress, resume grid, benchmark, tests, doctor, status, thermal |
| `tests/test_bench.py` | 20 tests: CPU cap, P/E topology, monitor, benchmark arithmetic, pre-resize |

**Modified**

| File | Change |
|---|---|
| `ml/train/train.py` | `RAM_CEILING_GB = 24.0` (was a 0.80 fraction); `GPU_MEMORY_FRACTION = 1.0`; `AUTO_BATCH_FRACTION = 0.80`; `DEFAULT_WORKERS = 2`; `TRAINER_BASE_GB = 4.0`, `PER_WORKER_GB = 2.9`, `RAM_RESERVE_GB = 1.0` (all re-measured); new `cap_cpu`, `allowed_cores`, `logical_cores_by_efficiency`, `cap_worker_threads`, `capped_seed_worker`, `ram_budget_gb` |
| `ml/ablation/run_ablation.py` | Calls `cap_cpu` / `cap_worker_threads` before workers spawn; `--list` ETA now **measured** from `results.csv` via `measured_min_per_epoch`, replacing the stale hard-coded 2.5 min/epoch |
| `scripts/thermal_guard.py` | `LIMIT_C` 93 -> **85**, `RESUME_C` 80 -> **75** |
| `scripts/download_cdse_fixture_vv.py` | Pre-existing mypy `no-any-return` fixed |
| `tests/test_train.py`, `tests/test_thermal_guard.py` | Updated for the new constants |
| `PLAN/CONSTRAINTS.md`, `PLAN/INDEX.md`, `PLAN/phases/PHASE-02.md` | This session's findings |

**Data changed on disk (regenerable, not in git)**

- `data/processed/dataset/oos/images/train/*.npy` — 1,315 entries rewritten from 2048x2048 to
  1024x1024. **12.4 GB freed.** Bit-identical through `load_image`; `--verify` passes.
  `--revert` deletes them and ultralytics rebuilds from the PNGs.
- `runs/bench/` — throwaway benchmark runs. Safe to delete.
- `runs/ablation/L2-ciou/` — partial, restarts cleanly.

**Not done deliberately**

- `scripts/cap_cpu.ps1` left in place but is **redundant for training** and structurally
  cannot cap dataloader workers. Kept because it still applies to SNAP and 7z, which are not
  launched from Python.
- Batch 16 measured but **not adopted**: fastest in wall-clock, but worse GPU utilisation and
  7 GB worse on RAM.
- Validation image cache left un-resized — 585 images, negligible saving, and `ori_shape`
  feeds the validator's metric scaling. Not worth even a small question mark over
  comparability with the two finished cells.

---

# Earlier instructions (2026-08-31) — superseded where §1-§6 above conflict

Left by the user at the end of the 2026-08-31 session. **Nothing is running.** Everything is
uncommitted. 407 tests pass, ruff and mypy clean.

## 1. Resource limits — non-negotiable, this is a laptop

| Resource | Limit |
|---|---|
| **CPU** | **80% maximum** |
| **RAM** | **24 GB hard cap** (not a fraction — an absolute ceiling) |
| **GPU** | **unrestricted — use as much as you can** |

**[DONE 2026-09-01: `RAM_CEILING_GB = 24.0` and `GPU_MEMORY_FRACTION = 1.0`.
`RAM_CEILING_FRACTION` no longer exists.]**

The RAM figure is a **change**: the code currently has `RAM_CEILING_FRACTION = 0.80`, which
on this 31.4 GB machine works out to 25.1 GB. **Replace it with a hard 24 GB.** The GPU cap
(`GPU_MEMORY_FRACTION = 0.80`) should be **removed or raised** — the user wants the card
used fully.

Both CPU levers are needed and they do different jobs, learned the hard way this session:

```bash
# 1. affinity — which cores (re-run AFTER launching anything; it only touches live processes)
powershell -ExecutionPolicy Bypass -File scripts/cap_cpu.ps1

# 2. thread count — how many threads. Affinity ALONE does not cap CPU: pinning to 18 cores
#    still drives all 18 to 100%. This is what took CPU from 100% -> 25%.
OMP_NUM_THREADS=8 MKL_NUM_THREADS=8 <command>
```

**Thermal guard** (`scripts/thermal_guard.py`): ~~stop above 93 C, resume at 80 C~~
**— SUPERSEDED: now 85 C / 75 C (user, 2026-09-01).** Run it
alongside any long job. GPU temp is readable unprivileged; **CPU temp needs an elevated
shell** — every unprivileged route is blocked, including ASUS/Armoury Crate's
`AsusAtkWmi_WMNB`. Observed range across 505 readings: 27-75 C, zero trips.

## 2. Re-optimise for a laptop before running more

The user asked for this explicitly. What was already found to work, and what is still open:

**Already done — do not redo:**
- **[Correction 2026-09-01: the cache is decoded but NOT letterboxed — `load_image`
  re-resizes on every read. See §4 at the top.]**
  `cache="disk"` in ultralytics: decoded images written once as `.npy`, shared across all
  twelve cells. **Cell time 3.85 h -> 1.66 h (-57%).**
- Worker count matters more than expected: at `workers=1` the GPU **starved at 42-58%
  utilisation**; at `workers=3` it reached **84%** while CPU *fell* to 22%. Cutting workers
  to "spare the CPU" achieves the opposite of what is wanted.

**Still worth trying:**
- Pre-resize the 1,650 2048x2048 images to 1024 on disk. Ultralytics letterboxes every image
  to `imgsz=1024` on the CPU each epoch; the labels are normalised so they survive it
  unchanged.
- Batch is 8 and GPU memory sat at ~60%. With the GPU cap lifted, **profile a larger batch**
  (`scripts/train.py --auto-batch`). Keep `nbs=32` so the effective batch stays comparable.
- **Disk is at 90% (97 GB free)** after the ~19 GB image cache. Check before adding data.

## 3. Decide whether the remaining training is worth running AT ALL

**The user's instruction: reason about whether the remaining runs would overfit and whether
they are worth exploring. Only continue if the answer is yes; otherwise cut runs.**

**First, correct the framing — this matters.** The "1,020 epochs" figure is **not one model
trained for 1,020 epochs.** It is the sum over **15 independent runs**: 12 screening cells at
60 epochs plus 3 full-trains at 100. Each run trains a **fresh** model. Overfitting is a
per-run property, so the question is whether **60 epochs on 4,606 images** overfits — not
whether 1,020 does. Do not reason about the sum.

**What to actually check before spending ~17 more hours:**

1. **Read the loss curves already on disk** for `none-ciou` and `L1-ciou` in
   `runs/ablation/*/`. If validation mAP plateaus or turns down well before epoch 60, the
   screening depth is too long and every remaining cell can be shortened — that alone could
   halve the remaining time.
2. **The two completed cells differ by 0.001 mAP50-95** (0.198 vs 0.199). That is noise. If
   several more cells land inside noise of each other, the ablation is not resolving the
   variants and **more cells will not fix that** — report it as a finding. A negative or
   null result is legitimate and `SYNTHESIS.md` §9 Q1 explicitly says so.
3. **Do not drop cells arbitrarily if you do continue.** L4 is the row P004 found *degrades*
   under MPDIoU, and L2/L5 are the ones it found best — those three carry most of the
   information. `none-mpdiou` is the control for the loss axis. If cutting, cut from the
   middle, and record what was cut and why in `ml/ablation/results.md`.

## 4. Build an interactive progress runner

The user wants a **`.py` script launched from a `.bat`** that shows live progress for any
training or test run:

- ETA to completion
- how much is done / how much remains
- epochs (or items) completed vs remaining

Applies to **both** training and test runs. The existing `run_ablation.py --list` already
reports cells done/pending and a time estimate — build on that rather than starting over,
and note that its built-in "2.5 min/epoch" figure is now **stale** (it is ~1.7 min/epoch
since the caching change).

## 5. Where to pick up

```bash
# 2 of 12 screening cells are done; this skips them and resumes at L2-ciou
OMP_NUM_THREADS=8 MKL_NUM_THREADS=8 .venv/Scripts/python.exe -m ml.ablation.run_ablation --screen --workers 3
```

| | |
|---|---|
| Screening grid | **2 of 12 done** (`none-ciou`, `L1-ciou`), ~17 h left at the current rate |
| Blocked on the user | a free **CMEMS account** unblocks 3 PHASE-04 criteria |
| Blocked on annotation | the **relabelling pass** gates the two-class model; CFAR now exists to support it |

---

**Machine:** **RTX 5070 Ti laptop, 12 GB** (moved off the 8 GB 4060 Ti desktop). Environment
is **rebuilt and verified** here - see "Start here" below. Do not rebuild it from scratch.

> **Both of the blockers this file used to open with are gone.** The 8 GB VRAM ceiling and
> the 59.9 GB disk shortage were properties of the *old* machine. On this one:
> **11.94 GB VRAM** (clears the 8.0 GB training floor, so PHASE-02 is viable and `doctor`
> no longer warns) and **~250 GB free** (the corpus fits with extraction headroom).

---

## If you are the new session: start here

You own the **backend and ML pipeline, PHASE-01 onward**. **Do not work on `frontDemo/`** -
it is a separate frontend layout study owned by the session on the other laptop, with its
own README and its own open issues. Touching it will collide.

**The environment is already set up and green.** Verify rather than rebuild:

```bash
.venv/Scripts/python.exe -m backend.cli doctor
.venv/Scripts/python.exe -m pytest -q
```

Expect `doctor` to report python 3.12.10, database ok with PostGIS 3.3, torch /
ultralytics / opendrift installed, `device cuda`, and **142 tests passing**.

`doctor` reports `NVIDIA GeForce RTX 5070 Ti Laptop GPU (sm_120, 11.9 GB)`, `device cuda`
and `train defaults batch=8 nbs=32 (accumulate x4) imgsz=1024 amp=True`. **There is no
VRAM warning any more** - 11.94 GB clears `MIN_TRAIN_VRAM_GB = 8.0` in `backend/device.py`,
so PHASE-02 can train here. Torch must be a **cu128 or newer** build: this card is
Blackwell **sm_120** and older wheels ship no kernels for it. Verified with a real
allocation, not just `is_available()` - `torch 2.11.0+cu128`, capability `(12, 0)`.

### Disk: no longer a blocker

**~250 GB free** on this machine against a 91 GB corpus, so the archives fit *and* leave
room for 7z extraction (which roughly doubles the requirement).
`scripts/download_zenodo.py` checks free space against both figures before fetching
anything, so this cannot silently repeat. Sizes:

| Record | Size | Role |
|---|---|---|
| `8346860` Part I | **37.92 GB** | primary training positives |
| `8253899` Part II | **42.77 GB** | look-alike negative pool |
| `13761290` Part III | **9.18 GB** | held-out test |
| `15298010` Refined SOS | **1.10 GB** | corrected masks, prefer where overlapping |

The **mask archives are tiny** (10-30 MB each) - the images are the entire bulk.

**Decided with the user 2026-08-30: Part II is deferred.** PHASE-01 sizes the negative pool
at only ~10% per split, so 42.77 GB to fill it is poor value for now. The download runs as
`--records essential` (Parts I + III + Refined SOS, 48.2 GB). Fetch Part II with
`--records negatives` when the negative pool is actually being assembled; the acceptance
criterion "look-alike negative pool at ~10% per split" stays open until then.

```bash
.venv/Scripts/python.exe scripts/download_zenodo.py --records essential
```

Safe to interrupt and re-run: verified files are skipped and a partial transfer **resumes**
from a `.part` sibling. Every file is checked against Zenodo's published MD5, and the final
filename only appears once that passes - so a truncated archive can never be mistaken for a
finished one. **The link dropped mid-download on 2026-08-30** and turned one blip into
eight instant `getaddrinfo` failures, so the script now retries with exponential backoff
(`MAX_ATTEMPTS = 8`).

Reclaimable now, if needed: the `_COG` products under `data/raw/sar/safe/` are unusable
(see below) and the classic `.zip` archives are redundant once extracted - roughly 10 GB.

### Then

1. **Finish PHASE-01** ([`PLAN/phases/PHASE-01.md`](PLAN/phases/PHASE-01.md)) - see the
   breakdown under "Current position".
2. **Email CERTH/MKLab for the Krestenitis dataset** if not already sent (check with the
   user). Request-gated, long lead time. A bonus, not a dependency.

**PHASE-04 and PHASE-05 do not depend on PHASE-02/03** and need no GPU. If PHASE-01 stalls
on disk or a dataset, switch to PHASE-05 rather than idling.

---

## Current position

| | |
|---|---|
| **PHASE-00** | **Complete.** Committed as `a9eb695`, pushed |
| **PHASE-01** | **Substantially complete, uncommitted (2026-08-31).** All three scenes preprocessed, geocoding asserted on real data, corpus downloaded/extracted/assembled, negative pool met. Remaining: relabelling pass (needs CFAR), coastline overlay, SAR Fixed Infrastructure Dataset |
| **PHASE-02** | **Started 2026-08-31, uncommitted.** Dataset assembly, training entry point, LSK + MPDIoU + all six ablation architectures built and verified. Baseline screening run in progress. Remaining: `run_ablation.py`, wiring MPDIoU into the loss, CFAR, SAHI, export |
| **PHASE-05** | **COMPLETE 2026-08-31, uncommitted.** All seven acceptance criteria met and asserted. 6,737 tracks in `ais_tracks`; both fixture vessels queryable by name with behaviour stored |
| **PHASE-04** | **Engine complete 2026-08-31, uncommitted.** Reversibility verified, ensemble + origin field + age + offline cache built and tested. 3 of 6 criteria blocked on a CMEMS account |
| **PHASE-03** | Not started |
| **frontDemo/** | Separate track, owned by the session on the other laptop. Committed in `6c1bc25`. Do not touch |
| **Repository** | https://github.com/haziqlandge/satellite-oilSpill-detection (public, `main`) |

### PHASE-01 breakdown as of 2026-08-29

| Done | Still to do |
|---|---|
| `sar/fetch.py`, `geo.py`, `tiling.py`, `cdse.py`, `preprocess.py` | Finish the SNAP chain on Cases 2 and 3 |
| `ais/clean.py`, `loader.py`, `trajectory.py` | Zenodo Part II (deferred to home wifi) |
| `datasets/zenodo.py` (+ checksum + **resume/retry**) | SAR Fixed Infrastructure Dataset |
| `datasets/relabel.py` - **done 2026-08-30** | Relabelling pass itself (needs CFAR, PHASE-02) |
| `graphs/s1_grd_preprocess.xml` - **now emits dB** | Coastline overlay check |
| 3 classic fixture `.SAFE` products + 10 AIS days | Cases 2 and 3 through SNAP (queued) |
| Geocoding round-trip on a **real scene: 6.6e-11 px** | |
| **142 tests passing**, ruff + mypy clean | |

**SNAP chain status (2026-08-30): re-running.** The first attempt was **killed externally
at 69 minutes**, 3.46 GB into a Case 1 output that should be ~5.6 GB. That exposed a real
gap, now fixed: `_discard_partial` only runs on timeout or a non-zero exit, so a kill of the
parent process bypassed it and left a truncated raster under the **final** filename - which
`preprocess_fixtures.py` would have skipped as "already processed" on the next run. `gpt`
now writes to `<target>.partial` and `run_graph` renames only after the CRS and data checks
pass, so the final name is unreachable unless the run actually completed. Guarded by
`test_run_graph_writes_through_a_partial_name`. **A full run needs several uninterrupted
hours; prefer a terminal that will not be killed.** The chain itself is
verified end-to-end on a 2048x2048 subset - EPSG:4326, 73.9% non-zero, genuinely dB. The
historical note below stands: on the old machine Case 1 was killed by a then-1-hour
timeout, which is why `DEFAULT_TIMEOUT_S` is now 4 hours.

**Measured:** a full IW GRDH scene (25896 x 16734) through Refined Lee and
Terrain-Correction at 10 m had written 2.5 GB and was **still running at 60 minutes** on
this machine. `DEFAULT_TIMEOUT_S` is now **4 hours**. Budget hours per scene, three
scenes, and run it when the machine is free:

```bash
.venv/Scripts/python.exe scripts/preprocess_fixtures.py --max-heap-gb 8
```

Re-running is safe: completed outputs are skipped, `_COG` products are skipped with a
message, and a run that times out or fails now **deletes its partial output** so a
truncated raster cannot be mistaken for a finished one.

**Disk:** each output looked set to exceed 2.5 GB, so budget ~10 GB for three scenes on
top of whatever the Zenodo corpus needs.

**Do not trust "SNAP exited 0" as success.** It happily produces a correctly sized,
correctly georeferenced, **entirely zero** raster (see the `nodataValueAtSea` trap below).
`run_graph` now verifies both the CRS *and* that the output actually contains non-zero
pixels (`check_has_data`), so this specific failure can no longer pass silently.

**Four traps already paid for. Do not re-derive these.** Each cost real time on
2026-08-29; all four are now guarded by tests in `tests/test_preprocess.py`.

1. **`mapProjection` must be `WGS84(DD)`, not `EPSG:4326`.** SNAP wants its own CRS
   name; an `EPSG:nnnn` string makes it compute a zero-size target and die at graph
   init with `ArithmeticException: / by zero`. It looks exactly like a broken install
   or a bad product and is neither - SNAP 12 and 14 fail identically, on both `.SAFE`
   and DIMAP input, with a verified-healthy product. **SNAP 12 is installed at
   `C:\esa-snap-12` but is NOT needed**; SNAP 14 at `C:\Program Files\esa-snap` works.
   (On the 5070 Ti only SNAP 14 is installed, via `winget`. No SNAP 12 here.)
2. **`nodataValueAtSea` must be `false` in Terrain-Correction.** It defaults to true and
   SRTM has no data over water, so on a marine scene it nulls nearly every pixel: the
   output is correctly sized, correctly georeferenced and **entirely zero**, and SNAP
   still exits 0. For an oil-spill pipeline the sea is the signal.
3. **`Land-Sea-Mask` must not carry a `geometry` parameter when `useSRTM=true`.** SNAP
   parses the value as a band-arithmetic expression; the placeholder `0,0` that was in
   the graph failed with `Undefined symbol '0,0'` in `CreateLandMaskOp`.
4. **The measurement-band-only trap.** The first pass downloaded only `measurement/`
   assets, which **cannot be calibrated** - the sigma0 LUTs live in
   `annotation/calibration/`. Use `scripts/download_cdse_fixture_safe.py`, not
   `download_cdse_fixture_vv.py`.

Two hypotheses were pursued and proved **wrong**; they are recorded so nobody retries
them: "COG packaging breaks SNAP" (classic products fail identically - though classic is
still preferred, because SNAP flags the COG calibration LUT as unreliable) and "SNAP 14
regression, install SNAP 12" (12 fails the same way).

Full detail, including everything ruled out along the way, is in
`PLAN/phases/PHASE-01.md` under "Confirmed on this hardware".

### RESOLVED 2026-08-30: sigma0 in dB, and filter order

**Decided with the user. Recorded in `PLAN/CONSTRAINTS.md`. Do not re-open without reading
that entry.** The chain is now:

```
Read -> Apply-Orbit-File -> Calibration (LINEAR) -> Speckle-Filter (Refined Lee)
     -> Land-Sea-Mask -> Terrain-Correction -> LinearToFromdB -> Write
```

**The new evidence that settled it.** `outputImageScaleInDb` is **silently ignored by
SNAP**. Measured on the Case 1 fixture: a subset calibrated with the flag `true` and one
with it `false` are **byte-identical** (min 0.00007, max 0.26983, mean 0.00209 - linear in
both cases). So P004 §2.3's "calibrate-to-dB then Refined Lee" order was *never actually
running*; the filter has always received linear input. What was missing was any dB
conversion at all.

That makes the change smaller than it looks: the filter keeps the input it always had, and
a `LinearToFromdB` node is added at the **end**, because (a) speckle is multiplicative in
the linear domain, which is what Refined Lee's coefficient-of-variation model assumes, and
(b) Terrain-Correction resamples, and averaging power linearly is the correct arithmetic
mean where averaging in dB is a geometric mean that biases interpolated pixels low.

**Verified end-to-end** on a 2048x2048 subset of Case 1: output is EPSG:4326, 73.9%
non-zero, and genuinely dB - 100% negative values, range -33.0 to +0.4, mean **-27.09 dB**,
which agrees with `10*log10(0.00209) = -26.79` from the linear probe. Guarded now by four
tests in `tests/test_preprocess.py`.

**Also learned, and worth keeping:** the graph XML was not parsed by any test, and a `--`
inside an XML comment (illegal in XML) made `gpt` die at graph init with an XStream trace.
`test_graph_is_well_formed_xml` now catches that in milliseconds instead of hours in.

## Changes made on 2026-08-31

Machine re-confirmed as the **RTX 5070 Ti Laptop (sm_120, 11.94 GB)** — `doctor` green,
`device cuda`, `batch=8 nbs=32 imgsz=1024 amp=True`. Nothing needed changing. Baseline at
session start: **169 tests, 168 passed / 1 skipped, exit 0**, ruff and mypy clean.

### The corpus is downloading to local disk, not the pendrive — decided with the user

The user offered a 117 GB pendrive (`D:\hzq fkahh download`) for the corpus. **It is FAT32,
which caps a single file at 4 GB**, and every bulk archive is far over that (37.92 / 21.41 /
21.36 / 9.18 GB). The drive also held ~1.3 GB of the user's personal documents (certificates,
degree, experience letters), so reformatting was not something to do unasked.

**Decided:** back the pendrive up to `C:\pen drive backup` (done — **1,003 files, 1.277 GB,
robocopy 0 failures**), then download, extract and train **entirely on C:**. The user will
move files to the pendrive themselves later. **No filesystem conversion was performed** — the
pendrive is untouched and still FAT32, so anything moved there later still hits the 4 GB cap.

> Training off USB flash was raised and rejected on the user's own call: heavy random reads of
> small files across 100 epochs is the worst case for flash. Hot training data stays on C:.

### Download status — Part II SKIPPED, everything else complete and verified

**Decided with the user 2026-08-31: Part II is skipped. This supersedes both the 2026-08-30
"deferred" note and this session's own earlier decision to fetch it.** The reason is no
longer disk or bandwidth — it is that **Part II's job is already done.** PHASE-01 wants a
look-alike negative pool at ~10% per split; Part III ships 150 `Lookalike` + 150 `No oil`
images whose masks are genuinely empty, and the assembled dataset carries
**10.2% / 11.7% / 11.8%**. Fetching 42.77 GB to refill a pool already at target is poor
value.

**Fetch it only if the baseline over-triggers on look-alikes** — C8 makes us report that
count separately from mAP anyway, so the signal will be visible if it ever matters:

```bash
.venv/Scripts/python.exe scripts/download_zenodo.py --records negatives
```

Its two mask archives are already on disk (under 1 MB each); only the two ~21 GB image
archives are absent.

| Record | State |
|---|---|
| `15298010` Refined SOS | **complete, MD5-verified** (images.zip 1.07 GB + masks.zip 0.03 GB) |
| `13761290` Part III | **complete, MD5-verified** — 9.18 GB. Resumed from the 92% partial and finished in 4.8 min |
| `8346860` Part I | mask archive verified; the 37.92 GB image archive is in flight |
| `8253899` Part II | queued |

The resume path proved itself: the previous session's `.part` files were picked up rather
than restarted.

### FIXED: `relabel.binarise` silently destroyed every band-first mask

**The most important thing in this section.** Found by probing the real Part I masks rather
than trusting the format note. Part I is encoded **differently from the Refined SOS masks the
module was written against**:

| | Part I (`8346860`) | Refined SOS (`15298010`) |
|---|---|---|
| Shape | **1 band, 2048×2048** | 3 band RGB, 256×256 |
| Values | **`{0, 1}`** | `{0, 255}` + lossy halo |
| Clean binary | 200 of 200 sampled | 28 of 40 |
| Georeferenced | **no** — identity transform | n/a |

`binarise` reduced a 3-D mask with `array[..., 0]`, which is correct for PIL/imageio
**(H, W, C)** but wrong for `rasterio.read()` **(bands, H, W)**. Measured on a real mask:

```
binarise(src.read())   -> (1, 2048)      0 true pixels     # every label destroyed
binarise(src.read(1))  -> (2048, 2048)   14,539 true pixels
```

**No exception was raised.** PHASE-02 assembling Part I the obvious way would have trained on
entirely empty labels and looked like a modelling failure. `_drop_channel_axis` now picks the
channel axis by size (`MAX_CHANNELS = 4`) and **raises on a genuinely ambiguous shape rather
than guessing**, since guessing there silently transposes a label. Guarded by 4 tests; all
three layouts now agree at 14,539 px on the real file.

This also confirms the existing "threshold at half the observed maximum, not a fixed 128"
rule was right for a reason now demonstrated: **both encodings really are in circulation**,
and a fixed 128 would empty every Part I mask.

### New: archive extraction

`.7z` needs an external tool and this machine had none — no 7-Zip, no `py7zr`, and Windows'
`bsdtar` cannot read 7z. **The user's existing WinRAR 7.23 is used.** Two traps found and
now guarded:

- **`WinRAR.exe` is a GUI binary.** PowerShell's `&` does not wait for it (`$LASTEXITCODE`
  comes back empty and the destination is still empty when the call returns). Python's
  `subprocess.run` *does* wait — verified, returncode 0 with all 1200 files present.
- **The destination needs a trailing separator** or WinRAR reads it as a filename filter and
  extracts nothing **while still exiting 0**.

| Path | What it is |
|---|---|
| `backend/ingest/datasets/extract.py` | Extractor discovery (WinRAR / 7-Zip / `ZENODO_EXTRACTOR`) + extraction |
| `scripts/extract_zenodo.py` | Driver; skips in-flight `.part` files and already-extracted destinations |
| `tests/test_extract.py` | 13 tests |

Same partial-name discipline as `run_graph` and `download_file`: output lands in
`<dest>.partial` and is renamed only after a clean exit, and **an extractor that exits 0
having written nothing is an error**, not a success to be renamed into place. Extraction
target is `data/interim/datasets/zenodo/`.

**Timing to expect:** 174 s for the 6.2 MB / 1200-file mask archive. Per-file cost (Defender
scanning each new file) dominates, not bytes.

### What the extracted corpus actually contains — measured, not read off the record pages

Three records are extracted to `data/interim/datasets/zenodo/`. **Every record disagrees
with the others on every convention that matters, and each disagreement is silent.**

| Record | Layout | Counts |
|---|---|---|
| `13761290` Part III | `Images/<cat>/` + `Mask/<cat>/`, cats `Oil` / `Lookalike` / `No oil` | 150 + 150 + 150 images, same again as masks (900 files) |
| `15298010` Refined SOS | `images/images/{train,val}` + `masks/masks/{train,val}` | 6,455 train + 1,615 val = **8,070** pairs |
| `8346860` Part I | `Mask_oil/` (images still downloading) | 1,200 masks |

**Part III is a ready-made negative pool.** `Lookalike` and `No oil` masks are genuinely
empty — 0 foreground pixels across 80 sampled, against 40/40 non-empty for `Oil`. That is
**300 negatives** available without touching Part II.

Four traps, all now handled in `ml/datasets/oos_dataset.py` and each guarded by a test:

1. **Part III masks carry a `_segmentation` suffix.** `00000.tif` pairs with
   `00000_segmentation.tif`. Matching on the bare stem finds **zero** pairs across all 450
   images — it does not half-work, it silently finds nothing.
2. **Part III restarts numbering inside every category.** `00000.tif` exists in `Oil`,
   `Lookalike` *and* `No oil`. Flattening on the bare stem into one `images/train/`
   directory silently overwrites two thirds of the corpus. Identities are therefore
   qualified: `13761290__Oil__00000`.
3. **Refined SOS ships macOS AppleDouble debris** — a `__MACOSX/` tree and a `._name` stub
   for every real file, **16,148** of them. A plain glob pairs a 4 KB resource fork with a
   real mask. The naive count is 16,145 per archive; the real one is 8,070.
4. **Refined SOS is MIXED-SENSOR and nothing in `PLAN/` or `RESEARCH/` anticipated it.**

   | Split | `sentinel_*` | `palsar_*` |
   |---|---|---|
   | train | 3,354 | 3,101 |
   | val | 839 | 776 |

   **48% is ALOS PALSAR — L-band, where this entire pipeline is Sentinel-1 C-band.** Oil
   damps capillary waves differently between the two bands, so the two are not
   interchangeable training data. `discover_refined_sos` defaults to
   `sensors=("sentinel",)` → **4,193 images**; `sensors=None` takes all 8,070 and is a
   deliberate act that must be recorded in the weights manifest. **This is an open question
   for the user, not a settled decision.**

Combined Part III + Sentinel-only Refined SOS = **4,643 images**, splitting 78.7 / 10.1 /
11.2 under `assign_split`.

### Mask instance statistics — the area floor is doing real work

Measured over 120 real Part I masks (`MIN_INSTANCE_PX = 64`):

| Floor | Instances | Per mask | Foreground area kept |
|---|---|---|---|
| none | 6,989 | 58.2 | 100% |
| **64 px** | **1,855** | **15.5** | **99.8%** |
| 500 px | 771 | 6.4 | 99.1% |
| 2000 px | 399 | 3.3 | 97.9% |

Median component area is **9 px** and p25 is **1 px** — the masks are heavily speckled.
The 64 px floor discards 73% of components for 0.2% of the oil area, so it is not a tuning
knob, it is what makes the labels usable at all. Median foreground is 1.51% of a tile.
Whether to raise the floor for *training* (as opposed to `relabel`'s deliberately permissive
review floor) is worth revisiting once training starts.

### New: `ml/datasets/oos_dataset.py` (PHASE-02 dataset assembly)

34 tests. Mask → YOLO-seg polygons, deterministic splits, class policy, corpus discovery.

- **`skimage` gives `(row, col)`, ultralytics wants `(x, y)`.** Swapping them yields a
  perfectly valid label file describing a *transposed* slick; training just gets quietly
  worse. Pinned by a test on a deliberately non-square slick.
- **Splits are CRC32 of the identity**, not `hash()` — same lesson `synthetic.py` recorded.
  A per-run reshuffle leaks validation images into training on every resume.
- **Masks are padded before contouring.** `find_contours` will not close a contour running
  off the array edge, and a slick against the tile border is the normal case when tiling.
- **A negative gets an empty label file, never a missing one.** Ultralytics reads a missing
  label as "unlabelled, skip"; empty means "genuinely nothing here", which is the point.
- **Class assignment is never inferred.** Either human-confirmed labels from
  `relabel.load_confirmed`, or `single_class` mode emitting one class named `slick` — a
  *binary baseline*, which must not be exported under the two-class manifest.

`build_dataset` writes the ultralytics tree and `scripts/build_dataset.py` drives it, so the
corpus pipeline is now three steps end to end:

```
download_zenodo.py  ->  extract_zenodo.py  ->  build_dataset.py
```

Images are **hard-linked**, not copied — the corpus is tens of GB and a link costs nothing
on the same NTFS volume. Windows reserves symlinks for elevated sessions, so a symlink is
not a safe default; copy is the fallback.

**Both channel layouts occur inside this one corpus**, which is what makes the `binarise`
fix load-bearing rather than tidy: Part I and Part III are `.tif` read band-first through
rasterio, Refined SOS is 256×256×3 `.png` read channel-last through imageio.

> **Consequence worth flagging: the two-class model still needs the human relabelling pass.**
> The corpus is binary oil/not-oil. `oos` vs `slick_unknown` cannot be derived from it, and
> nothing here will guess. A binary baseline can train immediately; the two-class model
> cannot until annotation happens.

### CRITICAL: the SAR images are float32 dB, and **band 1 has no signal in it**

Found by the smoke run, which is exactly what the smoke run is for. Two separate faults, both
silent, both fatal to training.

**1. No image loader can open these files.** Part I and Part III images are **2-band float32
GeoTIFF** holding σ0 in dB (observed −35.9 to +12.8). Ultralytics loads through PIL, and PIL
answers `cannot identify image file` for every one — the first smoke run scanned 182 images
and called **all 182 corrupt**. They must be *converted*, not linked. `materialise_image`
now writes 8-bit PNG for `.tif` and hard-links anything already 8-bit.

**2. Band 1 is VH and shows essentially no slick.** Measured over 30 Part III `Oil` images,
comparing pixels *inside* the ground-truth mask against pixels outside:

| Band | Inside mask | Outside | Contrast |
|---|---|---|---|
| **band 1** (VH) | −29.54 dB | −29.03 dB | **0.51 dB** — noise |
| **band 2** (VV) | −27.41 dB | −20.41 dB | **7.01 dB** |

`SAR_BAND = 2`. **Reading "the first band" is the obvious implementation and it hands the
model an image with no signal in it** — which would have presented as an architecture
failure, or as the LSK-at-L5 question answering itself negatively, rather than as a loader
bug. This is the single most expensive trap found so far.

**3. The dB window must be fixed, never per-image.** The absolute level *is* the class
signal — per-image band-2 means are Oil −21.5, Lookalike −20.2, No oil −12.7 dB. A per-image
min/max stretch, which is the usual reflex, maps all three to the same output range and
**destroys the separation**. `DB_WINDOW = (-35.0, 0.0)` is shared by every image and clips
0.000% low / 0.004% high.

Verified end to end on a real Oil tile: inside mask **45.5**, outside **93.0** of 255 — the
slick is correctly darker — and PIL opens the result as mode `L`.

> **Consequence for Refined SOS.** Those are 8-bit greyscale PNG already scaled by the
> dataset's authors by an unknown rule (per-image means spread 36–146). They are linked
> unchanged, so the corpus mixes our fixed-window scaling with theirs. Not resolved; worth
> revisiting if the baseline underperforms on one source relative to the other.

### The training pipeline is proven end to end (smoke run, 2026-08-31)

`scripts/train.py --smoke` completes: **2 epochs in 40 s**, CUDA on sm_120, batch 8 inside
11.9 GB, `data.yaml` parsed, weights written. Validation loaded **470 images / 1,749
instances**, so positive polygon labels parse in the real dataloader and not merely in a
test harness. Independently confirmed with ultralytics' own `verify_image_label`:

```
200 positives -> found=200  corrupt=0  empty=0   polygons=2051
100 negatives -> found=100  corrupt=0  empty=100 polygons=0
```

mAP was ~0 and is **not a result** — see the sampling caveat below.

**Caveat on `--smoke`, worth knowing before trusting one.** Ultralytics' `fraction` takes a
**contiguous prefix** of the file list, not a random sample. Our identities sort with all 300
Part III negatives first, so `fraction=0.05` selected **182 images that were 100%
background**. The run still exercises the whole loop, but a smoke run's *metrics* are
meaningless twice over. If a smoke run needs to see positives, point `--data` at a purpose-
built subset rather than trusting `fraction`.

**Two false alarms recorded so they are not re-chased.** Both were harness bugs of mine, not
data faults: calling `verify_image_label` with `keypoint=True` skips the segment-parsing
branch at `ultralytics/data/utils.py:335` and reports every polygon label as corrupt with an
"inhomogeneous shape" error; and its return tuple is
`(im_file, lb, shape, segments, keypoints, nm, nf, ne, nc, msg)` — ten values, segments
**fourth**, not the counts-first order the argument list suggests.

### `ml/train/train.py` + `scripts/train.py`

18 tests, none of which train anything. Two properties are pinned:

- **`degrees`, `shear` and `perspective` are forced to zero, and re-applied *after* any
  caller override** — so an experiment, a copied recipe or a smoke flag cannot reintroduce a
  rotation. `CONSTRAINTS.md` forbids it because rotation invalidates the pixel-to-geo mapping
  that proximity scoring, drift seeding and the AIS gate all read geometry from.
- **`accumulate` is `round(nbs/batch)`, not floor.** Ultralytics uses `round`; flooring
  reports 2 for a batch of 12 where the trainer really uses 3. That number is what makes a
  grid split across two GPUs comparable to Zhao et al. Table 1, so reporting it wrong is
  worse than not reporting it. **`backend/device.py` still floors** — it agrees for batch 8
  and 32 and differs only on the 16 GB machine's 12.

### Download speed: serial ~9 MB/s, and a measurement mistake worth not repeating

The corpus downloads at **~9 MB/s / 78 Mbps** on a 300 Mbps line, single stream, reproduced
twice. Zenodo answers ranged requests with **206**, so `download_file_parallel` exists (8
tests) — but it is **off by default and unproven**.

**The mistake:** a probe suggested 4 parallel ranges hit 19.4 MB/s. Acting on it measured
2–3 MB/s instead. Both numbers are meaningless, because **the serial transfer it was meant
to replace had never stopped** — killing the background *shell* does not kill the Python
process under it, so two downloads competed for the same link for ~15 minutes. `.part` kept
growing the whole time, which is what eventually gave it away.

**Before benchmarking a transfer, confirm the old one is actually dead** — check the process
list, not the task list:

```bash
powershell "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Select ProcessId, CommandLine"
```

No data was lost: the ~1 GB of orphaned `.seg*` files were discarded and the contiguous
`.part` was untouched throughout, protected by the same rule as always — the final name
appears only after the MD5 passes.

### RAM is capped at 80%, and `workers` is the lever — a recorded deviation from P004

**Agreed with the user 2026-08-31: machine-wide RAM must stay under 80%.** At `workers=8`
(P004 §2.7's value) a training run reached **30.8 GB of 31.4 GB — 98%** and left the machine
unusable for anything else. Measured shares at that point: SNAP's JVM 7.3 GB, training
~12 GB, the user's own applications the rest.

**`DEFAULT_WORKERS` is now derived from free RAM, not fixed.**
`workers_for_available_ram()` reads what is **free right now** — not total — because SNAP
holds 7+ GB while it runs and a count computed against total memory is right on an idle
machine and wrong on this one. Measured constants it divides by:

| | |
|---|---|
| `TRAINER_BASE_GB` | 5.4 (main process, imgsz=1024 batch=8) |
| `PER_WORKER_GB` | 0.8 (each worker buffers 1024×1024×3 batches) |

It returns **0** rather than raising on a full machine — 0 is a valid ultralytics setting
(the main process loads its own data), and refusing to train would be a worse answer than
training slowly.

> **This is a deviation from P004 §2.7 and must be reported with any result.** It is safe in
> a way that changing batch, lr or epochs would not be: `workers` governs host-side
> prefetching, not the model, the optimiser or the arithmetic — results are unchanged and
> only wall-clock moves. `RunConfig` therefore records **both** `workers` and
> `workers_paper`, so a reader comparing wall-clock to the paper sees the difference rather
> than guessing at it.

**Verified with all three limits active and training at epoch 2/60:**
RAM **77%**, CPU **17%**, GPU memory **58%** (7.0 of 12.2 GB), zero errors.

### CPU: affinity alone does NOT cap it — thread count is the real lever

> **SUPERSEDED 2026-09-01 — THIS DIAGNOSIS IS WRONG. Do not act on this section.**
> Affinity *does* cap the machine-wide figure (19 of 24 cores = 79%, arithmetic).
> What failed was that `cap_cpu.ps1` runs from outside and cannot reach dataloader
> workers, and that **OpenCV keeps its own uncapped pool**. See §3 and §3b at the
> top of this file.

**Corrected 2026-08-31 after the user reported CPU hitting 100% with the cap supposedly
applied.** `scripts/cap_cpu.ps1` pins processes to 19 of 24 cores, and that is genuinely not
enough: **affinity limits *where* threads run, not how many there are.** PyTorch spawns one
compute thread per core by default, so a process pinned to 18 cores still drives all 18 to
saturation and the machine-wide figure sits at the cap rather than well under it.

The fix is to cap the thread count as well:

```bash
OMP_NUM_THREADS=8 MKL_NUM_THREADS=8 OPENBLAS_NUM_THREADS=8 NUMEXPR_NUM_THREADS=8   .venv/Scripts/python.exe -m ml.ablation.run_ablation --screen
```

**Measured: 100% -> 25%** with training still running. `cap_cpu_threads()` in
`ml/train/train.py` does the same from code (`CPU_FRACTION = 0.50`), but note the ordering
trap: **the OMP environment variables are read once, when the OMP runtime loads on the first
`import torch`.** Setting them inside a function that has already imported torch is too
late, which is why the launcher exports them too; `torch.set_num_threads()` is what takes
effect in that case.

Use both levers. Affinity decides which cores; threads decide how much work competes for
them.

### CPU affinity, and why this work cannot be moved to the GPU

**Agreed with the user 2026-08-31: this project's processes are capped at 80% of logical
cores** (19 of 24) at `BelowNormal` priority, via `scripts/cap_cpu.ps1`. Re-run it after
launching any long job — it is idempotent, and child processes inherit affinity on Windows,
so capping a parent also caps its dataloader workers.

```bash
powershell -ExecutionPolicy Bypass -File scripts/cap_cpu.ps1
```

**Affinity, deliberately, rather than reducing thread counts.** PHASE-02 pins `workers=8`
from P004 §2.7; changing that is a deviation from the training protocol, where restricting
*scheduling* is not. Measured after capping: 20% total CPU, jobs still progressing.

**None of the long jobs can use the GPU, and this is not a configuration gap:**

| Job | Why CPU-only |
|---|---|
| 7z extraction | LZMA2 decode is serial-dependent; no GPU 7z decompressor exists |
| SNAP Refined Lee + Terrain-Correction | SNAP's GPU support does not cover this operator chain |
| Dataset assembly | mask contouring and PNG encoding |

The GPU is loaded by **training** and nothing else. Do not go looking for a GPU flag on the
ingest path; there isn't one.

### `--auto-batch`: measure the batch instead of guessing it

`backend/device.py` picks a batch from a VRAM lookup table and says so — "a starting point,
not a measured limit". `scripts/train.py --auto-batch` profiles the real model at the real
`imgsz` via ultralytics' `check_train_batch_size`, targeting `AUTO_BATCH_FRACTION = 0.70` of
VRAM.

The profiled number is fed back through `run_config` as an **explicit** batch, so the run
record holds the integer and never the `-1` sentinel — an ablation row reading `batch: -1`
would be unusable, and PHASE-02 requires the physical batch be reported.

### ALL THREE SNAP SCENES ARE DONE — PHASE-01's central deliverable

Completed 2026-08-31 in one uninterrupted run at `--max-heap-gb 8`:

| Case | Output | Time | CRS |
|---|---|---|---|
| 1 — 2023-04-09, platform leak | 3.34 GB | — | EPSG:4326 |
| 2 — 2023-05-15, BOCHEM LONDON | 3.32 GB | 54.7 min | EPSG:4326 |
| 3 — 2023-12-05, BRANDON BORDELON | 3.33 GB | 59.1 min | EPSG:4326 |

**~1 hour per scene on this machine**, not the "several hours" earlier revisions feared.
Each was written through the `.partial` name, so every one passed both the CRS check and
the non-zero-pixel check before being renamed — the `nodataValueAtSea` trap that produced a
correctly-sized, correctly-georeferenced, entirely-zero raster cannot have occurred.

**The geocoding invariant now holds on real data, not just a synthetic transform:**

```
Case 1  32585 x 21409   round-trip 1.302e-10 px
Case 2  32582 x 21408   round-trip 1.302e-10 px
Case 3  32590 x 21410   round-trip 1.164e-10 px
```

Ten orders of magnitude inside the < 1 px requirement.
`test_roundtrip_holds_on_a_real_terrain_corrected_scene` **is no longer skipped** — the
suite's one skip is gone, and PHASE-01's most load-bearing criterion is asserted in CI
against SNAP's own geotransform.

### PHASE-02 architecture: LSK, MPDIoU, and the six ablation models

`ml/models/lsk.py`, `mpdiou.py`, `yolo_seg_lsk.py` + 31 tests. **All six ablation
architectures build and run a forward pass**, verified:

| Position | Params | vs baseline |
|---|---|---|
| none | 2,876,848 | — (exactly the stock `yolo11n-seg`) |
| L1 | 3,126,902 | +250,054 |
| L2 | 2,896,502 | +19,654 (P3, 256 ch) |
| L3 | 2,944,630 | +67,782 (P4, 512 ch) |
| L4 | 3,126,902 | +250,054 (P5, 1024 ch) |
| **L5** | 3,214,338 | **+337,490 = exactly L2+L3+L4** |

L5 summing to L2+L3+L4 is a wiring check, not a coincidence: the three heads carry
different channel widths, so a tap landing on the wrong head changes the sum. `none`
matching 2,876,848 confirms it is the untouched stock model.

**Three things here would have been silent failures.**

1. **A head tap must repoint `Segment`, or the LSK is never read.** First implementation
   inserted the blocks correctly and left `Segment` pointing at the original layers. The
   model builds, trains, and the LSK is **dead code** — the ablation measures nothing and
   would have reported "LSK doesn't help". Guarded by
   `test_the_head_actually_reads_the_lsk_output`.
2. **"In front of the head" means the head *branch*, not inline.** Layer 16 (P3) feeds both
   the small head and the Conv that downsamples towards P4. Splicing inline there puts LSK
   in the P4 and P5 routes too, so **"L2" would silently be an L2+L3+L4**. L2–L5 therefore
   tap the branch and leave the downstream path untouched; only L1 is genuinely inline,
   because "before SPPF" is a backbone position.
3. **Absolute index renumbering.** YOLO YAML addresses layers by absolute index
   (`[[16, 19, 22], 1, Segment, ...]`, plus every `Concat`). An inline insertion without
   rewriting them builds cleanly and wires the wrong tensors together.

**`LSKAttention` infers its channel count from the first input.** Ultralytics resolves YAML
modules through `globals()` in `nn/tasks.py` and, for anything outside its `base_modules`
set, passes args verbatim with **no** channel injection (`c2 = ch[f]`, `m(*args)`). A fixed
count in the YAML would be right at exactly one scale — `n` and `x` differ ~6x in width.
Ultralytics' own dummy forward (for stride computation) materialises the parameters before
the optimiser or any checkpoint exists. `register_lsk()` must be called before building:
importing the class is *not* enough, it has to land in `ultralytics.nn.tasks`' namespace.

**MPDIoU** is Ma and Xu's definition — `IoU - d1²/d² - d2²/d²` over the two corner
distances, normalised by the **image** diagonal, not the enclosing box. The enclosing box
shrinks as the prediction improves, which rescales the gradient mid-training; a constant
denominator does not. That is why `image_size` is required rather than inferred.

### Baseline training is running

`scripts/train.py --screen --name baseline-screen --batch 8`, 60 epochs, binary
`slick` class, 4,606 train / 585 val. Batch 8 chosen over auto-batch's profiled **7**: the
profile showed 8 needs 8.699 GB = **73%**, inside the 80% cap, and 8 divides `nbs=32`
exactly where 7 gives an awkward ×5. At epoch 3, val mAP50 **0.198** / mAP50-95 **0.075**
over 2,937 instances — learning, but nowhere near converged.

**This is the `none` + CIoU cell of the twelve.** The other eleven need
`ml/ablation/run_ablation.py`, which does not exist yet, and the MPDIoU axis needs wiring
into ultralytics' loss (the module is written and tested; it is not yet *connected*).

### The ablation grid is built and resumable — but it is ~30 hours

> **SUPERSEDED 2026-09-01: it is ~17 h for twelve cells, ~14 h for the ten
> remaining.** The 2.5 min/epoch below predates the disk cache and the pre-resize;
> the measured figure is **1.38 min/epoch**. `--list` now reads the real times from
> `results.csv` rather than any constant.

`ml/ablation/run_ablation.py` + 9 tests. Both axes are now implemented and verified.

```bash
.venv/Scripts/python.exe -m ml.ablation.run_ablation --list --screen
.venv/Scripts/python.exe -m ml.ablation.run_ablation --screen
.venv/Scripts/python.exe -m ml.ablation.run_ablation --screen --only L5:mpdiou
```

**Measured cost: ~2.5 min/epoch** (576 iterations at batch 8, ~4 it/s), so ~2.5 h per cell
and **~30 h for the twelve at 60 epochs**. That is far longer than one sitting, which is why
the runner is resumable: a cell counts as done only when its `run.json` contains
**`results`**, not merely when the file exists — the pre-flight record is written *before*
training starts, so treating the file as completion would skip every interrupted run.

> **If 30 h is too long, the lever is screening depth, not the grid.** Dropping to 30 epochs
> halves it and still ranks the variants. Do **not** drop cells: L4 is the one P004 found
> *degrades* under MPDIoU, so an incomplete grid loses the most interesting row.

**The MPDIoU swap is verified, and its failure mode is guarded.** `use_mpdiou` returns how
many `BboxLoss` objects it replaced, and the runner **raises** on zero — otherwise the run
would train with CIoU while the results table claimed MPDIoU, quietly turning the ablation
into six duplicated rows. Ultralytics builds the criterion lazily, so the patch is applied
from an `on_train_batch_end` callback on the first batch; `on_train_start` is too early.

`MPDIoUBboxLoss` **delegates the DFL term to `super()`** and replaces only the IoU term.
Measured: IoU term 0.2949 vs CIoU's 0.3013, DFL term bit-identical. Copying ultralytics'
DFL block instead would duplicate internals that shift between releases, and a silent drift
there would move *both* arms of the ablation at once — destroying the only comparison the
grid exists to make.

`ml/ablation/results.md` is written after every cell and states its own caveats: the
screening depth, that it is a **binary** baseline rather than the two-class model, and the
`workers` deviation.

### CRITICAL: the confound that would have invalidated the whole ablation

Found while wiring the grid, and it would not have announced itself. **Handing a YAML to
`YOLO()` builds from random initialisation.** The baseline run used `yolo11n-seg.pt` —
COCO-**pretrained**. Left alone, the twelve cells would have compared a pretrained baseline
against from-scratch LSK variants, and the grid would have reported a confident, wrong
**negative** on `SYNTHESIS.md` §9 Q1 — the one question PHASE-02 exists to answer.

Three separate asymmetries had to be closed before the cells were comparable. The
transferred-tensor count at each stage:

| Stage | none | L1 | L2–L5 |
|---|---|---|---|
| naive `.load()` | 510 | **192** | 378 |
| + `nc` set to our class count | 510 | 192 | 378 |
| + head excluded from transfer | 378 | **192** | 378 |
| + L1 index remap | 378 | **510** | 378 |
| + filter the *retargeted* key | **378** | **378** | **378** |

1. **The head's index moves.** Appending LSK before `Segment` shifts it from 23 to 24/25/26,
   so its checkpoint keys stop matching for L2–L5 while still matching for `none`/L1. The
   head is excluded from transfer **everywhere** — it is rebuilt for our class count anyway,
   so every cell now starts from a pretrained backbone/neck and an identical random head.
2. **L1 shifts the backbone too.** Its inline insertion at index 9 moves every later layer,
   so it received **192 of 394** where others got 378 — a handicap on exactly the weights
   that matter most. `stock_index_map` remaps it.
3. **The head filter must test the *remapped* key.** With the remap in place, L1's stock
   head at `model.23` retargets to `model.24`, so filtering the *source* key against this
   architecture's head prefix let the head slip through — L1 then got **510**, the opposite
   asymmetry.

All six now transfer **exactly 378**. Pinned by
`test_every_cell_receives_the_same_pretrained_weights`, which asserts the counts are equal
rather than asserting any particular number.

> **The `baseline-screen` run is therefore NOT the `none-ciou` cell.** It loaded a full
> pretrained checkpoint including the head, via `scripts/train.py`. Keep it as a reference
> point — 60 epochs in 2.73 h, mask mAP50 **0.447**, mAP50-95 **0.208**, box mAP50 0.472 —
> but the grid re-runs `none-ciou` under its own, symmetric setup.

**Both have now run, and the difference is worth knowing.**

| Run | Head weights | mask mAP50 | mask mAP50-95 |
|---|---|---|---|
| `baseline-screen` | pretrained (COCO, 80-cls) | 0.447 | 0.208 |
| **`none-ciou`** (the grid cell) | random, as every cell | **0.429** | **0.198** |

Excluding the pretrained head costs about **1 point of mAP50-95**. That is the price of a
valid comparison, not a regression — and it is why the grid's own baseline, not
`baseline-screen`, is the number every LSK cell must be judged against.

### The RAM estimate was wrong twice — what the constants actually are

`PER_WORKER_GB` was first set to 0.8 from per-process working-set figures. Derived from
that, the guard chose 8 workers on an idle machine and the run went **straight back to
98%**. Working set undercounts shared and cached pages; the real marginal cost is nearer
`(14.7 - 5.4) / 8 = 1.16` GB. Now **1.3 GB** with a **2.0 GB** reserve held back, because
the cost is asymmetric — too few workers is slower, too many is a machine the user cannot
type on.

**Verified running:** the grid at `--workers 4` sits at **RAM 72%**, GPU 53%. Prefer passing
`--workers` explicitly over trusting the derivation until it has been observed on this
machine across a few runs.

### PHASE-05 is complete — and the gap was in the database, not the code

All seven criteria now met. The modules had been written and unit-tested since 2026-08-30,
but **none of the criteria were actually satisfied**, because more than half of them are
database-shaped ("queryable by name", "< 2 s spatiotemporal query") and `ais_tracks` was
**empty** — `scripts/ingest_ais_fixture.py` measures without writing unless `--insert` is
passed, and it never had been.

| Case | National rows | After AOI + window clip | Tracks |
|---|---|---|---|
| 1 — platform leak | 25.3 M | 2,955,407 (11.7%) | 2,149 |
| 2 — BOCHEM LONDON | 26.5 M | 3,044,735 (11.5%) | 2,234 |
| 3 — BRANDON BORDELON | 19.1 M | 1,892,552 (9.9%) | 2,354 |

**6,737 tracks total. `ais_points` is 0**, and a test now fails if that changes — the
storage decision measured at ~70 MB as `LINESTRING M` against ~726 MB as points, on a
500 MB free tier.

**The fixture vessels read correctly, which is the real signal:**

| Vessel | Behaviour | Silent fraction | Gaps |
|---|---|---|---|
| BOCHEM LONDON (Case 2, under way) | `is_transiting=True` | 0.4% | 1 |
| BRANDON BORDELON (Case 3, berthed) | **`is_loitering=True`** | 27.4% | 36 |

**A real bug the new integration test caught.** Tracks inserted fine and were queryable, but
`behaviour` was stored as `{}` — `AisTrajectory.as_db_values()` never serialised it. PHASE-06
would have found the vessels and had **no behavioural signal to weigh**, which is precisely
what Case 3 needs. `as_storage_payload()` now persists the behavioural terms together with
the reception quality, because **C7 requires the raw gap and the expected rate to travel
together**: a silence figure without the cadence it is judged against invites reading an
ordinary coverage gap as evasion. `gap_evidence_usable` and its explanation are stored too,
so a downstream reader cannot take the number and lose the caveat.

`as_db_values(behaviour=...)` takes the payload explicitly rather than computing it, keeping
serialisation pure and making the caller decide what analysis to persist.

**New:** `tests/test_ais_database.py` (5 tests, marked `integration`, skipping cleanly when
the database is unreachable or unpopulated so CI without a database still passes).

### PHASE-04: the drift engine is built and the physics is verified

**The foundational check passes.** OpenDrift documents that a negative `time_step` runs
backwards; PHASE-04 requires that be proven before anything is built on it. Measured on
opendrift 1.14.11, constant current, **zero diffusivity**, 12 h out and back over 13.60 km:

```
round-trip error   mean 0.38 m   max 0.89 m      (~7e-5 relative)
```

Pure integrator error. Everything downstream now rests on a checked fact rather than a
documented claim.

**Two ordering facts, measured because the origin field is built directly on them:**
`times` **DESCENDS** for a backward run (`times[0]` is the observation), and history is
stored as **float32** — so `history[0]` matches the seed to ~1e-5, not machine epsilon. A
tighter comparison fails for no real reason, which cost one debugging cycle here.

**End-to-end, on real runs:**

| | |
|---|---|
| Ensemble | 10 members x 150 particles, 145 steps, **28.0 s** (cap is 5 min), 0 failures |
| Field | every timestep integrates to 1.0; spread **0.85 -> 3.67 km** over 24 h backward |
| 90% region | covers 2.7% of the grid at the midpoint |

The **monotonic widening is the point, not a defect** — diffusion is irreversible and a
narrow origin field at 48 h would be a lie.

**The age estimator mostly refuses, and that is correct.** Against constant forcing there
is no convergence minimum at all, and `estimate_age` returns **`monotonic`** with the reason
rather than inventing a number. Three distinct honest outcomes, not one:

| Status | Meaning |
|---|---|
| `converged` | a genuine interior minimum, deep enough to trust |
| `monotonic` | spread never re-focused — physics, not failure |
| `beyond_horizon` | field too diffuse to discriminate (C3) |
| `insufficient_evidence` | the region never reaches the proposed source |

C1 is structural: `AgeEstimate` has `low`/`best`/`high` and a `method`, and **no field a
bare scalar could be stored in**.

**C5 is structural too:** `sample_members` raises below `MIN_MEMBERS = 5`. The ensemble
samples wind drift factor, diffusivity **and wind phase shift (±3 h)** by Latin hypercube —
the phase shift because Kampouris 2021 found sensitivity to wind *timing*, which is the term
easiest to leave out. Members stack on the particle axis; averaging them would collapse the
ensemble back into the single trajectory C5 forbids.

**New:** `opendrift_runner.py`, `origin_field.py`, `convergence.py`, `ensemble.py`,
`metocean/cache.py` + `test_drift.py` (11), `test_origin_field.py` (23),
`test_metocean_cache.py` (17).

**What is blocked, and honestly so.** Three criteria — the 19 km forward footprint, the
backward hit-rate on all three cases, and Case 3's age interval — **need real CMEMS
currents**. Constant forcing cannot produce a realistic footprint, and asserting one against
synthetic currents would test nothing. The machinery for all three is built and tested; only
the forcing is missing.

### CFAR bright-target detection — built, calibrated, run on a real scene

`backend/detect/cfar/detector.py` + 19 tests. Unblocks three things at once: the
relabelling pass (which defers 91% of instances for want of bright-target evidence),
dark-vessel candidates for PHASE-06, and P004 Case 1's "the white spot corresponds to the
platform group".

**The correctness point: CFAR runs on LINEAR power, never on dB.** CA-CFAR's threshold comes
from an exponential clutter model that holds for sigma0 in linear power and not for its
logarithm — and every product here is dB, because the SNAP chain ends in `LinearToFromdB`.
It does not degrade gracefully. Measured:

```
run on dB as if it were power :  160,000 of 160,000 px flagged
converted to linear first     :          11 px flagged
```

**The threshold is derived, not tuned** — `alpha = n * (pfa ** (-1/n) - 1)`, ~11.6 dB above
local background for the default geometry. Verified against its own false-alarm rate:

| requested pfa | over 360,000 pure-sea cells | expected |
|---|---|---|
| 1e-4 | **32** | ~36 |
| 1e-6 | **0** | ~0.36 |

and detection tracks it: +25/+20/+15 dB targets found, +10/+5 dB correctly rejected.

**A real limit found and documented: large targets self-mask.** A target wider than its
guard ring reaches into its own training annulus and hides itself, so the *biggest* targets
are the ones that vanish. Measured:

| target | guard 4 | guard 8 | guard 15 |
|---|---|---|---|
| 5x5, 10x10 | found | found | found |
| **20x20** | **MASKED** | **MASKED** | found |

**This is not academic — P004 Case 1's target is a platform *group*.** Confirmed on the real
scene: guard 4 finds the platform but measures it at 27 px; guard 15 recovers 132 px of the
same target. Raise `guard_px` when hunting infrastructure.

**On the real Case 1 product** (2000x2000 window, 100% sea, ~1.2 s):

| band | sea mean | targets | brightest |
|---|---|---|---|
| 1 (VH) | -28.3 dB | 6 | 14.8 dB |
| **2 (VV)** | -21.4 dB | **8** | **34.4 dB** |

**Band 2 again** — independently confirming the dataset finding. `SCENE_BAND = 2` and a test
asserts it equals `oos_dataset.SAR_BAND`, so the detector and the segmentation model cannot
drift into looking at different polarisations.

Land is excluded from the statistics by value: SNAP writes exact zeros over land, so zero
means "not sea" rather than "very dark sea", and including it would inflate the background
and blind the detector near shore — which is where vessels are.

### Thermal guard — stop above 93 C, resume once cool

> **SUPERSEDED 2026-09-01: the limit is now 85 C, resume 75 C.** The rest of this
> section — what is readable and what is not — still holds, and the CPU sensor is
> still unreadable without elevation.

Agreed with the user 2026-08-31. `scripts/thermal_guard.py` + 12 tests.

```bash
.venv/Scripts/python.exe scripts/thermal_guard.py --watch-only
.venv/Scripts/python.exe scripts/thermal_guard.py --command "<restart command>"
```

**What is readable on this machine, and what is not.**

| Sensor | Status |
|---|---|
| **GPU** | **readable** via `nvidia-smi`, unprivileged |
| CPU | **needs elevation** |

Every unprivileged CPU route is blocked: `MSAcpi_ThermalZoneTemperature` returns **Access
denied**; ASUS's `AsusAtkWmi_WMNB.DSTS` — the interface behind **Armoury Crate**, which is
installed here — rejects the call with "Invalid method Parameter(s)", which is what that
provider does for a non-admin caller; `Win32_TemperatureProbe` returns nothing; and
`psutil.sensors_temperatures` does not exist on Windows. **Run the guard from an elevated
shell to get CPU coverage**; `cpu_available` in its log says which you have.

**A missing sensor is never treated as a cold one.** `Reading.hottest` skips `None` rather
than defaulting to 0 — a guard that read a blind sensor as cold would log "ok" straight
through an overheat. Guarded by a test.

**Hysteresis is deliberate:** trip at ~~93~~ **85** C, resume only at ~~80~~ **75** C. Resuming the instant it
dips under the limit produces a thrash cycle — restart, climb back over in seconds, stop
again — making no progress while looking busy. The guard only ever stops **this project's**
jobs, matched by command line, never anything else the user is running.

Observed during a real grid run: GPU **57-70 C**, nowhere near the limit.

### Keeping the GPU fed without loading the CPU

The user asked for load on the GPU and off the CPU. Measured mid-run, the two are not in
tension the way they look — **the GPU was idling, waiting for images**:

| | GPU util | CPU | throughput |
|---|---|---|---|
| workers=1, no cache | 58% | 28% | ~4 it/s |
| workers=1, cache building | 42% | 19% | ~4 it/s |
| **workers=3, cache warm** | **84%** | **22%** | **6.4 it/s** |

Two changes, and the second is the counter-intuitive one:

1. **`cache="disk"`** — ultralytics writes decoded, letterboxed images as `.npy` and
   memory-maps them thereafter, so per-epoch decode and resize leave the CPU entirely. The
   cache sits beside the dataset and is **shared by all twelve ablation cells**, so the cost
   is paid once. ~19 GB measured. `'ram'` is not an option: the RAM ceiling already binds.
   **Note the first epoch is slower, not faster**, while the cache is written.
2. **More dataloader workers, not fewer.** At `workers=1` a single process feeds the card
   and it starves. CPU was only 22% against an 80% ceiling, so spending a little more of it
   is exactly what raises GPU utilisation — cutting workers to "spare the CPU" achieves the
   opposite of what was wanted.

**Disk is now at 90% (97 GB free)** with the cache written. Worth watching before adding
another large dataset.

### Open: CMEMS credentials are absent

`.env.example` declares `COPERNICUSMARINE_SERVICE_USERNAME` / `_PASSWORD`; the real `.env`
**has neither key**. `CDSAPI_KEY` (ERA5 wind) *is* set. PHASE-04 currents therefore need a
free account at `marine.copernicus.eu` before any real forcing can be fetched. Not blocking
today — PHASE-04's engine and the zero-diffusivity round-trip are built against synthetic
forcing by design.

## Changes made on 2026-08-30

Everything below is **uncommitted** on top of `230269d`.

### New files

| Path | What it is |
|---|---|
| `backend/ingest/datasets/relabel.py` | Binary -> `{oos, slick_unknown}` relabelling assistance. **Proposes, never labels** - see below |
| `scripts/download_zenodo.py` | Corpus downloader: free-space guard (checks archive size *and* extraction headroom), smallest-file-first ordering, retry with backoff |
| `tests/test_relabel.py` | 16 tests |

### Modified

- `graphs/s1_grd_preprocess.xml` - `LinearToFromdB` added as the final node before `Write`;
  `outputImageScaleInDb` set to `false` so the graph states what actually happens.
- `backend/ingest/datasets/zenodo.py` - `download_file` now **resumes** from a `.part`
  sibling via a Range request, and only moves the file into place after the checksum
  passes. Handles the trap that a server may answer a ranged request with **200 and the
  whole file**, in which case appending would silently corrupt a multi-GB archive.
- `tests/test_preprocess.py` - 4 tests: graph is well-formed XML, dB conversion is last,
  `Write` actually consumes it, `Calibration` does not ask for dB.
- `tests/test_zenodo.py` - 4 tests covering resume, the 200-to-a-ranged-request trap,
  skip-if-verified, and checksum failure.
- `PLAN/CONSTRAINTS.md` - the σ0-in-dB ordering deviation, with its reason.

### `relabel.py` - the one design point worth knowing

PHASE-01 calls relabelling "annotation work, not code". The module is built so it
**cannot** become an auto-labeller: `export_review` writes every record with
`confirmed_class: null`, and `load_confirmed` returns only records a human signed, raising
on a class outside the scheme or a label with no `confirmed_by`.

The morphology rule is PHASE-01's ("linear + vessel-adjacent -> `oos`, irregular ->
`slick_unknown`") with one qualifier from `RESEARCH/topics/lookalike-discrimination.md`:
**a ship wake is linear and dark and shaped exactly like an OOS**. So linearity *without* a
nearby bright target is deliberately **not** proposed as `oos` - it is deferred to a human,
because shape alone cannot separate those two. Run against 40 real Refined SOS masks it
proposes `slick_unknown` 102 times and defers 91%, which is the correct answer while
`bright_targets` is empty: CFAR arrives in PHASE-02, and until then the `oos` evidence
simply does not exist.

### How the Zenodo masks are actually encoded - read before loading any of them

Found by running against the real Refined SOS masks, not from the docs. Both traps are now
handled inside `relabel.binarise`, but **anything else that loads these masks (PHASE-02
dataset assembly especially) has to handle them too.**

1. **They are RGB, not single-channel** - three identical channels, 256x256x3. Left 3-D,
   `skimage.measure.label(..., connectivity=2)` treats the array as a **volume**; every
   measurement comes out meaningless and nothing raises.
2. **They carry a lossy-compression halo.** The masks are binary *in intent* - 28 of 40
   sampled are cleanly `{0, 255}` - but the other 11 ring with intermediate values
   (measured: 73.6% at 0, 25.7% at 255, ~0.7% smeared across 1-254). Thresholding at
   **`> 0` is wrong**: the halo sits *between* neighbouring slicks and **bridges them into
   a single instance**, merging 47 true instances down to 43 on the sample. For an
   instance-segmentation ground truth a merged pair is a corrupted label, which matters far
   more than the 4% area inflation that accompanies it.

   Threshold at **half the observed maximum**, not a fixed 128 - a fixed 128 would empty a
   `{0, 1}`-encoded mask, and both encodings are in circulation.

So `PLAN/CONSTRAINTS.md`'s "Zenodo masks are binary" stands, but "binary" means *after* a
correct threshold, not as stored.

## PHASE-05 started 2026-08-30 (AIS), while PHASE-01's long runs proceed

Picked up because HANDOFF says to switch to PHASE-05 rather than idle, and because it needs
neither GPU nor bandwidth - both were saturated. New: `backend/ingest/ais/clip.py` +
`tests/test_ais_clip.py` (20 tests). Three things were found by running against **real**
marinecadastre data rather than fixtures.

### 1. No AOI clipping existed at all

`CONSTRAINTS.md` requires clipping at ingest and nothing implemented it. `clip.py` now
provides `BoundingBox` / `TimeWindow` / `clip_records`, with `GULF_OF_MEXICO` derived from
the **measured** Case 1 footprint (lon -91.1022..-88.1751, lat 27.9531..29.8763).

Two non-obvious points, both tested:

- **The box is buffered by 100 km, not clipped to the footprint.** Backward drift means the
  origin can lie *outside* the imaged scene, so a tight clip would delete the very vessel
  the pipeline exists to find. 100 km is the drift horizon: ~0.5 m/s over 48 h is ~86 km.
- **The longitude buffer is scaled by `cos(latitude)`.** At 29 N a degree of longitude is
  ~0.87 of a degree of latitude, and longitude is the axis these scenes are widest in.

### 2. One malformed row killed an 8.2-million-row ingest

`AIS_2023_04_09` contains exactly **one** row whose MMSI is `G338926440` (CGC OLIVER HENRY,
a Coast Guard cutter off Guam, far outside the AOI). `int()` raised and aborted the whole
national day. `iter_ais_records` now skips and **counts** bad rows via `LoadStats`, with
`strict=True` to restore hard failure for fixtures. A silent drop was not acceptable: a
provider format change would otherwise present as "slightly less traffic", and traffic
volume feeds the scoring.

### 3. A 48 h window spans THREE daily files, not one

Anchored at 00:02, the window touches Apr 7, 8 and 9. Loading only the acquisition day gives
~2 minutes of overlap - **2,330 rows instead of 2,955,407** - and looks like light traffic,
not an error. `daily_files_for_window` / `resolve_daily_files` now raise `MissingAisDayError`
naming the absent day rather than under-covering the window.

### 5. `synthetic.py` - the five authored Indian-waters scenarios (C10)

`backend/ingest/ais/synthetic.py` + `tests/test_synthetic_ais.py` (25 tests). Regions are
the three the plan names: **Gulf of Kutch**, **Mumbai High**, **Ennore/Chennai**. Roughly
50,000 messages and 28-29 vessels per scenario, at marinecadastre's 1-minute cadence over
the 48 h backward horizon.

**C10 is structural, not a convention.** `ReleaseTruth` is written *by the generator* -
discharging MMSI, release position, release window, and an `expected_answer` naming the
correct outcome. Nothing infers it back from the trajectories.

| Scenario | Region | Authored truth |
|---|---|---|
| `moving_tanker` | Gulf of Kutch | Case 2 analogue. Discharger transits at ~11 kn; `is_transiting` |
| `berthed_discharge` | Ennore/Chennai | **Case 3 analogue.** Discharger moored 75% of window; `is_loitering` |
| `platform_leak` | Mumbai High | Case 1 analogue. `discharging_mmsi=None` - name **no** vessel |
| `dark_vessel` | Mumbai High | Discharger **absent from the AIS entirely**; expect an unattributed CFAR target |
| `null_case` | Gulf of Kutch | **No spill.** Any named suspect is a false accusation |

PHASE-05's key test passes: every generated row parses with the **real** loader, a written
file round-trips through `iter_ais_records(strict=True)`, and the real cleaner keeps 100%.
That is what makes the synthetic path trustworthy - it is validated by the same code as the
real one.

**One bug worth knowing:** seeding on `seed` alone drew the *same* MMSIs in every scenario,
so one identifier was a moving tanker in one scenario and a berthed vessel in another. The
demo shows these side by side, so a single MMSI would have contradicted itself in one
database. The seed now mixes in `crc32(scenario_name)` - `crc32` and not `hash`, which is
randomised per interpreter run and would have destroyed reproducibility across sessions.

### 4. `behaviour.py` and `gaps.py`, validated against the real fixture vessels

New: `backend/ingest/ais/behaviour.py` (16 tests) and `gaps.py` (17 tests).

**Both PHASE-05 vessel acceptance criteria now pass, on real data:**

| Vessel | Case | Result |
|---|---|---|
| `BOCHEM LONDON` | 2 | MMSI 477636500, type 80 (tanker), 2,965 msgs. `is_transiting=True`, mean SOG 7.0 kn |
| `BRANDON BORDELON` | 3 | MMSI 367697440, 2,416 msgs. `is_loitering=True`, 85% below 0.5 kn |

The Case 3 mooring the criterion names is exactly visible. Splitting the track at
**18:59:12 UTC 2023-12-03**:

| Segment | Msgs | Loiter | Mean SOG | Net displacement |
|---|---|---|---|---|
| before | 753 | 53% | 3.78 kn | **121.3 km** |
| after | 1,663 | **100%** | 0.09 kn | **1.2 km** |

Berthed for ~53 h until the slick was imaged at 23:57:19 on 12-05 - the adversarial
signature, and why only a backward-drift field can rank this case correctly.

### C7 and the gap detector: two wrong hypotheses before the right one

Worth reading before touching `gaps.py`, because the first two fixes looked obviously
correct and were not.

Against a whole-track median interval, BRANDON BORDELON flagged **57 of 65 gaps** as
anomalous - the exact over-flagging C7 exists to prevent.

1. **"AIS reports slower at anchor, so split the expectation by movement state."**
   Implemented (`expected_interval_for_state`, still present and still correct in
   principle). **It changed nothing here:** measured, this vessel's moored and under-way
   medians are *identical* at 1.17 min.
2. **"Suppress gap evidence when the vessel is silent too large a fraction of the span."**
   Too blunt. It also silenced vessels whose single long outage is precisely the signal.

**What was actually true:** the vessel reports every ~1.17 min *while audible*, then goes
quiet repeatedly - 65 gaps, median 15 min, silent **26%** of the span. The median
inter-message interval describes the cadence *within* a burst, not how often the vessel is
heard, so every ordinary coverage gap scored 10-90x against it.

**The rule now:** a vessel with >= `MIN_GAPS_FOR_PATTERN` gaps has a reception *pattern*, so
a gap is judged against **its own gap distribution** - it must exceed
`GAP_OUTLIER_MULTIPLE` x the typical gap to count as a discrete event. This is a structural
argument, not a tuned threshold. Result: **57 -> 6** for BRANDON BORDELON (the 113 min and
63 min outages survive), **1 -> 0** for BOCHEM LONDON.

`reception_quality` reports `silent_fraction` and gap count for the evidence card, since C7
requires the raw gap *and* the expected rate to be surfaced together. No explanation in this
module ever asserts intent.

### The storage problem this exposed - DECIDED 2026-08-30

Measured over the three Case 1 days: **25,273,138 national rows -> 2,955,407 after AOI +
window clipping**, 2,172 vessels, ~1,361 messages/vessel over 48 h (correct 1-minute
density). That is only a **9x** reduction, not the ~1000x the plan implicitly assumed.

At a realistic ~250 bytes/row in Postgres including the GIST index, that is **~700 MB for a
single fixture case** against a **500 MB** free-tier ceiling, and ~2 GB for all three.
**Clipping alone does not solve the ceiling.** **Decided with the user: option 1 -
insert `ais_tracks` only, never `ais_points` for real AIS.** Recorded in
`PLAN/CONSTRAINTS.md`; driven by `scripts/ingest_ais_fixture.py`, which measures without
writing unless `--insert` is passed. Measured for Case 1: **2,149 vessel tracks, ~68 MB**
against 2,955,407 point rows at ~705 MB. Options considered:

1. **Insert `ais_tracks` only, not `ais_points`** - 2,172 LINESTRING M rows per case instead
   of 2.9 M point rows, roughly 70 MB/case. The M ordinate already makes the spatiotemporal
   gate a single PostGIS operation, so this is the designed query path anyway.
2. **Downsample to 5-minute** before insert - 5x, ~140 MB/case. 1-minute resolution is far
   finer than a 48 h drift gate needs.
3. **Supabase Pro** (8 GB).

The byte figures are estimates; measure a real insert before committing.

## Changes made on 2026-08-29

The following were made on the previous (4060 Ti) machine and are now committed in
`ba233ae` / `230269d`.

### New files

| Path | What it is |
|---|---|
| `backend/ingest/sar/cdse.py` | CDSE OData client: token refresh + resume. **CDSE answers ranged requests with 200, not 206**, so resume restarts rather than corrupting the file |
| `backend/ingest/sar/preprocess.py` | SNAP `gpt` invoker: locates `gpt`, sets the JVM heap, summarises Java stack traces down to the real cause, verifies the output CRS **and that it contains data**, and discards partial output on failure |
| `backend/ingest/datasets/zenodo.py` | Zenodo record listing + download with **MD5 verification** |
| `scripts/download_cdse_fixture_safe.py` | Downloads the three fixture scenes as complete `.SAFE` products |
| `scripts/preprocess_fixtures.py` | Batch-runs the SNAP chain; skips `_COG` products with an explanation |
| `tests/test_cdse.py`, `tests/test_preprocess.py`, `tests/test_zenodo.py` | 31 new tests (24 -> 55) |

### Modified

- `graphs/s1_grd_preprocess.xml` - three real bugs fixed (traps 1-3 above), each with a
  comment explaining why, each guarded by a test.
- `.env` - `DATABASE_URL` repointed at the **IPv4 session pooler**. The direct host
  `db.<ref>.supabase.co` is **IPv6-only** and this machine has no IPv6 route, which
  presents as `failed to resolve host ... getaddrinfo failed` and looks like a typo.
- `scripts/SETUP_NEW_MACHINE.md` - SNAP install, the Supabase IPv6/pooler trap, the
  `PROJ_LIB` fix, disk budget.
- `PLAN/CONSTRAINTS.md` - SNAP-in-a-container constraint **amended** to
  "not through `esa_snappy` on Windows", with the reason recorded. `gpt` is a plain Java
  CLI, so **Docker is no longer needed for anything** - Supabase replaced PostGIS too.
- `PLAN/phases/PHASE-01.md` - "Confirmed on this hardware" section.
- `scripts/download_cdse_fixture_vv.py` - one lint fix. **Superseded**; it fetches only
  measurement bands, which cannot be calibrated.

### Machine changes outside the repo

- **ESA SNAP 14** installed at `C:\Program Files\esa-snap` (`winget install
  EuropeanSpaceAgency.SNAP`). SNAP 12 also installed at `C:\esa-snap-12` while chasing a
  wrong hypothesis - **not needed**, safe to uninstall.
- **Machine-level `PROJ_LIB` and `GDAL_DATA` removed.** A PostgreSQL/PostGIS install had
  set them to its own outdated PROJ database, which shadows rasterio's and breaks every
  Python geospatial stack on the machine. Symptom: `CRSError ... DATABASE.LAYOUT.VERSION.
  MINOR = 2`, or `crs.to_epsg()` returning `None` for a valid EPSG:4326 product. **A shell
  opened before the fix keeps the stale value** - if you see this, open a new one. Old
  values are recorded in `scripts/SETUP_NEW_MACHINE.md`.
- PostgreSQL 16 + PostGIS were installed early in the session under the superseded
  local-Postgres plan. **The project uses Supabase**; the local instance is unused and
  its only lasting effect was the `PROJ_LIB` pollution above.
- Python 3.12.10 installed via `pymanager`; `.venv` rebuilt against it with torch
  **cu128** (verified with a real CUDA allocation, not just `is_available()`).

### Not done, deliberately

- **No Zenodo downloads** - blocked on disk, see the top of this file.
- **The dB / filter-order question** - raised, not decided. See above.
- **No scene preprocessed** - the chain works; it needs an uninterrupted multi-hour run.

## What PHASE-00 delivered

- **`RESEARCH/`** corpus: INDEX, SYNTHESIS, one note per paper (P001-P004), six topic
  syntheses, citation graph. `RESEARCH/SYNTHESIS.md` carries every design decision and its
  justification, and is the document to read alongside `PLAN/`
- **`PLAN/`**: architecture, interfaces, prerequisites, constraints, evaluation, and eleven
  phase files (00-09 core, 10 gated bonus)
- **Scaffold**: Python 3.12 package, typer CLI with a `doctor` command, PostGIS schema and
  alembic baseline, smoke tests, native-Postgres setup notes
- **Constraints enforced structurally** in `backend/db/models.py` rather than by
  convention: slick age cannot be stored as a bare scalar, no absolute-thickness column
  exists, a suspect score cannot be written without its terms and weights, and dark vessels
  cannot be named. `tests/test_smoke.py` guards each one

Verified at the time of the commit: `pytest` 11 passed / 1 skipped, `ruff` clean,
`mypy` clean on 18 source files.

## Environment: what changed with the move

| | Dev laptop (was) | Training machine (now) |
|---|---|---|
| GPU | GeForce GT 710, 2 GB, sm_35 - **unusable** | **RTX 4060 Ti — the 8 GB variant**, sm_89 (see the warning below), or **RTX 5070 Ti laptop 12 GB** |
| Python | 3.12 (3.11 absent, 3.14 too new for the stack) | Install 3.12, same reason |
| Database | Local Postgres planned | **Supabase**, hosted, reached via the **IPv4 session pooler** |
| Docker | Required for PostGIS and SNAP | **Not required at all.** Supabase replaced PostGIS; SNAP runs natively via `gpt` |
| `uv` | Not installed, plain `pip` + `venv` | Either |

> **The desktop card is 8 GB, not 16 GB.** `nvidia-smi` reports 8188 MiB and
> `doctor` resolves it to 7.996 GB, which falls *just under* `MIN_TRAIN_VRAM_GB
> = 8.0` in `backend/device.py`. So `doctor` currently reports
> "too little VRAM to train the PHASE-02 model" on this machine. PHASE-01 needs
> no GPU, so this is not blocking yet, but **PHASE-02 needs a decision**: use the
> 5070 Ti laptop, lower the floor and accept a smaller batch, or rent a GPU.
> Do not assume the 16 GB figure that earlier revisions of this file asserted.

The GT 710 notes scattered through the docs are historical. The floor is **sm_50 or later,
8 GB+**, and it is enforced in code (`backend/device.py`), not by configuration. `FORCE_CPU`
is now a debug override defaulting to 0, not something to set per machine.

### PHASE-02 batch sizing - read before training

Zhao et al. trained at `imgsz=1024, batch=32` on a **24 GB RTX 4090**. Neither of this
project's machines has that, so the batch is **derived from detected VRAM** rather than
fixed: see `backend/device.py` and the table in `PLAN/phases/PHASE-02.md`. Nothing needs
editing when you switch between the 4060 Ti (16 GB) and the 5070 Ti laptop (12 GB) -
`python -m backend.cli doctor` reports the resolved device and the batch it would pick.

Effective batch is held at 32 via `nbs=32` gradient accumulation on every machine, which is
what keeps the ablation comparable to their Table 1. **Record the physical batch used**, and
say so if a grid was split across both machines.

If you move to the 5070 Ti: RTX 50-series is sm_120 and older CUDA wheels may lack kernels
for it. Install a CUDA 12.8+ PyTorch build and verify with a real allocation before starting
a long run.

**Wall-clock warning.** PHASE-02 specifies 12 ablation runs at 100 epochs. On either card
that is likely days, not hours. Suggested approach, to be confirmed with the user: run the
full grid at reduced epochs (around 60) to rank the variants, then full-train only the top
two plus the baseline. Record that you did this, because it changes how the numbers compare
to the paper.

## The Supabase switch: what it changed

Decided 2026-08-28 after the trade-offs were put to the user, who chose it anyway. Three
consequences you inherit:

1. **The demo is no longer offline by default.** PHASE-09 originally guaranteed the whole
   demo ran with networking disabled, because network dependence is the usual way a live
   demo dies. That guarantee is gone. **C12** replaces it: export the result set to a local
   snapshot and add a `DEMO_OFFLINE=1` read path. This is now deliberate work, not a
   property of the architecture.
2. **AIS must be clipped at ingest.** Free tier is 500 MB, Pro is 8 GB, and marinecadastre
   national files run to millions of rows per day. Clip to the AOI bounding box and the
   acquisition window *before* insert, and keep the raw CSVs on local disk under
   `data/raw/`. `ais_points` is the table that will blow the ceiling first.
3. **Migrations need the direct connection.** Supabase's transaction pooler (port 6543)
   has no prepared statements; alembic and psycopg3 both need them. Use port 5432.
4. **Our tables are internet-reachable by default.** PostgREST serves the `public` schema
   over HTTPS. Enable RLS on every table, or use a non-exposed schema, **before** any real
   AIS lands in it.

Also note `DB_CONNECT_TIMEOUT` now defaults to **15 s**, not 3 s. The old value was tuned
for a local socket and fails spuriously against a hosted instance, particularly a free-tier
project waking from pause. A free project pauses after about a week idle - if `doctor`
times out after a quiet spell, check the dashboard before debugging anything else.

## Open questions carried forward

Full list in `RESEARCH/SYNTHESIS.md` section 9. The two that will bite first:

1. **Does LSK-at-L5 transfer from a detection head to a segmentation head?** Zhao et al.
   only ablated detection. This is the main technical risk of PHASE-02. **A negative result
   is a legitimate finding** and must be reported, not engineered around.
2. **`S_drift` as max over track points, or integral of the track through the field?** The
   integral should favour a vessel that lingered, and therefore the P004 Case 3 fixture.
   Implement both and let the fixture decide. (PHASE-06)

## Known risks

| Risk | Note |
|---|---|
| **Binary to 2-class relabelling** | Zenodo masks are binary; the scheme needs `oos` + `slick_unknown`. **Largest hidden cost in the plan.** Annotation work, not code. Start it as soon as Part I downloads, in parallel with everything else |
| Ablation wall-clock on a 4060 Ti | See above. Agree a reduced-epoch screening pass with the user before committing days of compute |
| Backward-drift convergence sharpness | Diffusion is irreversible; the convergence minimum may be shallow. Main risk to the age deliverable (PHASE-04) |
| **P004 Case 3 is genuinely hard** | Cerulean's parity and proximity terms both fail on it. If `S_drift` cannot carry it, revisit the formulation, **do not tune weights to force a fixture to pass** |
| MKLab is request-gated | Cannot be a dependency; Zenodo Parts I-III + Refined SOS cover it |
| CMEMS auth at demo time | Cache all forcing to NetCDF early; `verify_offline.py` in PHASE-09 |
| **Supabase storage ceiling** | 500 MB free / 8 GB Pro against millions of AIS rows. Clip at ingest, watch `ais_points` in the dashboard |
| **Demo now needs network** | C12 snapshot fallback must actually be built and tested with the network off, not mocked |

## Decisions locked with the user

| Decision | Value |
|---|---|
| Target | SIH demo prototype, demo-first |
| Regions | **Dual** - Gulf of Mexico (real AIS + published ground truth) + Indian waters (synthetic) |
| Detector | YOLO-**seg** + LSK(**L5**) + MPDIoU + SAHI |
| Drift engine | OpenDrift OpenOil, ensemble, negative `time_step` |
| Scoring | Cerulean's parity/proximity/temporality/collation **plus `S_drift`** |
| Backend stack | FastAPI + PostGIS |
| Frontend stack | React + MapLibre/deck.gl (PHASE-07) |
| Bonus scope | **PHASE-10**, wider Indian coverage, **gated behind PHASE-01-09**. Do not start early |
| **Ablation budget** (2026-08-31) | **Screen all 12 variants at ~60 epochs, then full-train the top two plus the L5 baseline at 100.** Must be stated in `ml/ablation/results.md` — a screened grid is not directly comparable to Zhao et al. Table 1 without saying so |

## Validation fixtures

Zhao et al. 2025's three Port of South Louisiana cases: published, peer-reviewed ground
truth coinciding with **free real AIS** from marinecadastre. This is why the dual-region
choice exists.

| Case | Date (UTC) | Truth | Role |
|---|---|---|---|
| 1 | 2023-04-09 00:02 | Platform leak, no vessel within 5 km | Infrastructure must outrank vessels |
| 2 | 2023-05-15 00:02 | Moving tanker, ~19 km slick | Headline case |
| 3 | 2023-12-05 23:57 | Vessel **berthed since 3 Dec**, track does not match slick | **The adversarial case** |

Case 3 is the discriminating test. Solving it demonstrates something neither the reviewed
literature nor SkyTruth's Cerulean does.

## Files that must not be modified carelessly

| Path | Why |
|---|---|
| `paperSource/**` | User-supplied source material. Read-only |
| `oil.txt` | User's own notes. Derived from P001, so not an independent source |
| `RESEARCH/**` | The reasoning audit trail. Update when understanding changes; never delete findings, including negative ones |
| `PLAN/CONSTRAINTS.md` | C1-C11 are correctness requirements, not preferences. Changing one needs a recorded reason |
| `frontDemo/**` | **Owned by the other session.** Do not touch |

## Verification before claiming any phase complete

Each phase file has an acceptance checklist. Run it. The ones most easily skipped:

- **PHASE-01**: pixel to geo to pixel round-trip **< 1 px**. Everything downstream depends on it
- **PHASE-02**: look-alike false-positive count reported **separately** from mAP (C8)
- **PHASE-04**: backward/forward round-trip under **zero diffusivity**, before trusting any result
- **PHASE-06**: all three P004 cases, **plus the Case 3 `S_drift` term-ablation**
- **PHASE-09**: `verify_offline.py` with networking disabled

## Required reading for a new session

```
HANDOFF.md              (this file)
scripts/SETUP_NEW_MACHINE.md
PLAN/INDEX.md
PLAN/phases/PHASE-02.md (PHASE-01 is substantially done; 02 is the live one)
RESEARCH/INDEX.md       (only when research context is needed)
```

## Immediate next steps (2026-08-31)

1. ~~**Let `baseline-screen` finish**, then decide the screening depth — 60 epochs is
   ~30 h, 30 epochs ~15 h.~~ **DONE, and the conclusion is the opposite: the depth
   CANNOT be shortened.** Both 60-epoch runs peak at epoch 59 of 60 with every
   validation loss still falling. A 30-epoch screen would rank an unconverged curve.
   See §1 at the top of this file.
2. **Run the grid**: `python -m ml.ablation.run_ablation --screen`. Resumable; check
   progress with `--list`.
3. **Ask the user for a free CMEMS account** (`marine.copernicus.eu`) so PHASE-04 can fetch
   real currents. ERA5 wind is already configured.
4. **Start the relabelling review.** It is the gate on the two-class model and the plan's
   "largest hidden cost"; it needs CFAR bright targets (PHASE-02) to propose `oos` at all.
5. **Not yet built in PHASE-02**: CFAR detector, SAHI inference wrapper, weights export.

## Housekeeping

- **Everything since `230269d` is uncommitted.** The user has not asked for a commit.
- **Resource caps are session-local.** `scripts/cap_cpu.ps1` sets affinity on *running*
  processes; re-run it after launching anything long. The GPU and RAM caps live in
  `ml/train/train.py` and apply automatically.
- The user's pendrive contents are backed up at `C:\pen drive backup` (1,003 files).

Do not load all papers or all phases. Follow the indexes.

---

## Parallel track: `frontDemo/`

Owned by the session on the original laptop. Summarised here only so you know what it is
and leave it alone.

A five-direction landing-page layout study (Vite + React + Tailwind v4 + anime.js v4),
switchable from a sticky right-edge rail. It is **design exploration for PHASE-07**, not
PHASE-07 itself. State, running instructions and open bugs are in
[`frontDemo/README.md`](frontDemo/README.md).

It is uncommitted as of this handoff. Do not commit it from the training machine; the other
session will.

---

## Producing the transfer zip

Exclude the three directories that are rebuilt rather than carried:

```
.venv/  frontDemo/node_modules/  frontDemo/dist/
```

Keep `.claude/` (launch config the next session needs) and `.git/` if present. **Never
include `.env`** - it now holds a live Supabase password. `.env.example` is what travels.

Exact commands: [`scripts/SETUP_NEW_MACHINE.md`](scripts/SETUP_NEW_MACHINE.md), final
section.
