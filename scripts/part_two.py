"""Zenodo Part II (record 8253899): verify it, freeze a holdout, fold it into final-v12.

FUTURE_WORK.md section 0, job 1. Run from the repository root, in order:

    .venv/Scripts/python.exe -m scripts.part_two verify
    .venv/Scripts/python.exe -m scripts.part_two holdout
    .venv/Scripts/python.exe -m scripts.part_two build

Part II is 56 GB extracted. The defaults are the repository's own layout, the
one `download_zenodo` and `extract_zenodo` create: archives under
`data/raw/datasets/zenodo/8253899`, the four unpacked folders under
`data/interim/datasets/zenodo/8253899`, Parts I and III beside them. The RTX
4060 Ti machine kept Part II outside the repository for disk space; there, pass
`--extracted "E:\\temp downloads"` (DATA.md section 2). Nothing here writes to
any of those locations.

Everything this writes goes under `eval/part2/` (evidence, tracked) and
`data/processed/dataset/` (derived, gitignored).
"""

from __future__ import annotations

import argparse
import json
import sys
import zlib
from pathlib import Path
from typing import Any

import numpy as np

from backend.config import REPO_ROOT

RECORD = "8253899"
EXTRACTED = REPO_ROOT / "data/interim/datasets/zenodo" / RECORD
ARCHIVES = (EXTRACTED, REPO_ROOT / "data/raw/datasets/zenodo" / RECORD)
EVIDENCE = REPO_ROOT / "eval/part2"

# archive stem -> (category as it goes into the identity, image dir or None for masks)
ARCHIVE_ROLES = {
    "01_Train_Val_Lookalike_images": ("Lookalike", "image"),
    "01_Train_Val_Lookalike_mask": ("Lookalike", "mask"),
    "01_Train_Val_No_Oil_Images": ("No_oil", "image"),
    "01_Train_Val_No_Oil_mask": ("No_oil", "mask"),
}
EXPECTED_PER_ARCHIVE = 685  # eval/phase2-closure/STATUS.md, from the record description


def _crc32(path: Path) -> int:
    crc = 0
    with path.open("rb") as handle:
        while chunk := handle.read(8 << 20):
            crc = zlib.crc32(chunk, crc)
    return crc


def _find_archive(key: str, search: tuple[Path, ...]) -> Path | None:
    return next((d / key for d in search if (d / key).is_file()), None)


def verify(extracted: Path, search: tuple[Path, ...]) -> int:
    """Archives against Zenodo's MD5, extracted files against the archives' CRC32."""

    import py7zr

    from backend.ingest.datasets.zenodo import fetch_record
    from backend.ingest.datasets.zenodo import verify as md5_matches

    entries = {entry.key: entry for entry in fetch_record(RECORD)}
    report: dict[str, dict] = {}
    failures = 0
    for key, entry in sorted(entries.items()):
        stem = Path(key).stem
        archive = _find_archive(key, search)
        row: dict = {"zenodo_size": entry.size, "zenodo_checksum": entry.checksum}
        report[key] = row
        if archive is None:
            row["archive"] = "MISSING"
            failures += 1
            continue
        print(f"{key}: md5 over {archive.stat().st_size / 1e9:.1f} GB ...", flush=True)
        row["archive_md5_matches"] = md5_matches(archive, entry)
        failures += not row["archive_md5_matches"]

        with py7zr.SevenZipFile(archive) as packed:
            listed = {i.filename: i for i in packed.list() if not i.is_directory}
        root = extracted / stem
        mismatched, missing = [], []
        for number, (name, info) in enumerate(sorted(listed.items()), 1):
            path = root / name
            if not path.is_file():
                missing.append(name)
            elif path.stat().st_size != info.uncompressed or _crc32(path) != info.crc32:
                mismatched.append(name)
            if number % 100 == 0:
                print(f"    crc {number}/{len(listed)}", flush=True)
        on_disk = sum(1 for p in root.rglob("*") if p.is_file())
        row.update(
            listed=len(listed),
            on_disk=on_disk,
            missing=missing,
            crc_mismatched=mismatched,
            extra_on_disk=on_disk - (len(listed) - len(missing)),
        )
        bad = missing or mismatched or on_disk != len(listed) or len(listed) != EXPECTED_PER_ARCHIVE
        failures += bool(bad)

        if ARCHIVE_ROLES[stem][1] == "mask":
            import rasterio

            nonempty = []
            for path in sorted(root.rglob("*.tif")):
                with rasterio.open(path) as src:
                    if np.any(src.read() > 0):
                        nonempty.append(path.name)
            row["masks_with_foreground"] = nonempty
            failures += bool(nonempty)

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "verification.json").write_text(
        json.dumps({"record": RECORD, "failures": failures, "files": report}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2)[:4000])
    print(
        f"\n{'VERIFIED' if not failures else f'{failures} FAILURE(S)'}: {EVIDENCE / 'verification.json'}"
    )
    return 1 if failures else 0


