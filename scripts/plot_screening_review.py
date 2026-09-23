"""Render common hard cases and exact recall-matched finalist comparisons."""

import json
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
from PIL import Image

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path("eval/screening")
samples = json.loads((ROOT / "visual_samples.json").read_text())
models = ["L1-ciou", "L4-ciou", "L5-ciou"]
fig, axes = plt.subplots(len(samples), 4, figsize=(14, 3.3 * len(samples)))
for j, (name, reason) in enumerate(samples.items()):
    original = Image.open(Path("data/processed/dataset/oos/images/val") / name).convert("RGB")
    axes[j, 0].imshow(original)
    axes[j, 0].set_title(name + "\n" + reason, fontsize=8)
    for k, m in enumerate(models):
        data = np.load(ROOT / m / (name + ".npz"))
        gt = data["gt"]
        pred = data["pred"]
        rgb = np.zeros((*gt.shape, 3), dtype=np.uint8)
        rgb[gt & pred] = [240, 240, 240]
        rgb[gt & ~pred] = [40, 160, 255]
        rgb[pred & ~gt] = [255, 70, 40]
        axes[j, k + 1].imshow(rgb)
        axes[j, k + 1].set_title(m, fontsize=10)
    for ax in axes[j]:
        ax.axis("off")
fig.suptitle(
    "Validation hard cases, conf=0.25 | white: overlap; blue: missed GT; red: extra prediction\nMasks use evaluator raster resolution; panels are selected diagnostic failures, not random performance samples.",
    fontsize=12,
)
fig.tight_layout(rect=(0, 0, 1, 0.965))
fig.savefig(ROOT / "qualitative.png", dpi=140)
plt.close(fig)
comparison: dict[str, dict[str, Any]] = {}
for m in models:
    rows = [json.loads(line) for line in (ROOT / m / "images.jsonl").read_text().splitlines()]
    ng = sum(r["ng"] for r in rows)
    matches = sorted([c for r in rows for c in r["matched_confidences"]], reverse=True)
    comparison[m] = {}
    for target in [0.30, 0.35, 0.40, 0.45]:
        threshold = matches[int(np.ceil(ng * target)) - 1]
        tp = sum(c >= threshold for c in matches)
        npred = sum(c >= threshold for r in rows for c in r["confidences"])
        neg = [r for r in rows if not r["ng"]]
        look = [r for r in neg if r["lookalike"]]
        comparison[m][str(target)] = dict(
            threshold=threshold,
            recall=tp / ng,
            precision=tp / npred,
            negative_fp_images=sum(any(c >= threshold for c in r["confidences"]) for r in neg),
            lookalike_fp_images=sum(any(c >= threshold for c in r["confidences"]) for r in look),
            lookalike_fp_instances=sum(sum(c >= threshold for c in r["confidences"]) for r in look),
        )
(ROOT / "matched_recall.json").write_text(json.dumps(comparison, indent=2))
print(json.dumps(comparison, indent=2))
