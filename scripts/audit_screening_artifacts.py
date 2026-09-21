import collections
import csv
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import torch
import ultralytics

from ml.models.yolo_seg_lsk import register_lsk

register_lsk()
root = Path("eval/screening")
root.mkdir(exist_ok=True)
files = list(Path("data/processed/dataset/oos/images/train").glob("*.png")) + list(
    Path("data/processed/dataset/oos/images/val").glob("*.png")
)


def audit_image(p):
    label = Path("data/processed/dataset/oos/labels") / p.parent.name / (p.stem + ".txt")
    txt = label.read_text() if label.exists() else ""
    return dict(
        name=p.name,
        split=p.parent.name,
        source=p.name.split("__")[0],
        negative=not txt.strip(),
        missing_label=not label.exists(),
        instances=len(txt.strip().splitlines()) if txt.strip() else 0,
        sha256=hashlib.file_digest(p.open("rb"), "sha256").hexdigest(),
    )


with ThreadPoolExecutor(max_workers=4) as pool:
    images = list(pool.map(audit_image, files))
groups = collections.defaultdict(list)
for r in images:
    groups[r["sha256"]].append(r["split"] + "/" + r["name"])
duplicates = [v for v in groups.values() if len(v) > 1]
counts = collections.defaultdict(
    lambda: dict(images=0, negative=0, instances=0, lookalike=0, no_oil=0, missing_label=0)
)
for r in images:
    c = counts[r["split"] + "/" + r["source"]]
    c["images"] += 1
    c["negative"] += r["negative"]
    c["instances"] += r["instances"]
    c["lookalike"] += "lookalike" in r["name"].lower()
    c["no_oil"] += "no_oil" in r["name"].lower()
    c["missing_label"] += r["missing_label"]
(root / "dataset_audit.json").write_text(
    json.dumps(
        dict(
            counts=counts,
            duplicates=duplicates,
            cross_split_duplicates=[v for v in duplicates if len({p.split("/")[0] for p in v}) > 1],
            test="Not read; test images and labels reserved.",
        ),
        indent=2,
    )
)
(root / "train_val_manifest.json").write_text(json.dumps(images, indent=2))
runs = []
for p in sorted(Path("runs/ablation").glob("*/run.json")):
    if "incomplete" in str(p):
        continue
    r = dict(cell=p.parent.name, record=json.loads(p.read_text()))
    cp = p.parent / "weights/best.pt"
    r["checkpoint_present"] = cp.exists()
    if cp.exists():
        c = torch.load(cp, map_location="cpu", weights_only=False)
        r["checkpoint_sha256"] = hashlib.file_digest(cp.open("rb"), "sha256").hexdigest()
        r["args"] = c.get("train_args", {})
        r["checkpoint_epoch"] = c.get("epoch")
        r["parameters"] = sum(t.numel() for t in c["model"].parameters())
        r["checkpoint_train_metrics"] = c.get("train_metrics")
        r["version"] = c.get("version")
    csvpath = p.parent / "results.csv"
    if csvpath.exists():
        rows = [
            {k.strip(): float(v) for k, v in row.items()} for row in csv.DictReader(csvpath.open())
        ]
        key = "metrics/mAP50-95(M)"
        ys = np.array([x[key] for x in rows[-10:]])
        slope, intercept = np.polyfit(np.arange(len(ys)), ys, 1)
        r["curve"] = dict(
            epochs=len(rows),
            best_epoch=int(max(rows, key=lambda x: x[key])["epoch"]),
            best_mask_ap=max(x[key] for x in rows),
            last_mask_ap=rows[-1][key],
            last10_mean=float(ys.mean()),
            last10_sd=float(ys.std()),
            last10_slope=float(slope),
            detrended_sd=float(np.std(ys - (slope * np.arange(len(ys)) + intercept))),
            last=rows[-1],
            ten_earlier=rows[-11],
        )
    runs.append(r)
(root / "provenance.json").write_text(
    json.dumps(
        dict(
            torch=torch.__version__,
            ultralytics=ultralytics.__version__,
            gpu=torch.cuda.get_device_name(),
            runs=runs,
        ),
        indent=2,
        default=str,
    )
)
print(json.dumps(counts, indent=2))
print("duplicate groups", len(duplicates))
print("cross split", len([v for v in duplicates if len({p.split("/")[0] for p in v}) > 1]))