# --- the holdout -------------------------------------------------------------
#
# Part II carries no acquisition time, but every tile is georeferenced, so
# "split by scene" is done by place, which is stricter: tiles within MARGIN_DEG
# of each other are one family (single linkage), and a family is only eligible
# for the holdout if none of its tiles comes within MARGIN_DEG of a final-v11
# TRAIN tile. Half the eligible families are held out by CRC32, the same
# content-addressed rule `assign_split` uses. Fixed before any model saw a tile.
MARGIN_DEG = 0.1  # ~11 km; a 2048 px Part II tile spans ~0.18 deg
HOLDOUT_SHARE = 0.5  # of eligible families
V11 = REPO_ROOT / "data/processed/dataset/final-v11"
CORPUS = REPO_ROOT / "data/interim/datasets/zenodo"
GEOREFERENCED = {  # identity prefix -> directory under the corpus root
    "8346860__Oil": "8346860/01_Train_Val_Oil_Spill_images/Oil",
    "13761290__Oil": "13761290/02_Test_images_and_ground_truth/Images/Oil",
    "13761290__Lookalike": "13761290/02_Test_images_and_ground_truth/Images/Lookalike",
    "13761290__No_oil": "13761290/02_Test_images_and_ground_truth/Images/No oil",
}
PART_TWO_IMAGES = {
    "Lookalike": "01_Train_Val_Lookalike_images/Lookalike",
    "No_oil": "01_Train_Val_No_Oil_Images/No_oil",
}


def part_two_images(extracted: Path) -> dict[str, Path]:
    return {
        f"{RECORD}__{category}__{tif.stem}": tif
        for category, folder in PART_TWO_IMAGES.items()
        for tif in sorted((extracted / folder).glob("*.tif"))
    }


def _bounds(paths: dict[str, Path]) -> dict[str, list[float]]:
    import rasterio

    out = {}
    for identity, path in paths.items():
        with rasterio.open(path) as src:
            if src.crs is None or src.crs.to_epsg() != 4326:
                raise RuntimeError(f"{path} is not EPSG:4326")
            out[identity] = [round(v, 6) for v in src.bounds]
    return out


def near(a: list[float], b: list[float], margin: float = MARGIN_DEG) -> bool:
    """Boxes closer than `margin` degrees on both axes (overlapping counts)."""
    return (
        a[0] - margin < b[2]
        and b[0] - margin < a[2]
        and a[1] - margin < b[3]
        and b[1] - margin < a[3]
    )


def families(boxes: dict[str, list[float]]) -> list[list[str]]:
    """Single-linkage groups of tiles closer than MARGIN_DEG."""
    keys = sorted(boxes)
    parent = list(range(len(keys)))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            if near(boxes[keys[i]], boxes[keys[j]]):
                parent[root(i)] = root(j)
    groups: dict[int, list[str]] = {}
    for i, key in enumerate(keys):
        groups.setdefault(root(i), []).append(key)
    return sorted(groups.values(), key=lambda group: group[0])


def held_out(family: list[str]) -> bool:
    return zlib.crc32(min(family).encode()) % 10_000 < HOLDOUT_SHARE * 10_000


