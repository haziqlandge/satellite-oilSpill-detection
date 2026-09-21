"""Validation comparison -> frozen operating point -> one held-out evaluation.

Run from the repository root. Completed stages are reused only after input hashes
are checked. An interrupted test stage requires investigation, never an automatic retry.
"""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import torch
import ultralytics
import yaml

from ml.models.yolo_seg_lsk import register_lsk
from scripts.review_screening import THRESHOLDS, AuditValidator
from scripts.summarize_screening import aggregate

ROOT = Path("eval/final/operational")
DATA = Path("data/processed/dataset/final-v11/data.yaml")
MODELS = {
    "L1": Path("runs/final_l1_fp32_release/L1-ciou/weights/best-fp32.pt"),
    "none": Path("runs/final/none-ciou/weights/best.pt"),
}
SETTINGS = dict(
    imgsz=1024,
    batch=4,
    workers=2,
    device="0",
    half=False,
    rect=True,
    conf=0.001,
    iou=0.7,
    max_det=1000,
    plots=False,
    save_json=False,
    save_txt=False,
    verbose=False,
)


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def dataset_digest(split):
    """Bind list, image and annotation bytes, not just an editable YAML path."""
    config = yaml.safe_load(DATA.read_text())
    listing = Path(config["path"]) / config[split]
    entries = [(str(listing), digest(listing))]
    for line in listing.read_text().splitlines():
        image = Path(line)
        if not image.is_absolute():
            image = listing.parent / image
        parts = list(image.parts)
        parts[parts.index("images")] = "labels"
        label = Path(*parts).with_suffix(".txt")
        entries.extend([(str(image), digest(image)), (str(label), digest(label))])
    return hashlib.sha256(json.dumps(entries).encode()).hexdigest()


def operating_metrics(rows, threshold, include_pixels=True):
    result = aggregate(rows, threshold)
    # aggregate's historical pixel metrics assume threshold=.25; use the actual raster threshold.
    for key in ("dice", "iou", "boundary_f1", "pixel_precision", "pixel_recall", "area_bias"):
        result.pop(key, None)
    p, r = result["precision"], result["recall"]
    result["f1"] = 2 * p * r / max(p + r, 1e-12)
    if include_pixels:
        positive = [row for row in rows if row["ng"]]
        ga = sum(row["pixels"]["gt_area"] for row in rows)
        pa = sum(row["pixels"]["pred_area"] for row in rows)
        inter = sum(row["pixels"]["intersection"] for row in rows)
        result.update(
            {
                key: float(np.mean([row["pixels"][key] for row in positive])) if positive else None
                for key in ("dice", "iou", "boundary_f1")
            }
        )
        result.update(
            pixel_precision=inter / max(pa, 1),
            pixel_recall=inter / max(ga, 1),
            area_bias=(pa - ga) / max(ga, 1),
        )
    return result


def select_threshold(rows):
    scores = {str(t): operating_metrics(rows, t, False) for t in THRESHOLDS}
    chosen = max(THRESHOLDS, key=lambda t: (scores[str(t)]["f1"], t))
    return chosen, scores


