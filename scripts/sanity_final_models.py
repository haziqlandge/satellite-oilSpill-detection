"""Numeric two-epoch smoke tests for each final configuration; never final training."""

import argparse
import json
import math
from pathlib import Path

import numpy as np
import torch
import yaml
from ultralytics import YOLO
from ultralytics.utils.loss import BboxLoss
from ultralytics.utils.torch_utils import init_seeds

from ml.ablation.run_ablation import load_pretrained_backbone
from ml.models.loss_patch import _build_class
from ml.models.yolo_seg_lsk import register_lsk, write_config
from ml.train.checkpoint import FP32ReleaseTrainer
from ml.train.train import cap_cpu, cap_gpu_memory, cap_worker_threads, run_config, train_kwargs
from scripts.train_final import DATA, HEAD, OVERRIDES, ROOT

OUT = ROOT / "runs/final_sanity"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("position", choices=["none", "L1", "L4"])
    parser.add_argument("--fp32-release", action="store_true")
    args = parser.parse_args()
    run_name = f"{args.position}-fp32-release" if args.fp32_release else args.position
    OUT.mkdir(exist_ok=True)
    ds = OUT / "dataset"
    ds.mkdir(exist_ok=True)
    manifest = json.loads((DATA / "manifest.json").read_text())
    chosen = {}
    for split, each in [("train", 8), ("val", 4)]:
        rows = []
        for source in ["13761290", "15298010", "8346860"]:
            for negative in [False, True]:
                pool = []
                for r in manifest["retained"]:
                    if r["split"] != split or r["source"] != source:
                        continue
                    # Manifest rows are repo-relative; see
                    # scripts/repath_artifacts.py.
                    p = ROOT / r["path"]
                    label = p.parent.parent.parent / "labels" / split / (p.stem + ".txt")
                    if (not label.read_text().strip()) == negative:
                        pool.append(r)
                rows.extend(sorted(pool, key=lambda r: r["name"])[:each])
        chosen[split] = rows
        (ds / f"{split}.txt").write_text(
            "".join(
                "./" + (ROOT / r["path"]).relative_to(ds.resolve(), walk_up=True).as_posix() + "\n"
                for r in rows
            )
        )
    (ds / "data.yaml").write_text(
        # No `path:`; the dataset root falls back to this file's own directory.
        yaml.safe_dump(dict(train="train.txt", val="val.txt", nc=1, names={0: "slick"}))
    )
    register_lsk()
    cap_gpu_memory(fraction=1.0)
    cap_cpu(workers=2, fraction=1.0, prefer_efficiency=False)
    cap_worker_threads()
    init_seeds(0, deterministic=True)
    config = write_config(args.position, OUT / f"configs/{args.position}.yaml")
    model = YOLO(str(config), task="segment")
    transferred, _ = load_pretrained_backbone(model, str(ROOT / "yolo11n-seg.pt"), args.position)
    assert transferred == 378
    model.model.model[-1].load_state_dict(torch.load(HEAD, map_location="cpu", weights_only=True))
    losses = []

    def start(trainer):
        trainer.model.criterion = trainer.model.init_criterion()
        assert type(trainer.model.criterion.bbox_loss) is BboxLoss
        assert not isinstance(trainer.model.criterion.bbox_loss, _build_class())

    def check_batch(trainer):
        values = {k: float(v.detach()) for k, v in trainer.loss_items.items()}
        if not all(math.isfinite(v) and 0 <= v < 10000 for v in values.values()):
            raise RuntimeError(f"Invalid losses {values}")
        for parameter in trainer.model.parameters():
            if not torch.isfinite(parameter).all():
                raise RuntimeError("Non-finite weights")
        losses.append(values)

    model.add_callback("on_train_start", start)
    model.add_callback("on_train_batch_end", check_batch)
    rc = run_config(
        ds / "data.yaml", name=run_name, model=str(config), epochs=2, batch=4, workers=2
    )
    options = train_kwargs(
        rc, project=OUT, seed=0, overrides={**OVERRIDES, "save_period": 1, "plots": False}
    )
    if args.fp32_release:
        options["trainer"] = FP32ReleaseTrainer
    result = model.train(**options)
    assert losses
    early = np.median([sum(r.values()) for r in losses[:5]])
    late = np.median([sum(r.values()) for r in losses[-5:]])
    assert late <= 10 * max(early, 1), f"Loss explosion: {early} -> {late}"
    checkpoint_name = "best-fp32.pt" if args.fp32_release else "best.pt"
    loaded = YOLO(str(OUT / run_name / "weights" / checkpoint_name), task="segment")
    predictions = loaded.predict(
        [r["path"] for r in chosen["val"]], imgsz=1024, batch=4, device=0, conf=0.01, verbose=False
    )
    for pred in predictions:
        xy = pred.boxes.xyxy
        assert torch.isfinite(xy).all() and torch.isfinite(pred.boxes.conf).all()
        assert (xy[:, 2:] >= xy[:, :2]).all() and (xy >= 0).all()
        assert (xy[:, [0, 2]] <= pred.orig_shape[1] + 1e-3).all() and (
            xy[:, [1, 3]] <= pred.orig_shape[0] + 1e-3
        ).all()
        if pred.masks is not None:
            assert torch.isfinite(pred.masks.data).all()
    epoch_checkpoint = OUT / run_name / "weights/epoch0.pt"
    saved = torch.load(epoch_checkpoint, map_location="cpu", weights_only=False)
    assert saved["epoch"] == 0 and saved.get("optimizer") is not None
    report = dict(
        position=args.position,
        epochs=2,
        train_images=len(chosen["train"]),
        val_images=len(chosen["val"]),
        losses=losses,
        initial_loss_median=float(early),
        final_loss_median=float(late),
        metrics=result.results_dict,
        finite=True,
        valid_boxes=True,
        prediction_images=len(predictions),
        checkpoint_reload=True,
        resumable_epoch0=True,
        loss="ciou",
        fp32_release=args.fp32_release,
    )
    (OUT / run_name / "sanity.json").write_text(json.dumps(report, indent=2))
    print("SANITY PASSED", run_name, flush=True)


if __name__ == "__main__":
    main()
