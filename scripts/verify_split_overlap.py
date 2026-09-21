"""Verify crop/reflection overlap across all splits with pixel registration."""

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from scripts.audit_scene_overlap import features

BASE = Path("data/processed/dataset/oos/images")
OUT = Path("eval/final_preflight")


@lru_cache(maxsize=128)
def gray(path, flip=False):
    with Image.open(path) as im:
        im = im.convert("L")
        im.thumbnail((512, 512))
        a = np.array(im)
    return np.fliplr(a).copy() if flip else a


def search(index_items, query_items, index_split, query_split):
    desc = []
    owners = []
    local = []
    for i, t in enumerate(index_items):
        if t["desc"] is not None:
            desc.append(t["desc"])
            owners.extend([i] * len(t["desc"]))
            local.extend(range(len(t["desc"])))
    owners = np.array(owners)
    local = np.array(local)
    matcher = cv2.FlannBasedMatcher(dict(algorithm=1, trees=4), dict(checks=96))
    matcher.add([np.concatenate(desc)])
    matcher.train()
    found = []
    for qi, v in enumerate(query_items):
        for flip in [False, True]:
            image = gray(str(BASE / query_split / v["name"]), flip)
            if flip:
                points, vd = cv2.SIFT_create(nfeatures=200).detectAndCompute(image, None)
                vpall = np.float32([p.pt for p in points]).reshape(-1, 2)
            else:
                vd = v["desc"]
                vpall = v["points"]
            if vd is None:
                continue
            matches = []
            for neighbors in matcher.knnMatch(vd, k=8):
                # Retain multiple matching family members, not only a single nearest tile.
                matches.extend(
                    m for m in neighbors[:-1] if m.distance < 0.7 * neighbors[-1].distance
                )
            counts = Counter(int(owners[m.trainIdx]) for m in matches)
            for ti, count in counts.items():
                if count < 8:
                    continue
                chosen = [m for m in matches if owners[m.trainIdx] == ti]
                unique = {}
                for m in sorted(chosen, key=lambda m: m.distance):
                    unique.setdefault(m.queryIdx, m)
                chosen = list(unique.values())
                if len(chosen) < 8:
                    continue
                vp = np.float32([vpall[m.queryIdx] for m in chosen])
                tp = np.float32([index_items[ti]["points"][local[m.trainIdx]] for m in chosen])
                matrix, inliers = cv2.estimateAffinePartial2D(
                    vp,
                    tp,
                    method=cv2.RANSAC,
                    ransacReprojThreshold=3,
                    maxIters=3000,
                    confidence=0.999,
                )
                if matrix is None:
                    continue
                mask = inliers.ravel().astype(bool)
                n = int(mask.sum())
                coverage = float(np.prod(np.ptp(vp[mask], axis=0)) / image.size) if n else 0.0
                if n < 8 or n / len(chosen) < 0.65 or coverage < 0.005:
                    continue
                target = gray(str(BASE / index_split / index_items[ti]["name"]))
                warped = cv2.warpAffine(image, matrix, (target.shape[1], target.shape[0]))
                valid = cv2.warpAffine(
                    np.ones_like(image),
                    matrix,
                    (target.shape[1], target.shape[0]),
                    flags=cv2.INTER_NEAREST,
                ).astype(bool)
                valid &= (warped > 3) & (warped < 250) & (target > 3) & (target < 250)
                # Remove interpolation edges before measuring SAR texture agreement.
                valid = cv2.erode(valid.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
                if valid.sum() < 1000:
                    continue
                corr = float(np.corrcoef(warped[valid], target[valid])[0, 1])
                found.append(
                    dict(
                        left_split=index_split,
                        left=index_items[ti]["name"],
                        right_split=query_split,
                        right=v["name"],
                        flip=flip,
                        inliers=n,
                        matches=len(chosen),
                        coverage=coverage,
                        registered_correlation=corr,
                        verified=corr >= 0.8,
                        affine=matrix.tolist(),
                    )
                )
        if qi % 100 == 0:
            print(
                index_split,
                query_split,
                qi,
                "/",
                len(query_items),
                "candidates",
                len(found),
                flush=True,
            )
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", default="registered_overlaps.json")
    args = parser.parse_args()
    retained = None
    if args.manifest:
        retained = {r["name"] for r in json.loads(args.manifest.read_text())["retained"]}
    items = {}
    cache = OUT / "feature_cache"
    cache.mkdir(exist_ok=True)
    for split in ["train", "val", "test"]:
        cached = cache / f"{split}.npz"
        if cached.exists():
            with np.load(cached, allow_pickle=False) as pack:
                offsets = pack["offsets"]
                names = pack["names"]
                points = pack["points"]
                descriptors = pack["descriptors"]
                shapes = pack["shapes"]
            all_items = [dict(name=str(name), points=points[offsets[i]:offsets[i+1]],
                desc=descriptors[offsets[i]:offsets[i+1]] if offsets[i+1]>offsets[i] else None,
                shape=tuple(shapes[i])) for i, name in enumerate(names)]
        else:
            with ThreadPoolExecutor(max_workers=4) as pool:
                all_items = list(pool.map(features, sorted((BASE / split).glob("*.png"))))
            counts = [len(x["points"]) for x in all_items]
            np.savez_compressed(
                cached,
                names=np.array([x["name"] for x in all_items]),
                offsets=np.concatenate(([0], np.cumsum(counts))),
                shapes=np.array([x["shape"] for x in all_items]),
                points=np.concatenate([x["points"] for x in all_items]),
                descriptors=np.concatenate([x["desc"] for x in all_items if x["desc"] is not None]),
            )
        items[split] = [x for x in all_items if retained is None or x["name"] in retained]
        print("FEATURES", split, len(items[split]), flush=True)
    pairs = []
    for a, b in [("train", "val"), ("train", "test"), ("val", "test")]:
        pairs.extend(search(items[a], items[b], a, b))
        (OUT / args.output).write_text(
            json.dumps(
                dict(
                    method="SIFT 200 features <=512px, reflection query, global k8 FLANN 96 checks ratio .7, >=8 affine inliers >=65% and >=0.5% coverage; verified if registered non-background Pearson >=.8 over >=1000 pixels",
                    manifest=str(args.manifest),
                    pairs=pairs,
                ),
                indent=2,
            )
        )
    print("TOTAL", len(pairs), "verified", sum(p["verified"] for p in pairs), flush=True)


if __name__ == "__main__":
    main()
