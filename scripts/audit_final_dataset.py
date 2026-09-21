"""Read-only label audit and transformed-image near-duplicate screening."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity

from scripts.prepare_final_dataset import DEST, SOURCE

OUT = Path("eval/final_preflight")
OUT.mkdir(parents=True, exist_ok=True)


def read(row):
    p = Path(row["path"])
    with Image.open(p) as im:
        im.verify()
    with Image.open(p) as im:
        size = im.size
        a = np.asarray(im.convert("L").resize((128, 128)), dtype=np.uint8)
    label = SOURCE / "labels" / row["split"] / (p.stem + ".txt")
    errors = []
    instances = 0
    polys = []
    for n, line in enumerate(label.read_text().splitlines(), 1):
        v = np.array([float(x) for x in line.split()])
        if (
            len(v) < 7
            or len(v) % 2 != 1
            or not np.isfinite(v).all()
            or v[0] != 0
            or np.any(v[1:] < 0)
            or np.any(v[1:] > 1)
        ):
            errors.append(f"line {n}: class/coordinate format")
            continue
        xy = v[1:].reshape(-1, 2)
        if abs(cv2.contourArea(xy.astype(np.float32))) <= 0:
            errors.append(f"line {n}: zero area")
        polys.append(xy)
        instances += 1
    small = cv2.resize(a, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    hashes = []
    for flip in [False, True]:
        for rotation in range(4):
            transformed = np.rot90(np.fliplr(small) if flip else small, rotation).copy()
            dct = cv2.dct(transformed)[:8, :8].ravel()[1:]
            hashes.append(np.packbits(dct > np.median(dct)))
    return dict(
        row=row,
        size=size,
        gray=a,
        hashes=np.array(hashes),
        instances=instances,
        polygons=polys,
        errors=errors,
    )


def main():
    manifest = json.loads((DEST / "manifest.json").read_text())
    with ThreadPoolExecutor(max_workers=4) as pool:
        items = list(pool.map(read, manifest["original"]))
    summary = {}
    for split in ["train", "val", "test"]:
        subset = [x for x in items if x["row"]["split"] == split]
        summary[split] = dict(
            images=len(subset),
            instances=sum(x["instances"] for x in subset),
            negative_images=sum(x["instances"] == 0 for x in subset),
            errors=[
                dict(image=x["row"]["name"], errors=x["errors"]) for x in subset if x["errors"]
            ],
            sizes=sorted({tuple(x["size"]) for x in subset}),
        )
    (OUT / "label_audit.json").write_text(json.dumps(summary, indent=2))
    train = [x for x in items if x["row"]["split"] == "train"]
    val = [x for x in items if x["row"]["split"] == "val"]
    hashes = np.stack([x["hashes"] for x in train])
    popcount = np.array([int(i).bit_count() for i in range(256)])
    candidates = []
    for v in val:
        distances = popcount[np.bitwise_xor(hashes, v["hashes"][0])].sum(-1)
        for ti in np.where(distances.min(1) <= 10)[0]:
            t = train[ti]
            transform = int(distances[ti].argmin())
            flip = transform >= 4
            rotation = transform % 4
            arr = np.rot90(np.fliplr(t["gray"]) if flip else t["gray"], rotation).copy()
            target = v["gray"]
            correlation = (
                float(np.corrcoef(arr.ravel(), target.ravel())[0, 1])
                if arr.std() > 0 and target.std() > 0
                else 0.0
            )
            ssim = float(structural_similarity(arr, target, data_range=255))
            if correlation >= 0.8 or ssim >= 0.8:
                candidates.append(
                    dict(
                        train=t["row"]["name"],
                        val=v["row"]["name"],
                        hamming=int(distances[ti, transform]),
                        flip=flip,
                        rotation90=rotation,
                        ssim=ssim,
                        correlation=correlation,
                        exact=t["row"]["pixel_sha256"] == v["row"]["pixel_sha256"],
                    )
                )
    candidates.sort(key=lambda x: -x["correlation"])
    (OUT / "near_duplicates.json").write_text(
        json.dumps(
            dict(
                method="63-bit DCT pHash, Hamming <=10 under all 8 right-angle/reflection transforms; 128px SSIM and Pearson verification",
                candidates=candidates,
            ),
            indent=2,
        )
    )
    lookup = {x["row"]["name"]: x for x in items}
    comparisons = []
    for e in manifest["excluded"]:
        one = lookup[e["name"]]
        two = lookup[Path(e["duplicate_of"]).name]
        masks = []
        for x in [one, two]:
            mask = np.zeros((1024, 1024), np.uint8)
            for polygon in x["polygons"]:
                cv2.fillPoly(mask, [np.round(polygon * 1023).astype(np.int32)], 1)
            masks.append(mask.astype(bool))
        inter = int((masks[0] & masks[1]).sum())
        union = int((masks[0] | masks[1]).sum())
        comparisons.append(
            dict(
                image=e["name"],
                duplicate_of=Path(e["duplicate_of"]).name,
                instances=[one["instances"], two["instances"]],
                mask_areas=[int(m.sum()) for m in masks],
                union_iou=inter / union if union else 1.0,
                label_bytes_equal=not e["label_conflict"],
            )
        )
    (OUT / "duplicate_labels.json").write_text(json.dumps(comparisons, indent=2))
    print("Label audit:", summary)
    print("Near duplicate candidates:", len(candidates))
    print(json.dumps(candidates[:20], indent=2))
    print("Duplicate labels:", comparisons)


if __name__ == "__main__":
    main()
