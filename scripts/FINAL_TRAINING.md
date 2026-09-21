> **Recovery update, 2026-09-16:** none/L1 finished; original L4 failed with NaNs.
> Use `.venv/Scripts/python.exe -u -m scripts.recover_final_l4` for its isolated FP32
> recovery from epoch 11. Outputs/logs: `runs/final_recovery_fp32/` and
> `runs/session_logs/final_recovery_fp32/`. See HANDOFF.md for provenance and checks.
> Do not restart the original final queue against the failed L4 last.pt.

## Selected release reproduction — 2026-09-17

The 300 final epochs and the full 1,080-epoch budget are complete. `L1-ciou` is selected for mask quality, recall, boundary quality, small-object recovery and source robustness; L4 is the precision/box reserve. See `eval/final/REVIEW.md` for the complete comparison.

The original L1/L4 saved artifacts are not release candidates: Ultralytics converted the FP32 EMA to FP16 while saving and saturated large finite LSK weights. The dedicated command below uses `FP32ReleaseTrainer`, the same frozen final-v11 data, initialization and hyperparameters, and writes to a separate directory:

```powershell
.venv/Scripts/python.exe -u -m scripts.retrain_final_l1
```

**Complete:** 100/100 epochs finished with zero stderr. `best-fp32.pt` SHA-256 is `d4a74906e3a9b692c14f28305baf3cb20ba63da4c38bc30dbabd14c5c6d1fc6c`. Independent exact-setting reload validation produced mask mAP50-95 0.155680 versus the live peak 0.15622 (delta 0.00054), so the serialization blocker is closed. Do not rerun training. Next use validation to freeze the operating threshold, then evaluate the untouched test set once.

# Final comparison queue

Run from the repository root after the final dataset/configuration preflight passes:

```powershell
.venv/Scripts/python.exe -u -m scripts.train_queue --final
```

Order: **none-ciou -> L1-ciou -> L4-ciou**, each a fresh 100-epoch experiment.
A completed run starts the next automatically. A clean four-hour checkpoint boundary
resumes the same run automatically. A failed child or an exit with no progress stops
the queue and records the failing log. Completed runs are skipped on restart.

Outputs: `runs/final/<cell>/`, including best/last weights, per-epoch results,
arguments, run records and SHA-256 artifact hashes. `runs/final/frozen.json` records
the common configuration, audited dataset and training source hashes. Screening
outputs and `ml/ablation/results.md` are preserved.

Logs: `runs/session_logs/final/`. The launch log and PID file identify the background
queue; each child has a timestamped log. The Windows lock prevents duplicate queues.
The queue requests prevention of idle sleep but does not survive reboot or logoff.

To stop after the current run or timed checkpoint:

```powershell
New-Item -ItemType File -Path runs/session_logs/final/queue.stop -Force
```

To restart, first confirm no trainer/queue is active, remove that exact stop file if
present, and use the command above. Do not start a manual trainer alongside the queue.

The queue stops after all 300 epochs. Model choice, threshold selection, held-out
model evaluation and the final resolution review await the user's next request.
Per-epoch validation is part of training; no held-out test inference is queued.

Local validation on 2026-09-16: full suite 446 passed / 8 skipped; subsequent focused
checks 8 passed, including final queue resume/advance/skip and manifest membership.
Database integration and non-applicable hybrid-CPU checks remain skipped. Passing
these checks does not establish full-system acceptance or scene independence.
