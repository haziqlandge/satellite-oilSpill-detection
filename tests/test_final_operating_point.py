"""The held-out evaluation must not pick its own operating point."""

from scripts.evaluate_final_release import operating_metrics, select_threshold
from scripts.review_screening import THRESHOLDS


def test_threshold_policy_and_empty_negative_subset():
    positive = dict(
        ng=1,
        image="test",
        source="test",
        lookalike=False,
        sizes=["large"],
        elongated=[False],
        border=[False],
        pixels=dict(gt_area=10, pred_area=10, intersection=10, dice=1.0, iou=1.0, boundary_f1=1.0),
        thresholds={
            str(t): dict(
                tp=int(t <= 0.4), fp=int(t < 0.1), fn=int(t > 0.4), matched=[0] if t <= 0.4 else []
            )
            for t in THRESHOLDS
        },
    )
    threshold, _ = select_threshold([positive])
    assert threshold == 0.4  # Equal F1 from .1 to .4: choose the higher confidence.
    negative = dict(
        positive,
        ng=0,
        lookalike=True,
        thresholds={str(t): dict(tp=0, fp=1, fn=0, matched=[]) for t in THRESHOLDS},
    )
    metrics = operating_metrics([negative], threshold)
    assert metrics["lookalike_fp_images"] == 1
    assert metrics["dice"] is None  # Missing positive evidence must not become NaN or perfect Dice.
