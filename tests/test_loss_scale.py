"""Regression checks at the real grid-coordinate BboxLoss boundary."""

import pytest
import torch
from ultralytics.utils.loss import BboxLoss

from ml.models.loss_patch import _build_class
from ml.models.mpdiou import mpdiou


@pytest.mark.parametrize("stride_values", [[8.0, 16.0, 32.0], [32.0, 8.0, 16.0]])
def test_mpdiou_patch_converts_each_foreground_anchor_to_pixels(stride_values):
    stride = torch.tensor(stride_values).view(3, 1)
    # Same physical boxes at each feature level, two images and nontrivial foreground selection.
    physical_pred = torch.tensor(
        [[[40.0, 20.0, 140.0, 80.0]] * 3, [[240.0, 90.0, 350.0, 160.0]] * 3]
    )
    physical_target = physical_pred + torch.tensor([12.0, 4.0, 24.0, 8.0])
    pred = (physical_pred / stride).requires_grad_()
    target = physical_target / stride
    scores = torch.tensor([[[1.0], [0.5], [0.7]], [[0.2], [0.8], [1.0]]])
    fg = torch.tensor([[True, False, True], [False, True, True]])
    kwargs = dict(
        pred_dist=torch.zeros(2, 3, 64),
        pred_bboxes=pred,
        anchor_points=torch.ones(3, 2),
        target_bboxes=target,
        target_scores=scores,
        target_scores_sum=scores[fg].sum(),
        fg_mask=fg,
        imgsz=torch.tensor([512.0, 1024.0]),
        stride=stride,
    )
    actual, dfl = _build_class()(16)(**kwargs)
    expected = (
        (1 - mpdiou(physical_pred[fg], physical_target[fg], image_size=(1024, 512), xywh=False))
        * scores[fg].squeeze(-1)
    ).sum() / scores[fg].sum()
    assert actual.item() == pytest.approx(expected.item(), abs=1e-7)
    assert torch.equal(dfl, BboxLoss(16)(**kwargs)[1])
    actual.backward()
    assert torch.isfinite(pred.grad).all() and pred.grad[fg].abs().sum() > 0


def test_mpdiou_installation_is_idempotent():
    from types import SimpleNamespace

    from ml.models.loss_patch import use_mpdiou

    model = SimpleNamespace(criterion=SimpleNamespace(bbox_loss=BboxLoss(16)))
    assert use_mpdiou(model) == 1
    first = model.criterion.bbox_loss
    assert use_mpdiou(model) == 0
    assert model.criterion.bbox_loss is first