def holdout(extracted: Path, corpus: Path) -> int:
    destination = EVIDENCE / "holdout.json"
    if destination.exists():
        print(f"{destination} is frozen; refusing to recut it", file=sys.stderr)
        return 1
    manifest = json.loads((V11 / "manifest.json").read_text(encoding="utf-8"))
    split_of = {Path(row["name"]).stem: row["split"] for row in manifest["retained"]}
    corpus_tiles = {
        f"{prefix}__{tif.stem}": tif
        for prefix, folder in GEOREFERENCED.items()
        for tif in sorted((corpus / folder).glob("*.tif"))
    }
    print(f"reading {len(corpus_tiles)} corpus footprints ...", flush=True)
    corpus_boxes = _bounds(corpus_tiles)
    parts = part_two_images(extracted)
    print(f"reading {len(parts)} Part II footprints ...", flush=True)
    boxes = _bounds(parts)

    train_boxes = [b for k, b in corpus_boxes.items() if split_of.get(k) == "train"]
    rows: list[dict[str, Any]] = []
    for number, family in enumerate(families(boxes)):
        eligible = not any(near(boxes[k], t) for k in family for t in train_boxes)
        for identity in family:
            rows.append(
                dict(
                    identity=identity,
                    category=identity.split("__")[1],
                    family=number,
                    eligible=eligible,
                    holdout=eligible and held_out(family),
                    bounds=boxes[identity],
                )
            )
    chosen = [r for r in rows if r["holdout"]]
    record = dict(
        record=RECORD,
        rule=(
            f"Part II tiles grouped by single linkage where footprints come within {MARGIN_DEG} deg; "
            f"a family is eligible when no member is within {MARGIN_DEG} deg of any final-v11 train "
            "tile footprint (Part I/III; Refined SOS is not georeferenced and is checked by SIFT at "
            f"build); an eligible family is held out when crc32(first identity) % 10000 < "
            f"{int(HOLDOUT_SHARE * 10_000)}. Frozen before any training on Part II; never tuned on."
        ),
        counts=dict(
            tiles=len(rows),
            families=len({r["family"] for r in rows}),
            eligible_tiles=sum(r["eligible"] for r in rows),
            holdout_tiles=len(chosen),
            holdout_families=len({r["family"] for r in chosen}),
            holdout_by_category={
                c: sum(r["category"] == c for r in chosen) for c in PART_TWO_IMAGES
            },
        ),
        tiles=rows,
        corpus_footprints=corpus_boxes,
    )
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(record, indent=1), encoding="utf-8")
    print(json.dumps(record["counts"], indent=2))
    return 0


# --- final-v12 ---------------------------------------------------------------
#
# final-v11 unchanged (val and test byte-identical, so the 13/23 look-alike figure
# stays comparable and the consumed test is never touched), plus the Part II tiles
# that are not held out and survive quarantine. Quarantine is the same idea as
# final-v2..v11, applied to the new tiles only: a train candidate goes if it is
# near a v11 val/test footprint, an exact pixel duplicate of anything, or a SIFT
# registered overlap with val, test or the holdout (the method of
# `scripts/verify_split_overlap.py`, which is the only test Refined SOS -- not
# georeferenced -- can take). A holdout tile goes if it overlaps anything trained on.
PART_TWO_TREE = REPO_ROOT / "data/processed/dataset/part2"
V12 = REPO_ROOT / "data/processed/dataset/final-v12"
IMGSZ = 1024


def _pixel_sha256(path: Path) -> str:
    """`prepare_final_dataset.inspect`'s content key: decoded RGB, so PNG encoding cannot hide a duplicate."""
    import hashlib

    from PIL import Image

    with Image.open(path) as image:
        rgb = image.convert("RGB")
        return hashlib.sha256(str(rgb.size).encode() + rgb.tobytes()).hexdigest()


def _row(png: Path, split: str) -> dict:
    from scripts.train_final import digest

    label = png.parent.parent.parent / "labels" / png.parent.name / f"{png.stem}.txt"
    return dict(
        path=png.relative_to(REPO_ROOT).as_posix(),
        split=split,
        name=png.name,
        source=RECORD,
        pixel_sha256=_pixel_sha256(png),
        image_sha256=digest(png),
        label_sha256=digest(label),
    )


