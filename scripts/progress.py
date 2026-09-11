"""Live progress for a long training or test run: ETA, done, remaining.

    .venv/Scripts/python.exe scripts/progress.py --watch
    .venv/Scripts/python.exe scripts/progress.py --run grid
    .venv/Scripts/python.exe scripts/progress.py --run tests

Two modes, because the two things worth watching report progress differently:

* **`--run`** launches the job and renders progress beside it.
* **`--watch`** attaches to whatever is already running, reading the same
  artefacts. A progress view that can only exist if it launched the job is
  useless for the run you started an hour ago, which is the one you want to
  check on.

**Rates are measured, never assumed.** `run_ablation.py --list` estimates from a
hard-coded 2.5 min/epoch, which was measured before the disk cache existed and
is now wrong by 40% -- it says 30 h for a grid that takes ~18. Everything here
reads the epoch times ultralytics has already written to `results.csv` and, when
a cell is too young to have any, falls back to the median of completed cells and
says so. An ETA whose provenance is invisible is worse than no ETA.
"""

from __future__ import annotations

import argparse
import csv
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from ml.bench.monitor import read_gpu
from ml.train.train import RAM_CEILING_GB, SCREENING_EPOCHS

ABLATION = Path("runs/ablation")
POSITIONS = ("none", "L1", "L2", "L3", "L4", "L5")
LOSSES = ("ciou", "mpdiou")

# Only used when nothing on disk can supply a rate yet -- a fresh grid with no
# completed epoch anywhere. Flagged as an assumption wherever it is displayed.
FALLBACK_MIN_PER_EPOCH = 1.5

REFRESH_S = 5.0


@dataclass
class CellProgress:
    name: str
    done: bool
    epochs_done: int
    epochs_total: int
    seconds_elapsed: float

    @property
    def running(self) -> bool:
        return not self.done and self.epochs_done > 0

    @property
    def min_per_epoch(self) -> float | None:
        if self.epochs_done < 1 or self.seconds_elapsed <= 0:
            return None
        return self.seconds_elapsed / self.epochs_done / 60


def _cell_names() -> list[str]:
    return [f"{p}-{loss}" for loss in LOSSES for p in POSITIONS]


