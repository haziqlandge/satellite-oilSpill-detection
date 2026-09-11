"""Swap ultralytics' CIoU box loss for MPDIoU — the second ablation axis.

PHASE-02's grid is `{none, L1..L5} x {CIoU, MPDIoU}`. The LSK axis is
architecture and lives in `yolo_seg_lsk.py`; this is the loss axis.

Ultralytics hard-codes the choice in one line of `BboxLoss.forward`
(`utils/loss.py`): `bbox_iou(..., xywh=False, CIoU=True)`. Everything else in
that method — the DFL term, the weighting, the normalisation by
`target_scores_sum` — is identical between the two variants.

**So `MPDIoUBboxLoss` overrides `forward`, delegates to `super()` for the DFL
half, and replaces only the IoU term.** Copying the DFL block instead would
duplicate ~15 lines of ultralytics internals that change between releases, and a
silent drift there would alter both arms of the ablation at once — which is
precisely the comparison the grid exists to make. The cost is one redundant CIoU
computation per step, which is negligible beside a segmentation forward pass.

`imgsz` arrives as `(height, width)`: ultralytics normalises x by `imgsz[1]` and
y by `imgsz[0]` a few lines below the call site. MPDIoU needs `(width, height)`,
so the pair is swapped exactly once, here.
"""

from __future__ import annotations

from typing import Any

import torch

from ml.models.mpdiou import mpdiou


class MPDIoUBboxLoss:  # constructed dynamically; see `_build_class`
    """Placeholder so the name is importable without ultralytics installed."""


def _build_class() -> type:
    from ultralytics.utils.loss import BboxLoss

    class _MPDIoUBboxLoss(BboxLoss):  # type: ignore[misc, valid-type]
        """`BboxLoss` with MPDIoU in place of CIoU."""

        def forward(
            self,
            pred_dist: torch.Tensor,
            pred_bboxes: torch.Tensor,
            anchor_points: torch.Tensor,
            target_bboxes: torch.Tensor,
            target_scores: torch.Tensor,
            target_scores_sum: torch.Tensor,
            fg_mask: torch.Tensor,
            imgsz: torch.Tensor,
            stride: torch.Tensor,
        ) -> tuple[torch.Tensor, torch.Tensor]:
            # The parent's DFL term is reused verbatim; its IoU term is discarded.
            _, loss_dfl = super().forward(
                pred_dist,
                pred_bboxes,
                anchor_points,
                target_bboxes,
                target_scores,
                target_scores_sum,
                fg_mask,
                imgsz,
                stride,
            )

            weight = target_scores[fg_mask].sum(-1, keepdim=True)
            # imgsz is (height, width); mpdiou wants (width, height).
            size = (int(imgsz[1]), int(imgsz[0]))
            similarity = mpdiou(
                pred_bboxes[fg_mask], target_bboxes[fg_mask], image_size=size, xywh=False
            )
            loss_iou = ((1.0 - similarity) * weight.squeeze(-1)).sum() / target_scores_sum
            return loss_iou, loss_dfl

    return _MPDIoUBboxLoss


def use_mpdiou(model: Any) -> int:
    """Replace every `BboxLoss` in `model`'s criterion with the MPDIoU variant.

    Returns how many were swapped, so a caller can assert the patch actually
    landed. **Zero is the dangerous outcome** — the run would train with CIoU
    while its results table claimed MPDIoU, quietly turning the ablation into
    six duplicated rows.

    Ultralytics builds the criterion lazily on the first loss call, so this must
    run *after* `model.init_criterion()` or after training has begun.
    """

    from ultralytics.utils.loss import BboxLoss

    replacement = _build_class()
    criterion = getattr(model, "criterion", None)
    if criterion is None:
        return 0

    swapped = 0
    for name, child in list(vars(criterion).items()):
        if isinstance(child, BboxLoss) and not isinstance(child, replacement):
            new = replacement(reg_max=child.dfl_loss.reg_max if child.dfl_loss else 1)
            new.to(next(child.parameters(), torch.zeros(1)).device)
            setattr(criterion, name, new)
            swapped += 1
    return swapped