def evaluate(name, split, threshold, stage, inputs, sweep=False):
    out = ROOT / stage
    out.mkdir(parents=True, exist_ok=True)
    completed = out / "summary.json"
    expected = dict(inputs=inputs, model=name, split=split, threshold=threshold, sweep=sweep)
    if completed.exists():
        summary = json.loads(completed.read_text())
        if summary["identity"] != expected:
            raise RuntimeError(f"Completed stage has different inputs: {stage}")
        if digest(out / "images.jsonl") != summary["rows_sha256"]:
            raise RuntimeError(f"Audit rows changed: {stage}")
        return summary, [
            json.loads(line) for line in (out / "images.jsonl").read_text().splitlines()
        ]
    # Exclusive creation prevents duplicate inference, including after a crash.
    with (out / "started.json").open("x", encoding="utf-8") as stream:
        json.dump(dict(identity=expected, started_at=datetime.now(UTC).isoformat()), stream)
    validator = AuditValidator(
        args=dict(SETTINGS, model=str(MODELS[name]), data=str(DATA), split=split), save_dir=out
    )
    validator.audit_rows = []
    validator.audit_thresholds = THRESHOLDS if sweep else [threshold]
    validator.pixel_threshold = threshold
    validator()
    rows = validator.audit_rows
    expected_count = 482 if split == "val" else 627
    if len(rows) != expected_count or len({row["image"] for row in rows}) != expected_count:
        raise RuntimeError("Dataset coverage/uniqueness mismatch")
    (out / "images.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    summary = dict(
        identity=expected,
        completed_at=datetime.now(UTC).isoformat(),
        metrics=validator.metrics.results_dict,
        speed=validator.speed,
        operating=operating_metrics(rows, threshold),
        sources={
            source: operating_metrics([r for r in rows if r["source"] == source], threshold)
            for source in sorted({r["source"] for r in rows})
        },
        rows_sha256=digest(out / "images.jsonl"),
    )
    write_json(completed, summary)
    return summary, rows


def main():
    torch.set_num_threads(6)
    register_lsk()
    ROOT.mkdir(parents=True, exist_ok=True)
    inputs = dict(
        models={key: digest(value) for key, value in MODELS.items()},
        data_yaml=digest(DATA),
        val=dataset_digest("val"),
        test=dataset_digest("test"),
        settings=SETTINGS,
        torch=torch.__version__,
        ultralytics=ultralytics.__version__,
        source={
            name: digest(Path(name))
            for name in (
                "scripts/evaluate_final_release.py",
                "scripts/review_screening.py",
                "scripts/summarize_screening.py",
            )
        },
    )
    protocol = dict(
        inputs=inputs,
        policy="Maximum pooled validation mask-instance F1 at IoU .5; ties choose higher confidence.",
        candidates=THRESHOLDS,
        selected_model="L1",
        classes={"0": "slick"},
        limitations="Single-class tiles, not two-class or full-scene acceptance. No test-driven tuning.",
    )
    protocol_path = ROOT / "protocol.json"
    if protocol_path.exists() and json.loads(protocol_path.read_text()) != protocol:
        raise RuntimeError("Protocol changed; investigate before proceeding")
    write_json(protocol_path, protocol)
    l1, rows = evaluate("L1", "val", 0.25, "L1-val-sweep", inputs, sweep=True)
    baseline, baseline_rows = evaluate("none", "val", 0.25, "none-val-sweep", inputs, sweep=True)
    threshold, scores = select_threshold(rows)
    baseline_threshold, baseline_scores = select_threshold(baseline_rows)
    frozen = dict(
        protocol_sha256=digest(protocol_path),
        checkpoint_sha256=inputs["models"]["L1"],
        confidence=threshold,
        baseline_confidence=baseline_threshold,
        selection_scores=scores,
        baseline_scores=baseline_scores,
        validation_rows_sha256=l1["rows_sha256"],
        baseline_rows_sha256=baseline["rows_sha256"],
    )
    freeze_path = ROOT / "frozen.json"
    if freeze_path.exists() and json.loads(freeze_path.read_text()) != frozen:
        raise RuntimeError("Frozen operating point changed")
    write_json(freeze_path, frozen)
    print(
        f"Frozen validation-only confidence: L1={threshold}, baseline={baseline_threshold}",
        flush=True,
    )
    evaluate("L1", "val", threshold, "L1-val-operating", inputs)
    evaluate("none", "val", baseline_threshold, "none-val-operating", inputs)
    # Only the already selected release touches test; baseline comparisons remain validation-only.
    test_inputs = dict(inputs, frozen_sha256=digest(freeze_path))
    evaluate("L1", "test", threshold, "L1-test", test_inputs)
    print("All operational stages complete. Test is consumed; do not tune against it.", flush=True)


if __name__ == "__main__":
    main()
