"""FP32 inference checkpoints for LSK models whose finite weights exceed FP16."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path

import torch
from ultralytics.models.yolo.segment import SegmentationTrainer
from ultralytics.utils.torch_utils import unwrap_model


def fp32_inference_model(model: torch.nn.Module) -> torch.nn.Module:
    """Return a detached FP32 release copy without saturating finite weights."""

    released = deepcopy(unwrap_model(model)).float().to(memory_format=torch.contiguous_format)
    if hasattr(released, "criterion"):
        released.criterion = None
    for value in released.state_dict().values():
        if isinstance(value, torch.Tensor) and not torch.isfinite(value).all():
            raise RuntimeError("Refusing to release a checkpoint with non-finite model state")
    for parameter in released.parameters():
        parameter.requires_grad_(False)
    return released


def save_fp32_inference_checkpoint(trainer: SegmentationTrainer, destination: Path) -> Path:
    """Write a minimal Ultralytics-compatible checkpoint from the live FP32 EMA."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "epoch": -1,
            "model": fp32_inference_model(trainer.ema.ema),
            "ema": None,
            "optimizer": None,
            "updates": None,
            "scaler": None,
            "train_args": vars(trainer.args),
            "train_metrics": {**trainer.metrics, "fitness": trainer.fitness},
            "train_results": trainer.read_results_csv(),
        },
        destination,
    )
    return destination


def save_fp32_resume_checkpoint(trainer: SegmentationTrainer, destination: Path) -> Path:
    """Write a resumable checkpoint without converting the EMA to FP16."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "epoch": trainer.epoch,
            "best_fitness": trainer.best_fitness,
            "model": None,
            "ema": fp32_inference_model(trainer.ema.ema),
            "updates": trainer.ema.updates,
            "optimizer": deepcopy(trainer.optimizer.state_dict()),
            "scaler": trainer.scaler.state_dict(),
            "train_args": vars(trainer.args),
            "train_metrics": {**trainer.metrics, "fitness": trainer.fitness},
            "train_results": trainer.read_results_csv(),
            "date": datetime.now().astimezone().isoformat(),
        },
        destination,
    )
    return destination


class FP32ReleaseTrainer(SegmentationTrainer):
    """Save resumable and release artifacts without FP16 saturation."""

    @property
    def fp32_best(self) -> Path:
        return self.wdir / "best-fp32.pt"

    def save_model(self) -> bool:
        saved = super().save_model()
        save_fp32_resume_checkpoint(self, self.last)
        if self.best_fitness == self.fitness:
            save_fp32_inference_checkpoint(self, self.fp32_best)
        return saved

    def final_eval(self) -> None:
        super().final_eval()
        if not self.fp32_best.exists():
            return
        self.validator.args.plots = self.args.plots
        self.validator.args.compile = False
        self.metrics = self.validator(model=self.fp32_best)
        self.metrics.pop("fitness", None)
        self.epoch += 1
        self.run_callbacks("on_fit_epoch_end")
        self.epoch -= 1

