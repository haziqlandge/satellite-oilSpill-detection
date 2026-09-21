import numpy as np

from scripts.review_screening import match, pixels


def test_confidence_matching_duplicates_and_threshold():
    iou = np.array([[0.9, 0.8, 0], [0, 0, 0.8]])
    confidence = np.array([0.8, 0.7, 0.2])
    assert match(iou, confidence, 0.25) == [0]
    assert match(iou, confidence, 0.1) == [0, 1]
    assert match(np.zeros((0, 3)), confidence, 0.1) == []
    assert match(np.zeros((2, 0)), np.array([]), 0.1) == []


def test_pixel_overlap_and_missed_boundary():
    gt = np.zeros((12, 12), bool)
    gt[3:7, 3:7] = True
    assert pixels(gt, gt)["dice"] == 1
    assert pixels(gt, gt)["boundary_f1"] == 1
    shifted = np.zeros_like(gt)
    shifted[3:7, 5:9] = True
    assert pixels(gt, shifted)["intersection"] == 8
    assert pixels(gt, shifted)["dice"] == 0.5
    assert pixels(gt, np.zeros_like(gt))["dice"] == 0
    assert pixels(gt, np.zeros_like(gt))["boundary_f1"] == 0
