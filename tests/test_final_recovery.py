from types import SimpleNamespace

import pytest
import torch
from ultralytics.models.yolo.segment import SegmentationTrainer

from scripts.recover_final_l4 import FiniteFP32Trainer, require_finite, validate_results


def test_nonfinite_gradient_stops_before_optimizer_update(monkeypatch):
    model = torch.nn.Linear(2, 1)
    model.weight.grad = torch.full_like(model.weight, float("inf"))
    trainer = SimpleNamespace(model=model, loss_items={"box": torch.tensor(1.0)})
    monkeypatch.setattr(
        SegmentationTrainer, "optimizer_step", lambda self: pytest.fail("update must not happen")
    )
    with pytest.raises(RuntimeError, match="gradient"):
        FiniteFP32Trainer.optimizer_step(trainer)


def test_finite_guard_checks_nested_optimizer_state():
    require_finite({"state": [torch.tensor([1.0]), 2.0]}, "optimizer")
    with pytest.raises(RuntimeError, match="Non-finite"):
        require_finite({"state": [torch.tensor([float("nan")])]}, "optimizer")


def test_completion_rejects_nan_and_missing_epochs(tmp_path):
    path = tmp_path / "results.csv"
    path.write_text("epoch,train/box_loss\n1,2\n2,nan\n")
    with pytest.raises(RuntimeError, match="Non-finite"):
        validate_results(tmp_path, 2)
    path.write_text("epoch,train/box_loss\n1,2\n3,1\n")
    with pytest.raises(RuntimeError, match="Missing"):
        validate_results(tmp_path, 3)
    path.write_text("epoch,train/box_loss\n1,2\n2,1\n")
    validate_results(tmp_path, 2)


def test_resume_forces_fp32_after_library_restores_amp(monkeypatch):
    trainer = object.__new__(FiniteFP32Trainer)
    trainer.args = SimpleNamespace(amp=False)
    monkeypatch.setattr(
        SegmentationTrainer, "check_resume", lambda self, overrides: setattr(self.args, "amp", True)
    )
    FiniteFP32Trainer.check_resume(trainer, {})
    assert trainer.args.amp is False