def read_cell(name: str, project: Path, epochs_total: int) -> CellProgress:
    """Progress for one cell, from what it has actually written.

    Completion is `results` in `run.json`, matching `run_ablation.is_complete`:
    the pre-flight record is written *before* training starts, so treating the
    file's existence as completion would report every interrupted cell as done.
    """
    import json

    directory = project / name
    done = False
    record = directory / "run.json"
    if record.exists():
        try:
            done = "results" in json.loads(record.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            done = False

    epochs_done = 0
    elapsed = 0.0
    results = directory / "results.csv"
    if results.exists():
        try:
            with results.open(encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            epochs_done = len(rows)
            if rows:
                elapsed = float(rows[-1].get("time", 0.0) or 0.0)
        except (OSError, ValueError):
            pass

    return CellProgress(name, done, epochs_done, epochs_total, elapsed)


def measured_rate(cells: list[CellProgress]) -> tuple[float, str]:
    """`(minutes_per_epoch, provenance)` from finished work, never a constant."""
    rates = [c.min_per_epoch for c in cells if c.done and c.min_per_epoch]
    if rates:
        ordered = sorted(r for r in rates if r)
        return ordered[len(ordered) // 2], f"median of {len(ordered)} finished cell(s)"
    live = [c.min_per_epoch for c in cells if c.running and c.min_per_epoch]
    if live:
        return live[0], "the cell now running"
    return FALLBACK_MIN_PER_EPOCH, "ASSUMED - nothing measured yet"


def bar(fraction: float, width: int = 28) -> str:
    fraction = max(0.0, min(1.0, fraction))
    filled = round(fraction * width)
    return "#" * filled + "-" * (width - filled)


def render_grid(project: Path, epochs_total: int) -> str:
    cells = [read_cell(name, project, epochs_total) for name in _cell_names()]
    rate, provenance = measured_rate(cells)

    done = sum(1 for c in cells if c.done)
    epochs_finished = sum(c.epochs_total if c.done else c.epochs_done for c in cells)
    epochs_all = epochs_total * len(cells)
    remaining_epochs = max(0, epochs_all - epochs_finished)
    eta_min = remaining_epochs * rate

    lines: list[str] = []
    lines.append(f"  ablation grid   {done}/{len(cells)} cells    {epochs_finished}/{epochs_all} epochs")
    lines.append(f"  [{bar(epochs_finished / epochs_all if epochs_all else 0)}] "
                 f"{100 * epochs_finished / epochs_all if epochs_all else 0:5.1f}%")
    lines.append("")
    for cell in cells:
        if cell.done:
            mark, detail = "done", f"{cell.epochs_total} ep"
            if cell.min_per_epoch:
                detail += f" @ {cell.min_per_epoch:.2f} min/ep"
        elif cell.running:
            mark = "RUN "
            detail = f"{cell.epochs_done}/{cell.epochs_total} ep  [{bar(cell.epochs_done / cell.epochs_total, 16)}]"
            left = (cell.epochs_total - cell.epochs_done) * rate
            detail += f"  {left:.0f} min left"
        else:
            mark, detail = "    ", "pending"
        lines.append(f"    {mark} {cell.name:<12} {detail}")

    lines.append("")
    lines.append(f"  rate      {rate:.2f} min/epoch  ({provenance})")
    lines.append(f"  remaining {remaining_epochs} epochs  ~{eta_min / 60:.1f} h")
    if remaining_epochs:
        finish = datetime.now() + timedelta(minutes=eta_min)
        lines.append(f"  finishes  ~{finish:%a %H:%M} ({finish:%d %b})")
    return "\n".join(lines)


def render_resources() -> str:
    import psutil

    memory = psutil.virtual_memory()
    used_gb = (memory.total - memory.available) / 1024**3
    gpu = read_gpu()
    cpu = psutil.cpu_percent(interval=None)

    flag = "  OVER" if used_gb > RAM_CEILING_GB else ""
    line = (
        f"  CPU {cpu:5.1f}% (cap 80)   "
        f"RAM {used_gb:5.2f} GB / {RAM_CEILING_GB:.0f} GB{flag or '   '}"
    )
    if gpu:
        util, used_mb, total_mb, temp = gpu
        line += f"   GPU {util:5.1f}%  VRAM {used_mb / 1024:.1f}/{total_mb / 1024:.1f} GB  {temp:.0f}C"
    else:
        line += "   GPU  n/a"
    return line


def watch(project: Path, epochs_total: int, once: bool = False) -> int:
    """Redraw until interrupted. Ctrl-C stops watching, never the job."""
    import psutil

    psutil.cpu_percent(interval=None)
    try:
        while True:
            width = shutil.get_terminal_size((100, 30)).columns
            frame = [
                "=" * min(width - 1, 78),
                f"  PHASE-02 progress   {datetime.now():%H:%M:%S}",
                "=" * min(width - 1, 78),
                render_grid(project, epochs_total),
                "",
                render_resources(),
                "",
                "  Ctrl-C stops watching. It does not stop the run.",
            ]
            print("\033[2J\033[H" + "\n".join(frame), flush=True)
            if once:
                return 0
            time.sleep(REFRESH_S)
    except KeyboardInterrupt:
        print("\nstopped watching; the run continues.")
        return 0


def run_with_progress(command: list[str], project: Path, epochs_total: int) -> int:
    """Launch `command`, then watch. The job owns the console; this owns the view.

    The child is started in its own process group so that Ctrl-C in the watcher
    does not also kill it -- stopping the view and stopping an 18-hour grid must
    not be the same keystroke.
    """
    creation = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    log = Path("runs") / "progress-last.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    print(f"launching: {' '.join(command)}\n  output -> {log}")

    with log.open("w", encoding="utf-8") as handle:
        child = subprocess.Popen(
            command, stdout=handle, stderr=subprocess.STDOUT, creationflags=creation
        )
        try:
            import psutil

            psutil.cpu_percent(interval=None)
            while child.poll() is None:
                width = shutil.get_terminal_size((100, 30)).columns
                frame = [
                    "=" * min(width - 1, 78),
                    f"  PHASE-02 progress   {datetime.now():%H:%M:%S}   pid {child.pid}",
                    "=" * min(width - 1, 78),
                    render_grid(project, epochs_total),
                    "",
                    render_resources(),
                    "",
                    f"  full output: {log}",
                    "  Ctrl-C stops watching. It does not stop the run.",
                ]
                print("\033[2J\033[H" + "\n".join(frame), flush=True)
                time.sleep(REFRESH_S)
        except KeyboardInterrupt:
            print(f"\nstopped watching. The run continues as pid {child.pid}.")
            print("  re-attach: .venv/Scripts/python.exe scripts/progress.py --watch")
            return 0

    print(render_grid(project, epochs_total))
    return child.returncode


def run_tests() -> int:
    """Run the suite, showing pytest's own counts rather than inventing new ones."""
    command = [sys.executable, "-m", "pytest", "-q", "--tb=short"]
    print(f"running: {' '.join(command)}\n")
    started = time.monotonic()
    completed = subprocess.run(command)
    print(f"\ntests finished in {time.monotonic() - started:.1f} s (exit {completed.returncode})")
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=ABLATION)
    parser.add_argument("--epochs", type=int, default=SCREENING_EPOCHS)
    parser.add_argument("--watch", action="store_true", help="attach to a run already going")
    parser.add_argument("--once", action="store_true", help="print one frame and exit")
    parser.add_argument("--run", choices=("grid", "tests"), default=None)
    parser.add_argument("--workers", type=int, default=None)
    arguments = parser.parse_args()

    if arguments.run == "tests":
        return run_tests()

    if arguments.run == "grid":
        command = [sys.executable, "-m", "ml.ablation.run_ablation", "--screen"]
        if arguments.workers is not None:
            command += ["--workers", str(arguments.workers)]
        return run_with_progress(command, arguments.project, arguments.epochs)

    return watch(arguments.project, arguments.epochs, once=arguments.once or not arguments.watch)


if __name__ == "__main__":
    raise SystemExit(main())
