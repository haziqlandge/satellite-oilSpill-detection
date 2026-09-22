"""Version candidate lists by conservatively quarantining detected cross-split overlaps."""

import argparse
import json
from pathlib import Path

import yaml

from backend.config import REPO_ROOT


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", default="data/processed/dataset/final-v1/manifest.json")
    p.add_argument("--overlaps", default="eval/final_preflight/registered_overlaps.json")
    p.add_argument("--version", default="final-v2")
    a = p.parse_args()
    source = json.loads(Path(a.source).read_text())
    pairs = json.loads(Path(a.overlaps).read_text())["pairs"]
    removed = {}
    for r in pairs:
        removed.setdefault(r["left"], []).append(
            dict(
                reason="registered overlap"
                if r["verified"]
                else "ambiguous geometric overlap; conservative quarantine",
                other=r["right"],
                other_split=r["right_split"],
            )
        )
    # Conflicting masks on an exact duplicate: quarantine both rather than guess the correct boundary.
    removed.setdefault("8346860__Oil__00007.png", []).append(
        dict(reason="conflicting annotations for exact duplicate")
    )
    retained = [r for r in source["retained"] if r["name"] not in removed]
    excluded = source["excluded"] + [
        dict(**r, reasons=removed[r["name"]]) for r in source["retained"] if r["name"] in removed
    ]
    dest = Path("data/processed/dataset") / a.version
    if dest.exists():
        raise RuntimeError("Version already exists; refuse overwrite")
    dest.mkdir()
    for split in ["train", "val", "test"]:
        (dest / f"{split}.txt").write_text(
            # See scripts/prepare_final_dataset.py for why this is relative and
            # why the leading "./" matters.
            "".join(
                "./"
                + (REPO_ROOT / r["path"]).relative_to(dest.resolve(), walk_up=True).as_posix()
                + "\n"
                for r in retained
                if r["split"] == split
            )
        )
    (dest / "data.yaml").write_text(
        # No `path:` key; the dataset root falls back to this file's directory.
        yaml.safe_dump(
            dict(
                train="train.txt",
                val="val.txt",
                test="test.txt",
                nc=1,
                names={0: "slick"},
            )
        )
    )
    source.update(
        version=a.version,
        retained=retained,
        excluded=excluded,
        counts={s: sum(r["split"] == s for r in retained) for s in ["train", "val", "test"]},
        overlap_evidence=a.overlaps,
        status="candidate; must pass independent post-removal overlap search",
    )
    (dest / "manifest.json").write_text(json.dumps(source, indent=2))
    print(source["counts"])


if __name__ == "__main__":
    main()
