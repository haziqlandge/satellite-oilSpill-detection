"""MPDIoU — Minimum Point Distance IoU, Ma and Xu 2023.

The bounding-box regression loss P004 §2.5 substitutes for CIoU, and the second
axis of PHASE-02's ablation grid.

**Why it matters for slicks specifically.** CIoU penalises a difference in
*aspect ratio* through an angle term, and that term goes to zero whenever the
predicted and target boxes happen to share a ratio — even when they are
different sizes and in different places. Oil slicks are extreme-aspect-ratio
objects: a discharge trail can be twenty times longer than it is wide, so
predictions that are badly wrong but coincidentally similar in proportion are
exactly the failure case CIoU cannot see.

MPDIoU replaces the aspect-ratio and centre-distance terms with something both
simpler and stricter: the squared distance between the two boxes' **top-left**
corners and between their **bottom-right** corners, each normalised by the image
diagonal.

    MPDIoU = IoU - d1^2 / d^2 - d2^2 / d^2

    d1^2 = (x1_pred - x1_gt)^2 + (y1_pred - y1_gt)^2
    d2^2 = (x2_pred - x2_gt)^2 + (y2_pred - y2_gt)^2
    d^2  = image_width^2 + image_height^2

Two corners pin position, size *and* shape at once, and the loss is zero only
when the boxes actually coincide. Ma and Xu's stated benefits — faster
convergence and better localisation across scales — follow from there being no
degenerate case for the optimiser to sit in.

**Normalisation is by the image diagonal, not the enclosing box.** That is the
paper's definition and it is deliberate: an enclosing-box normaliser shrinks as
the prediction improves, which rescales the gradient mid-training. A constant
denominator keeps the penalty comparable across an epoch, and it is why
`image_size` is a required argument here rather than something inferred.
"""

from __future__ import annotations

import torch

# Guards a division by zero on a degenerate image size, and matches the epsilon
# ultralytics uses in its own IoU implementations.
EPS = 1e-7


def _corners(boxes: torch.Tensor, xywh: bool) -> tuple[torch.Tensor, ...]:
    """Split boxes into `(x1, y1, x2, y2)` columns."""

    if xywh:
        cx, cy, w, h = boxes.chunk(4, dim=-1)
        half_w, half_h = w / 2, h / 2
        return cx - half_w, cy - half_h, cx + half_w, cy + half_h
    x1, y1, x2, y2 = boxes.chunk(4, dim=-1)
    return x1, y1, x2, y2


def mpdiou(
    prediction: torch.Tensor,
    target: torch.Tensor,
    *,
    image_size: tuple[int, int],
    xywh: bool = True,
) -> torch.Tensor:
    """MPDIoU between two equally shaped box tensors, in `[-2, 1]`.

    `image_size` is `(width, height)` and sets the normalising diagonal; see the
    module docstring for why it is not the enclosing box.

    Returns the *similarity*, not the loss — 1.0 is a perfect overlap. Use
    `mpdiou_loss` for the quantity to minimise.
    """

    width, height = image_size
    if width <= 0 or height <= 0:
        raise ValueError(f"image_size must be positive, got {image_size}")

    p_x1, p_y1, p_x2, p_y2 = _corners(prediction, xywh)
    t_x1, t_y1, t_x2, t_y2 = _corners(target, xywh)

    # Intersection over union, clamped so a non-overlapping pair contributes 0
    # rather than a negative area.
    inter_w = (torch.min(p_x2, t_x2) - torch.max(p_x1, t_x1)).clamp(min=0)
    inter_h = (torch.min(p_y2, t_y2) - torch.max(p_y1, t_y1)).clamp(min=0)
    intersection = inter_w * inter_h

    p_area = (p_x2 - p_x1).clamp(min=0) * (p_y2 - p_y1).clamp(min=0)
    t_area = (t_x2 - t_x1).clamp(min=0) * (t_y2 - t_y1).clamp(min=0)
    union = p_area + t_area - intersection + EPS

    iou = intersection / union

    diagonal = float(width) ** 2 + float(height) ** 2 + EPS
    d1 = (p_x1 - t_x1) ** 2 + (p_y1 - t_y1) ** 2
    d2 = (p_x2 - t_x2) ** 2 + (p_y2 - t_y2) ** 2

    return (iou - d1 / diagonal - d2 / diagonal).squeeze(-1)


def mpdiou_loss(
    prediction: torch.Tensor,
    target: torch.Tensor,
    *,
    image_size: tuple[int, int],
    xywh: bool = True,
) -> torch.Tensor:
    """`1 - MPDIoU`, the quantity to minimise. Zero only on an exact match."""

    return 1.0 - mpdiou(prediction, target, image_size=image_size, xywh=xywh)
