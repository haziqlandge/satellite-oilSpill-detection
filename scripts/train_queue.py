"""Sequential unattended training queue; add --final for the selected final comparison.

Create runs/session_logs/queue.stop to stop after the active cell/chunk.
Final mode uses runs/session_logs/final/queue.stop and runs only none/L1/L4 CIoU.
Model selection and held-out test evaluation remain manual.
"""

from __future__ import annotations

import argparse
import csv
import ctypes
import json
import math
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import psutil

from ml.ablation.run_ablation import Cell, grid

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "runs/ablation"
LOGS = ROOT / "runs/session_logs"


def completed(cell: Cell, project: Path, epochs: int = 60) -> bool:
    record = project / cell.name / "run.json"
    if not record.exists():
        return False
    payload = json.loads(record.read_text(encoding="utf-8"))
    results = payload.get("results")
    if results is None:
        return False
    score = results.get("metrics/mAP50-95(M)")
    if (
        payload.get("config", {}).get("epochs") != epochs
        or score is None
        or not math.isfinite(score)
    ):
        raise RuntimeError(f"Invalid completed screening record: {record}")
    return True


def epochs_done(cell: Cell, project: Path, epochs: int = 60) -> int:
    if completed(cell, project, epochs):
        return epochs
    path = project / cell.name / "results.csv"
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as handle:
        return max((int(float(row["epoch"])) for row in csv.DictReader(handle)), default=0)


def log(message: str) -> None:
    print(f"{datetime.now().isoformat(timespec='seconds')} {message}", flush=True)


def run_pending(project: Path, logs: Path, *, final: bool = False) -> None:
    epochs = 100 if final else 60
    cells = [Cell(p, "ciou") for p in ("none", "L1", "L4")] if final else grid()
    for cell in cells:
        while not completed(cell, project, epochs):
            if (logs / "queue.stop").exists():
                log("STOP requested: no further training will be launched.")
                return
            before = epochs_done(cell, project, epochs)
            destination = logs / f"queue-{cell.name}-{datetime.now():%Y%m%d-%H%M%S-%f}.log"
            command = [
                sys.executable,
                "-u",
                "-m",
                "ml.ablation.run_ablation",
                "--screen",
                "--only",
                f"{cell.position}:{cell.loss}",
                "--project",
                str(project),
                "--batch",
                "4",
                "--workers",
                "2",
                "--full-resources",
                "--max-minutes",
                "240",
            ]
            if final:
                command = [sys.executable, "-u", "-m", "scripts.train_final", "--only", cell.name]
            log(f"START {cell.name}: {before}/{epochs} completed; log={destination}")
            with destination.open("w", encoding="utf-8") as output:
                result = subprocess.run(
                    command,
                    cwd=ROOT,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    check=False,
                )
            if result.returncode:
                raise RuntimeError(f"{cell.name} exited {result.returncode}; inspect {destination}")
            if completed(cell, project, epochs):
                log(f"COMPLETE {cell.name}: {epochs}/{epochs}")
                break
            after = epochs_done(cell, project, epochs)
            checkpoint = project / cell.name / "weights/last.pt"
            if (
                after <= before
                or not checkpoint.exists()
                or "PAUSED:" not in destination.read_text(encoding="utf-8")
            ):
                raise RuntimeError(
                    f"{cell.name} exited without completion or a progressing timed checkpoint; inspect {destination}"
                )
            log(f"CHECKPOINT {cell.name}: {after}/{epochs}; automatically resuming")
    log(
        "FINAL TRAINING COMPLETE: 300/300 epochs; frozen test evaluation remains pending."
        if final
        else "SCREENING COMPLETE: 720/720 epochs. Final three 100-epoch runs await model selection."
    )


def wait_for_active(pid: int, cell: Cell, output_log: Path) -> None:
    try:
        process = psutil.Process(pid)
        command = process.cmdline()
        if (
            "ml.ablation.run_ablation" not in command
            or f"{cell.position}:{cell.loss}" not in command
        ):
            raise RuntimeError(f"PID {pid} is not the expected {cell.name} trainer")
        log(f"WAIT for existing {cell.name}, PID {pid}; no second trainer will start")
        process.wait()
    except psutil.NoSuchProcess:
        pass
    if not completed(cell, PROJECT):
        text = output_log.read_text(encoding="utf-8")
        if "PAUSED:" not in text or not (PROJECT / cell.name / "weights/last.pt").exists():
            raise RuntimeError(
                f"Existing {cell.name} did not finish or stop at a clean timed checkpoint; inspect {output_log}"
            )
    log(f"Existing {cell.name} exited cleanly")


def main() -> int:
    import msvcrt

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--final", action="store_true", help="run the frozen selected final comparison")
    parser.add_argument("--wait-pid", type=int)
    parser.add_argument("--wait-cell", default="none:mpdiou")
    parser.add_argument("--wait-log", type=Path)
    args = parser.parse_args()
    if args.wait_pid and not args.wait_log:
        parser.error("--wait-pid requires --wait-log")
    if args.final and args.wait_pid:
        parser.error("--final cannot attach to a screening trainer")
    project = ROOT / "runs/final" if args.final else PROJECT
    logs = LOGS / "final" if args.final else LOGS
    logs.mkdir(parents=True, exist_ok=True)
    with (LOGS / "queue.lock").open("a+b") as lock:
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            log("ERROR: another queue is already running")
            return 1
        sleep_guard = ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
        if not sleep_guard:
            log("WARNING: Windows idle-sleep prevention was unavailable")
        try:
            log(
                f"Queue active; batch=4 workers=2 full-resources; stop marker={logs / 'queue.stop'}"
            )
            if args.wait_pid:
                position, loss = args.wait_cell.split(":")
                wait_for_active(args.wait_pid, Cell(position, loss), args.wait_log)
            run_pending(project, logs, final=args.final)
            return 0
        except Exception as error:
            log(f"QUEUE FAILED: {error}")
            return 1
        finally:
            if sleep_guard:
                ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)


if __name__ == "__main__":
    raise SystemExit(main())
