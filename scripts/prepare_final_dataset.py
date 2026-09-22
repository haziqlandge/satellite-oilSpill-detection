"""Freeze an exact-content-deduplicated internal split without editing source data."""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/processed/dataset/oos"
DEST = ROOT / "data/processed/dataset/final-v1"


def inspect(path):
    label = SOURCE / "labels" / path.parent.name / (path.stem + ".txt")
    with Image.open(path) as im:
        rgb = im.convert("RGB")
        content = hashlib.sha256(str(rgb.size).encode() + rgb.tobytes()).hexdigest()
    return dict(
        # Repo-relative, so the manifest travels between machines. An absolute
        # path here is what stranded every earlier generation.
        path=path.resolve().relative_to(ROOT).as_posix(),
        split=path.parent.name,
        name=path.name,
        source=path.name.split("__")[0],
        pixel_sha256=content,
        image_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        label_sha256=hashlib.sha256(label.read_bytes()).hexdigest(),
    )


def deduplicate(rows):
    # Reserve test first, then validation; never move held-out images into training.
    chosen, excluded, seen = [], [], {}
    priority = {"test": 0, "val": 1, "train": 2}
    for row in sorted(rows, key=lambda r: (priority[r["split"]], r["name"])):
        key = row["pixel_sha256"]
        if key in seen:
            excluded.append(
                dict(
                    **row,
                    duplicate_of=seen[key]["path"],
                    label_conflict=row["label_sha256"] != seen[key]["label_sha256"],
                )
            )
        else:
            chosen.append(row)
            seen[key] = row
    return chosen, excluded


def main():
    if DEST.exists():
        raise RuntimeError("Frozen destination exists; do not silently rebuild it.")
    files = [
        p
        for split in ["train", "val", "test"]
        for p in sorted((SOURCE / "images" / split).glob("*.png"))
    ]
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(inspect, files))
    chosen, excluded = deduplicate(rows)
    DEST.mkdir(parents=True)
    for split in ["train", "val", "test"]:
        (DEST / f"{split}.txt").write_text(
            # Relative to this list file, and the leading "./" is load-bearing:
            # Ultralytics rewrites exactly that prefix to the list's own
            # directory and passes any other line straight through. An absolute
            # path here is what stranded every earlier generation on the machine
            # that wrote it. See scripts/repath_artifacts.py.
            "".join(
                "./" + (ROOT / r["path"]).relative_to(DEST, walk_up=True).as_posix() + "\n"
                for r in chosen
                if r["split"] == split
            ),
            encoding="utf-8",
        )
    (DEST / "data.yaml").write_text(
        # No `path:` key: it falls back to this file's own directory, which is
        # the only root correct on every machine.
        yaml.safe_dump(
            dict(
                train="train.txt",
                val="val.txt",
                test="test.txt",
                nc=1,
                names={0: "slick"},
            )
        ),
        encoding="utf-8",
    )
    manifest = dict(
        version="final-v1",
        scope="internal tile split; scene metadata unavailable, no scene independence claim",
        selection_policy="exact decoded RGB content; test > val > train, lexical tie-break; preserve all original files",
        counts={s: sum(r["split"] == s for r in chosen) for s in ["train", "val", "test"]},
        retained=chosen,
        excluded=excluded,
        original=rows,
    )
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(dict(counts=manifest["counts"], excluded=excluded), indent=2))


if __name__ == "__main__":
    main()
