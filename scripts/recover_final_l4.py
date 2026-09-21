"""Resume L4 from its clean epoch-11 checkpoint in FP32, preserving the failed run."""

from __future__ import annotations

import csv
import ctypes
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import torch
from ultralytics.models.yolo.segment import SegmentationTrainer

from ml.ablation.run_ablation import Cell, ChunkLimitReachedError, run_cell
from scripts.train_final import DATA, HEAD, OVERRIDES, ROOT, digest, verify_data
from scripts.train_queue import completed, epochs_done, log

PROJECT = ROOT / "runs/final_recovery_fp32"
CELL = Cell("L4", "ciou")
LOGS = ROOT / "runs/session_logs/final_recovery_fp32"


def require_finite(value, label):
    if isinstance(value, dict):
        for key, item in value.items():
            require_finite(item, f"{label}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            require_finite(item, f"{label}.{index}")
    elif isinstance(value, torch.Tensor):
        if not torch.isfinite(value).all():
            raise RuntimeError(f"Non-finite {label}; refusing update/checkpoint/completion")
    elif isinstance(value, (float, int)) and not math.isfinite(value):
        raise RuntimeError(f"Non-finite {label}; refusing update/checkpoint/completion")


class FiniteFP32Trainer(SegmentationTrainer):
    def check_resume(self, overrides):
        super().check_resume(overrides)
        # Ultralytics does not accept amp as an ordinary resume override.
        self.args.amp = False

    def optimizer_step(self):
        require_finite(self.loss_items, "batch loss")
        for name, parameter in self.model.named_parameters():
            if parameter.grad is not None:
                require_finite(parameter.grad, f"gradient.{name}")
        super().optimizer_step()

    def save_model(self):
        require_finite(self.tloss, "epoch loss")
        require_finite(self.metrics, "validation")
        require_finite(self.model.state_dict(), "model")
        require_finite(self.ema.ema.state_dict(), "EMA")
        require_finite(self.optimizer.state_dict(), "optimizer")
        return super().save_model()


def validate_results(folder, expected):
    with (folder / "results.csv").open() as handle:
        rows = [{k.strip(): v for k, v in row.items()} for row in csv.DictReader(handle)]
    if [int(row["epoch"]) for row in rows] != list(range(1, expected + 1)):
        raise RuntimeError("Missing, repeated or unexpected completed epochs")
    for row in rows:
        require_finite({k: float(v) for k, v in row.items()}, f"epoch {row['epoch']}")


def prepare():
    frozen_path = ROOT / "runs/final/frozen.json"
    frozen = json.loads(frozen_path.read_text())
    for path, sha in frozen["files"].items():
        if digest(path) != sha:
            raise RuntimeError(f"Original frozen input changed: {path}")
    verify_data()
    PROJECT.mkdir(exist_ok=True)
    record = PROJECT / "recovery.json"
    if record.exists():
        saved = json.loads(record.read_text())
        if saved["runner_sha256"] != digest(Path(__file__)):
            raise RuntimeError("Recovery runner changed after freeze")
        return
    source = ROOT / "runs/final/L4-ciou/weights/epoch10.pt"
    from ml.models.yolo_seg_lsk import register_lsk

    register_lsk()
    ckpt = torch.load(source, map_location="cpu", weights_only=False)
    assert ckpt["epoch"] == 10 and ckpt["optimizer"] is not None
    require_finite(ckpt["ema"].state_dict(), "source EMA")
    require_finite(ckpt["optimizer"], "source optimizer")
    folder = PROJECT / CELL.name
    (folder / "weights").mkdir(parents=True, exist_ok=False)
    shutil.copy2(source, folder / "weights/last.pt")
    shutil.copy2(source, folder / "weights/best.pt")
    original_csv = ROOT / "runs/final/L4-ciou/results.csv"
    with original_csv.open() as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        rows = [row for row in reader if int(row["epoch"]) <= 11]
    with (folder / "results.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    validate_results(folder, 11)
    record.write_text(
        json.dumps(
            dict(
                source_checkpoint=str(source),
                source_sha256=digest(source),
                resumed_after=11,
                original_frozen_sha256=digest(frozen_path),
                runner_sha256=digest(Path(__file__)),
                precision="FP32 from epoch 12; first 11 epochs AMP; other two finalists AMP",
                reason="FP16 forward overflow reproduced; identical FP32 forward finite",
                original_attempt="runs/final/L4-ciou preserved; non-finite epochs do not count",
                target_epochs=100,
                source_csv_sha256=digest(original_csv),
            ),
            indent=2,
        )
    )


def worker():
    prepare()
    try:
        metrics = run_cell(
            CELL,
            data=DATA / "data.yaml",
            epochs=100,
            project=PROJECT,
            batch=4,
            workers=2,
            seed=0,
            max_minutes=240,
            full_resources=True,
            overrides={**OVERRIDES, "amp": False, "trainer": FiniteFP32Trainer},
            config_dir=PROJECT / "configs",
            initial_head=HEAD,
        )
    except ChunkLimitReachedError as event:
        validate_results(PROJECT / CELL.name, epochs_done(CELL, PROJECT, 100))
        log(f"PAUSED: {event}")
        return
    require_finite(metrics, "final metrics")
    validate_results(PROJECT / CELL.name, 100)
    files = [p for p in (PROJECT / CELL.name).rglob("*") if p.is_file()]
    (PROJECT / CELL.name / "artifact_hashes.json").write_text(
        json.dumps({str(p.relative_to(PROJECT)): digest(p) for p in files}, indent=2)
    )


def main():
    if "--worker" in sys.argv:
        worker()
        return
    import msvcrt

    LOGS.mkdir(parents=True, exist_ok=True)
    with (ROOT / "runs/session_logs/queue.lock").open("a+b") as lock:
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        sleep_guard = ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
        try:
            prepare()
            while not completed(CELL, PROJECT, 100):
                if (LOGS / "queue.stop").exists():
                    log("STOP requested")
                    return
                before = epochs_done(CELL, PROJECT, 100)
                destination = LOGS / f"after-{before}.log"
                log(f"START recovery: {before}/100; log={destination}")
                with destination.open("a", encoding="utf-8") as output:
                    subprocess.run(
                        [sys.executable, "-u", "-m", "scripts.recover_final_l4", "--worker"],
                        cwd=ROOT,
                        stdout=output,
                        stderr=subprocess.STDOUT,
                        check=True,
                    )
                after = epochs_done(CELL, PROJECT, 100)
                if after <= before:
                    raise RuntimeError("Recovery made no progress")
            validate_results(PROJECT / CELL.name, 100)
            log("RECOVERY COMPLETE: all three finalists finished; model selection awaits user.")
        finally:
            if sleep_guard:
                ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)


if __name__ == "__main__":
    main()
