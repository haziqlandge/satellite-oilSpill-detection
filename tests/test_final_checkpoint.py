from __future__ import annotations

import torch

from ml.models.lsk import LSKAttention
from ml.train.checkpoint import fp32_inference_model


def test_fp32_inference_model_preserves_large_finite_lsk_weights() -> None:
    model = LSKAttention(16)
    with torch.no_grad():
        model.project_in.weight.fill_(70_000.0)

    released = fp32_inference_model(model)

    assert released.project_in.weight.dtype is torch.float32
    assert torch.isfinite(released.project_in.weight).all()
    assert released.project_in.weight.max().item() == 70_000.0
    assert model.project_in.weight.max().item() == 70_000.0


def test_fp32_release_roundtrip_preserves_large_batchnorm_buffer(tmp_path) -> None:
    model = torch.nn.BatchNorm2d(2)
    model.running_var.fill_(18_835_282.0)
    released = fp32_inference_model(model)
    path = tmp_path / "release.pt"
    torch.save(released, path)
    restored = torch.load(path, weights_only=False)
    assert torch.equal(restored.running_var, model.running_var)
    assert torch.isfinite(restored.eval()(torch.ones(1, 2, 2, 2))).all()
