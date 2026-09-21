> **2026-09-16:** Final mode is implemented and launched. See [Final training](FINAL_TRAINING.md) for its separate three-run queue and stop marker. Screening instructions below are historical.

# Overnight screening queue

> **2026-09-15:** Screening queue completed normally at 19:07:18 IST. All 720 screening epochs are done. Finalists are none-ciou/L1-ciou/L4-ciou, but this queue remains screening-only; do not repurpose existing screen directories for the three fresh100 runs. See [review and preflight](../eval/screening/REVIEW.md).


The queue runs one training process at a time using batch 4, two workers, 1024px images,
nbs=32 and full-resource access. It skips completed cells, resumes progressing timed
checkpoints, and stops on failure. It finishes the 12-cell, 720-epoch screening grid,
then pauses for selection of the three later 100-epoch models.

Current queue log: `runs/session_logs/overnight-queue.stdout.log`.
Per-child logs: `runs/session_logs/queue-<cell>-<timestamp>.log`.
The queue requests Windows to remain awake while running; display sleep is allowed.
It survives the end of the Codex conversation, but not a reboot or Windows logoff.

## Stop after the active cell or timed chunk

From the repository root:

```powershell
New-Item -ItemType File -Path runs/session_logs/queue.stop -Force
```

This does not interrupt the current trainer. It prevents the next launch, including a
resume after a timed checkpoint. The stop file stays in place until intentionally removed.

## Start later when no trainer or queue is running

Check current processes and logs first. Do not start this alongside a manually launched
trainer. The queue lock rejects duplicate queues; it does not lock manually launched jobs.

If you previously requested a stop and now intend to resume:

```powershell
Remove-Item -LiteralPath runs/session_logs/queue.stop -ErrorAction SilentlyContinue
```

Then:

```powershell
$env:OMP_NUM_THREADS='6'
$env:MKL_NUM_THREADS='6'
$env:OPENBLAS_NUM_THREADS='6'
$env:PYTHONUTF8='1'
.venv/Scripts/python.exe -u -m scripts.train_queue
```

For attaching to an existing trainer, use `--wait-pid`, `--wait-cell` (e.g.
`none:mpdiou`) and `--wait-log` (that trainer's stdout log). The queue verifies the PID's
command line, waits for its exit, and checks completion or a clean timed pause before
launching the next process. On an error, inspect and resolve it before restarting.

Total project accounting: 60 reference + 720 screening + 300 final training = 1,080 epochs.
The final model-selection stage is deliberately not automated, as requested by the user.
