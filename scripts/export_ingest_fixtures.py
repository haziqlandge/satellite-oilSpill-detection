"""Export real labelled corpus tiles as raw RGBA, for the upload screen's check.

The browser-side screen in `frontDemo/src/sim/ingest.ts` is the only
implementation; this exists so it can be run against real tiles in Node without
a second copy of the algorithm in Python. Python decodes, TypeScript decides.

Tiles are drawn from TRAIN only. The held-out test split is consumed and must
not be touched (CLAUDE.md section 6), and nothing here is a detection benchmark
in any case -- it checks that a threshold screen returns a region roughly where
the labelled oil is, which is all an upload needs to have geometry to drift.

    .venv/Scripts/python.exe -m scripts.export_ingest_fixtures --out <dir>
    cd frontDemo && TILE_DIR=<dir> npm run check:ingest
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
from typing import Any

from PIL import Image

from backend.config import REPO_ROOT

IMAGES = REPO_ROOT / "data/processed/dataset/oos/images/train"
LABELS = REPO_ROOT / "data/processed/dataset/oos/labels/train"
# One bucket per source corpus, so the screen is not tuned to a single one.
SOURCES = ("8346860", "13761290", "15298010")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--per-source", type=int, default=8)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    if not IMAGES.exists():
        print(f"no corpus at {IMAGES}; nothing to export")
        return 0
    args.out.mkdir(parents=True, exist_ok=True)
    random.seed(args.seed)

    buckets: dict[str, list[pathlib.Path]] = {s: [] for s in SOURCES}
    for path in sorted(IMAGES.glob("*.png")):
        source = path.name.split("__")[0]
        if source not in buckets:
            continue
        label = LABELS / (path.stem + ".txt")
        # Negatives have nothing to compare a traced region against.
        if label.exists() and label.read_text().strip():
            buckets[source].append(path)

    manifest: list[dict[str, Any]] = []
    for source, files in buckets.items():
        random.shuffle(files)
        for path in files[: args.per_source]:
            image = Image.open(path).convert("RGBA")
            (args.out / f"{path.stem}.bin").write_bytes(image.tobytes())
            polygons = []
            for line in (LABELS / (path.stem + ".txt")).read_text().splitlines():
                parts = line.split()
                if len(parts) < 7:
                    continue
                values = [float(v) for v in parts[1:]]
                polygons.append([[values[i], values[i + 1]] for i in range(0, len(values) - 1, 2)])
            manifest.append(
                dict(
                    name=path.stem,
                    source=source,
                    width=image.width,
                    height=image.height,
                    bin=f"{path.stem}.bin",
                    polygons=polygons,
                )
            )

    (args.out / "manifest.json").write_text(json.dumps(manifest))
    print(f"exported {len(manifest)} tiles to {args.out}")
    for source in SOURCES:
        rows = [m for m in manifest if m["source"] == source]
        print(f"  {source}: {len(rows)} tiles, {sum(len(m['polygons']) for m in rows)} label polygons")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