def _sift_pairs(index: list[Path], query: list[Path]) -> list[dict]:
    """`verify_split_overlap.search`, with its image root pointed at the dataset directory."""
    import scripts.verify_split_overlap as overlap
    from scripts.audit_scene_overlap import features

    overlap.BASE = REPO_ROOT / "data/processed/dataset"
    base = overlap.BASE
    by_dir: dict[str, list[Path]] = {}
    for path in index:
        by_dir.setdefault(path.parent.relative_to(base).as_posix(), []).append(path)
    query_dirs = {path.parent.relative_to(base).as_posix() for path in query}
    if len(query_dirs) != 1:
        raise RuntimeError("queries must come from one directory")
    query_split = query_dirs.pop()
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=8) as pool:
        query_items = list(pool.map(features, query))
        pairs = []
        for index_split, paths in sorted(by_dir.items()):
            index_items = list(pool.map(features, paths))
            pairs.extend(overlap.search(index_items, query_items, index_split, query_split))
    return pairs


def _presize(png: Path) -> None:
    """Write the `.npy` ultralytics would cache, already at imgsz (`scripts/presize_cache.py`)."""
    from ultralytics.utils.patches import imread

    from scripts.presize_cache import resize_to_imgsz

    target = png.with_suffix(".npy")
    if not target.exists():
        decoded = imread(str(png))
        if decoded is None:
            raise RuntimeError(f"cannot decode {png}")
        np.save(target, resize_to_imgsz(decoded, IMGSZ), allow_pickle=False)


