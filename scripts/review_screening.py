"""Reproducible validation-only screening audit; never evaluates the test split."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from scipy.ndimage import binary_dilation, binary_erosion
from ultralytics.models.yolo.segment.val import SegmentationValidator
from ultralytics.utils.metrics import mask_iou

from ml.models.yolo_seg_lsk import register_lsk

THRESHOLDS = [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def match(iou, conf, threshold):
    """Confidence-ordered one-to-one matches, IoU >= .5; return matched GT ids."""
    used = set()
    for p in np.argsort(-conf, kind="stable"):
        if conf[p] < threshold:
            continue
        eligible = [g for g in range(len(iou)) if g not in used and iou[g, p] >= 0.5]
        if eligible:
            used.add(max(eligible, key=lambda g: iou[g, p]))
    return sorted(used)


def pixels(gt, pred):
    inter = int((gt & pred).sum())
    ga, pa = int(gt.sum()), int(pred.sum())
    gb = gt ^ binary_erosion(gt)
    pb = pred ^ binary_erosion(pred)
    bp = float((pb & binary_dilation(gb, iterations=2)).sum()) / max(int(pb.sum()), 1)
    br = float((gb & binary_dilation(pb, iterations=2)).sum()) / max(int(gb.sum()), 1)
    return dict(
        intersection=inter,
        gt_area=ga,
        pred_area=pa,
        iou=inter / max(ga + pa - inter, 1),
        dice=2 * inter / max(ga + pa, 1),
        boundary_f1=2 * bp * br / max(bp + br, 1e-12),
    )


class AuditValidator(SegmentationValidator):
    def _process_batch(self, preds, batch):
        result = super()._process_batch(preds, batch)
        ng, npred = len(batch["cls"]), len(preds["cls"])
        gt = batch["masks"].bool()
        pm = preds["masks"].bool()
        conf = preds["conf"].cpu().numpy()
        ious = (
            mask_iou(gt.flatten(1).float(), pm.flatten(1).float()).cpu().numpy()
            if ng and npred
            else np.zeros((ng, npred))
        )
        name = Path(batch["im_file"]).name
        row = dict(
            image=name,
            source=name.split("__")[0],
            lookalike="lookalike" in name.lower(),
            no_oil="no_oil" in name.lower(),
            ng=ng,
            predictions=npred,
            thresholds={},
        )
        if ng:
            areas = gt.sum((1, 2)).cpu().numpy() / (gt.shape[1] * gt.shape[2])
            boxes = batch["bboxes"].cpu().numpy()
            wh = boxes[:, 2:] - boxes[:, :2]
            row["sizes"] = np.where(
                areas < 0.001, "small", np.where(areas < 0.01, "medium", "large")
            ).tolist()
            row["elongated"] = (wh.max(1) / np.maximum(wh.min(1), 1e-6) >= 5).tolist()
            row["border"] = (
                (
                    gt[:, 0, :].any(1)
                    | gt[:, -1, :].any(1)
                    | gt[:, :, 0].any(1)
                    | gt[:, :, -1].any(1)
                )
                .cpu()
                .tolist()
            )
        for t in getattr(self, "audit_thresholds", THRESHOLDS):
            matched = match(ious, conf, t)
            n = int((conf >= t).sum())
            row["thresholds"][str(t)] = dict(
                tp=len(matched), fp=n - len(matched), fn=ng - len(matched), matched=matched
            )
        shape = (batch["imgsz"][0] // 4, batch["imgsz"][1] // 4)
        gu = gt.any(0).cpu().numpy() if ng else np.zeros(shape, bool)
        keep = preds["conf"] >= getattr(self, "pixel_threshold", 0.25)
        pu = pm[keep].any(0).cpu().numpy() if keep.any() else np.zeros(shape, bool)
        row["pixels"] = pixels(gu, pu)
        row["empty_gt_raster_masks"] = int((gt.sum((1, 2)) == 0).sum()) if ng else 0
        row["confidences"] = conf.tolist()
        used = set()
        row["matched_confidences"] = []
        for pi in np.argsort(-conf, kind="stable"):
            eligible = [g for g in range(ng) if g not in used and ious[g, pi] >= 0.5]
            if eligible:
                used.add(max(eligible, key=lambda g: ious[g, pi]))
                row["matched_confidences"].append(float(conf[pi]))
        samples = Path("eval/screening/visual_samples.json")
        if samples.exists() and name in json.loads(samples.read_text()):
            np.savez_compressed(self.save_dir / (name + ".npz"), gt=gu, pred=pu)

        self.audit_rows.append(row)
        return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cell")
    p.add_argument("--data", default="data/processed/dataset/oos/data.yaml")
    p.add_argument("--output-root", type=Path)
    p.add_argument("--max-det", type=int, default=300)
    a = p.parse_args()
    torch.set_num_threads(6)
    register_lsk()
    out = Path("eval/screening" if a.max_det == 300 else "eval/screening_sensitivity") / a.cell
    if a.output_root is not None:
        out = a.output_root / a.cell
    out.mkdir(parents=True, exist_ok=True)
    ckpt = Path("runs/ablation") / a.cell / "weights/best.pt"
    v = AuditValidator(
        args=dict(
            model=str(ckpt),
            data=a.data,
            split="val",
            imgsz=1024,
            batch=4,
            workers=2,
            device="0",
            half=False,
            conf=0.001,
            iou=0.7,
            max_det=a.max_det,
            plots=False,
            save_json=False,
            save_txt=False,
            project="eval/screening",
            name=a.cell,
            exist_ok=True,
            verbose=False,
        ),
        save_dir=out,
    )
    v.audit_rows = []
    torch.cuda.reset_peak_memory_stats()
    v()
    (out / "images.jsonl").write_text("".join(json.dumps(r) + "\n" for r in v.audit_rows))
    summary = dict(
        metrics=v.metrics.results_dict,
        mask_ap75=float(v.metrics.seg.map75),
        box_ap75=float(v.metrics.box.map75),
        speed=v.speed,
        peak_allocated_mb=torch.cuda.max_memory_allocated() / 2**20,
        checkpoint_bytes=ckpt.stat().st_size,
        images=len(v.audit_rows),
        settings=vars(v.args),
    )
    (out / "summary.json").write_text(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
