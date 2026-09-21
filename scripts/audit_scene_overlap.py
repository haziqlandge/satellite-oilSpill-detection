"""Search cross-split crop/rotation overlap using local SIFT feature geometry."""

import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path("data/processed/dataset/oos/images")
OUT = Path("eval/final_preflight")


def features(path):
    cv2.setNumThreads(1)
    with Image.open(path) as im:
        im = im.convert("L")
        im.thumbnail((512, 512))
        arr = np.array(im)
    points, desc = cv2.SIFT_create(nfeatures=200).detectAndCompute(arr, None)
    return dict(
        name=path.name,
        points=np.float32([p.pt for p in points]).reshape(-1, 2),
        desc=desc,
        shape=arr.shape,
    )


def main():
    train_paths = sorted((ROOT / "train").glob("*.png"))
    val_paths = sorted((ROOT / "val").glob("*.png"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        train = list(pool.map(features, train_paths))
        val = list(pool.map(features, val_paths))
    desc = []
    owners = []
    local = []
    for i, t in enumerate(train):
        if t["desc"] is not None:
            desc.append(t["desc"])
            owners.extend([i] * len(t["desc"]))
            local.extend(range(len(t["desc"])))
    owners = np.array(owners)
    local = np.array(local)
    print("Building SIFT index:", len(owners), "descriptors", flush=True)
    matcher = cv2.FlannBasedMatcher(dict(algorithm=1, trees=4), dict(checks=64))
    matcher.add([np.concatenate(desc)])
    matcher.train()
    found = []
    for vi, v in enumerate(val):
        if v["desc"] is None:
            continue
        pairs = matcher.knnMatch(v["desc"], k=2)
        good = [m for m, n in pairs if m.distance < 0.7 * n.distance]
        counts = Counter(int(owners[m.trainIdx]) for m in good)
        for ti, count in counts.items():
            if count < 8:
                continue
            matches = [m for m in good if owners[m.trainIdx] == ti]
            vp = np.float32([v["points"][m.queryIdx] for m in matches])
            tp = np.float32([train[ti]["points"][local[m.trainIdx]] for m in matches])
            matrix, inliers = cv2.estimateAffinePartial2D(
                vp, tp, method=cv2.RANSAC, ransacReprojThreshold=3, maxIters=3000, confidence=0.999
            )
            if matrix is None:
                continue
            mask = inliers.ravel().astype(bool)
            n = int(mask.sum())
            coverage = float(np.prod(np.ptp(vp[mask], axis=0)) / np.prod(v["shape"])) if n else 0.0
            if n >= 8 and n / len(matches) >= 0.65 and coverage >= 0.005:
                found.append(
                    dict(
                        train=train[ti]["name"],
                        val=v["name"],
                        matches=len(matches),
                        inliers=n,
                        coverage=coverage,
                        affine=matrix.tolist(),
                    )
                )
        if vi % 50 == 0:
            print("Validated", vi, "of", len(val), "overlaps", len(found), flush=True)
    (OUT / "local_feature_overlaps.json").write_text(
        json.dumps(
            dict(
                method="SIFT 200 features, <=512px; global FLANN k2 ratio<.7; >=8 affine RANSAC inliers, >=65% inlier ratio, >=0.5% validation spatial coverage",
                pairs=found,
            ),
            indent=2,
        )
    )
    print(json.dumps(found, indent=2), flush=True)


if __name__ == "__main__":
    main()