def build(extracted: Path) -> int:
    from ml.datasets.oos_dataset import materialise_image, write_label_file

    if V12.exists():
        print(f"{V12} exists; versions are never rebuilt in place", file=sys.stderr)
        return 1
    verification = json.loads((EVIDENCE / "verification.json").read_text(encoding="utf-8"))
    if verification["failures"]:
        print("Part II verification has not passed", file=sys.stderr)
        return 1
    frozen = json.loads((EVIDENCE / "holdout.json").read_text(encoding="utf-8"))
    tiles = {row["identity"]: row for row in frozen["tiles"]}
    sources = part_two_images(extracted)
    if set(sources) != set(tiles):
        raise RuntimeError("Part II on disk differs from the frozen holdout's tile list")

    # 1. materialise every tile once, as the corpus pipeline does (band 2, fixed dB window)
    pngs: dict[str, Path] = {}
    for number, (identity, tif) in enumerate(sorted(sources.items()), 1):
        split = "holdout" if tiles[identity]["holdout"] else "train"
        png = materialise_image(tif, PART_TWO_TREE / "images" / split / f"{identity}.tif")
        write_label_file(PART_TWO_TREE / "labels" / split / f"{identity}.txt", [])
        pngs[identity] = png
        if number % 100 == 0:
            print(f"  converted {number}/{len(sources)}", flush=True)

    v11 = json.loads((V11 / "manifest.json").read_text(encoding="utf-8"))
    v11_paths: dict[str, list[Path]] = {split: [] for split in ("train", "val", "test")}
    for row in v11["retained"]:
        v11_paths[row["split"]].append(REPO_ROOT / row["path"])
    split_of = {Path(row["name"]).stem: row["split"] for row in v11["retained"]}
    held_val_test = [
        box
        for key, box in frozen["corpus_footprints"].items()
        if split_of.get(key) in ("val", "test")
    ]

    reasons: dict[str, list[dict]] = {identity: [] for identity in pngs}
    # 2. footprint quarantine: train candidates near a val/test tile
    for identity in pngs:
        if not tiles[identity]["holdout"] and any(
            near(tiles[identity]["bounds"], box) for box in held_val_test
        ):
            reasons[identity].append(
                dict(reason=f"footprint within {MARGIN_DEG} deg of a final-v11 val/test tile")
            )

    # 3. exact pixel duplicates, against v11 and within Part II
    print("hashing ...", flush=True)
    rows = {
        identity: _row(png, "holdout" if tiles[identity]["holdout"] else "train")
        for identity, png in pngs.items()
    }
    seen = {row["pixel_sha256"]: row["path"] for row in v11["retained"]}
    for identity in sorted(rows):
        key = rows[identity]["pixel_sha256"]
        if key in seen:
            reasons[identity].append(dict(reason="exact pixel duplicate", duplicate_of=seen[key]))
        else:
            seen[key] = rows[identity]["path"]

    # 4. SIFT registered overlap (the final-v2..v11 method)
    train = [pngs[i] for i in sorted(pngs) if not tiles[i]["holdout"]]
    hold = [pngs[i] for i in sorted(pngs) if tiles[i]["holdout"]]
    print("SIFT: Part II train vs v11 val/test and the holdout ...", flush=True)
    pairs = _sift_pairs(v11_paths["val"] + v11_paths["test"] + hold, train)
    print("SIFT: holdout vs v11 train ...", flush=True)
    pairs += _sift_pairs(v11_paths["train"], hold)
    for pair in pairs:
        identity = Path(pair["right"]).stem  # the query side is always Part II
        reasons[identity].append(
            dict(
                reason="registered overlap"
                if pair["verified"]
                else "ambiguous geometric overlap; conservative quarantine",
                other=pair["left"],
                other_split=pair["left_split"],
            )
        )
    (EVIDENCE / "overlaps.json").write_text(
        json.dumps(
            dict(method="scripts/verify_split_overlap.py search, unchanged", pairs=pairs), indent=2
        ),
        encoding="utf-8",
    )

    kept_train = [rows[i] for i in sorted(rows) if not tiles[i]["holdout"] and not reasons[i]]
    kept_hold = [rows[i] for i in sorted(rows) if tiles[i]["holdout"] and not reasons[i]]
    excluded = [dict(**rows[i], reasons=reasons[i]) for i in sorted(rows) if reasons[i]]

    # 5. presize the training cache for the new tiles (C: cannot hold ultralytics' full-size cache)
    print(f"presizing {len(kept_train)} cache entries ...", flush=True)
    for row in kept_train:
        _presize(REPO_ROOT / row["path"])

    # 6. write the version
    import yaml

    retained = v11["retained"] + kept_train
    V12.mkdir(parents=True)

    def listing(chosen: list[dict]) -> str:
        return "".join(
            "./" + (REPO_ROOT / r["path"]).relative_to(V12, walk_up=True).as_posix() + "\n"
            for r in chosen
        )

    for split in ("train", "val", "test"):
        (V12 / f"{split}.txt").write_text(
            listing([r for r in retained if r["split"] == split]), encoding="utf-8"
        )
    (V12 / "holdout.txt").write_text(listing(kept_hold), encoding="utf-8")
    names = {0: "slick"}
    (V12 / "data.yaml").write_text(
        yaml.safe_dump(dict(train="train.txt", val="val.txt", test="test.txt", nc=1, names=names)),
        encoding="utf-8",
    )
    # Ultralytics resolves only train/val/test against the yaml, so the holdout is evaluated as `val` of its own yaml.
    (V12 / "holdout.yaml").write_text(
        yaml.safe_dump(dict(train="train.txt", val="holdout.txt", nc=1, names=names)),
        encoding="utf-8",
    )
    counts = {s: sum(r["split"] == s for r in retained) for s in ("train", "val", "test")}
    manifest = dict(
        version="final-v12",
        parent="final-v11",
        scope=v11["scope"],
        selection_policy=v11["selection_policy"],
        change=(
            "final-v11 unchanged plus Zenodo Part II (8253899) tiles in train only; val and test identical to v11; "
            "Part II holdout frozen separately (eval/part2/holdout.json) and never trained on"
        ),
        holdout_rule=frozen["rule"],
        counts=counts,
        holdout_counts={
            c: sum(r["name"].split("__")[1] == c for r in kept_hold) for c in PART_TWO_IMAGES
        },
        retained=retained,
        holdout=kept_hold,
        excluded=v11["excluded"] + excluded,
        part_two=dict(
            converted=len(rows),
            train_kept=len(kept_train),
            holdout_kept=len(kept_hold),
            excluded=len(excluded),
            band=2,
            db_window=[-35.0, 0.0],
        ),
        overlap_evidence="eval/part2/overlaps.json",
    )
    (V12 / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    summary = {k: manifest[k] for k in ("counts", "holdout_counts", "part_two")}
    (EVIDENCE / "build.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step", choices=["verify", "holdout", "build"])
    parser.add_argument("--extracted", type=Path, default=EXTRACTED)
    parser.add_argument("--archives", type=Path, nargs="*", default=list(ARCHIVES))
    parser.add_argument("--corpus", type=Path, default=CORPUS, help="extracted Parts I and III")
    arguments = parser.parse_args()
    if arguments.step == "verify":
        return verify(arguments.extracted, tuple(arguments.archives))
    if arguments.step == "holdout":
        return holdout(arguments.extracted, arguments.corpus)
    return build(arguments.extracted)


if __name__ == "__main__":
    sys.exit(main())
