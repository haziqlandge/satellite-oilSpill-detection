"""Pre-resize the on-disk `.npy` image cache to `imgsz`, once instead of per epoch.

    .venv/Scripts/python.exe scripts/presize_cache.py --dry-run
    .venv/Scripts/python.exe scripts/presize_cache.py --split train
    .venv/Scripts/python.exe scripts/presize_cache.py --verify

**What ultralytics actually caches, and why this is worth doing.** `cache="disk"`
writes the *decoded* image (`BaseDataset.cache_images_to_disk` -> `np.save` of
`imread`), not a resized one. `load_image` then resizes to `imgsz` on every read,
every epoch, for the life of the run. Measured on this corpus at imgsz=1024:

| source | cached .npy | per-image load+resize | after |
|---|---|---|---|
| 2048x2048 (Part I / Part III) | 12.58 MB | 13.7 ms cold, 6.8 ms warm | **1.4 ms** |
| 256x256 (Refined SOS) | 0.20 MB | 1.2 ms | unchanged |

**Only the oversized entries are rewritten, and that asymmetry is the point.**
The 256x256 sources are *upscaled* 4x to 1024 by `load_image`. Materialising that
upscale on disk would turn 0.20 MB into 3.15 MB each -- 3,291 of them, so
+9.6 GB of cache and +9.6 GB of disk read per epoch, to save a 0.5 ms `cv2.resize`
that is cheaper than the extra read. Pre-resizing everything is the obvious
implementation and it is a net loss.

**The result is bit-identical to what training sees today.** This applies exactly
the call `BaseDataset.load_image` applies -- `cv2.resize(..., INTER_LINEAR)` with
the same target computed the same way -- so the tensor handed to the model is
unchanged, and `--verify` asserts that rather than asking to be trusted. Labels
are stored normalised and are untouched by a resize. The step is therefore an
input-pipeline optimisation and **not** a deviation to be reported with results.

**Reversible.** A `.npy` here is derived data: delete one and ultralytics rebuilds
it from the `.png` on the next run. `--revert` does that for a split.

`--split train` is the default. The validation cache is deliberately left alone:
val is 585 images, so the saving is negligible, while `load_image` reports
`ori_shape` from whatever it loads and the validator uses that to scale
predictions back for metrics. Touching it would put a (small, avoidable) question
mark over comparability with the two cells that are already finished.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

DEFAULT_ROOT = Path("data/processed/dataset/oos/images")
DEFAULT_IMGSZ = 1024

# Ultralytics writes one .npy beside each image and keys it by stem, so a stale
# entry is silently preferred over the .png. Everything here therefore works on
# the .npy files themselves rather than re-deriving from source.
NPY_SUFFIX = ".npy"


def target_shape(height: int, width: int, imgsz: int) -> tuple[int, int]:
    """`(width, height)` for `cv2.resize`, or the input if no resize happens.

    Mirrors `ultralytics.data.base.BaseDataset.load_image` with `rect_mode=True`
    and `resize_short=False`, including the `min(ceil(...), imgsz)` clamp. Copied
    deliberately rather than imported: it is four lines inside a method that also
    does file IO and buffer management, and a divergence here would silently
    change what the model trains on.
    """
    ratio = imgsz / max(height, width)
    if ratio == 1:
        return width, height
    return (
        min(math.ceil(width * ratio), imgsz),
        min(math.ceil(height * ratio), imgsz),
    )


def resize_to_imgsz(array: np.ndarray, imgsz: int) -> np.ndarray:
    """Apply exactly the resize `load_image` would apply."""
    import cv2

    height, width = array.shape[:2]
    width_out, height_out = target_shape(height, width, imgsz)
    if (width_out, height_out) == (width, height):
        return array
    return cv2.resize(array, (width_out, height_out), interpolation=cv2.INTER_LINEAR)


def plan(root: Path, imgsz: int) -> tuple[list[Path], int, int]:
    """`(oversized, total, bytes_saved)` without touching anything."""
    import numpy as np

    oversized: list[Path] = []
    total = 0
    saved = 0
    for path in sorted(root.glob(f"*{NPY_SUFFIX}")):
        total += 1
        try:
            header = np.load(path, mmap_mode="r")
        except (OSError, ValueError):
            continue
        height, width = header.shape[:2]
        width_out, height_out = target_shape(height, width, imgsz)
        if (width_out, height_out) == (width, height):
            continue
        if width_out * height_out >= width * height:
            continue  # an upscale: materialising it costs disk, see the docstring
        oversized.append(path)
        channels = header.shape[2] if header.ndim > 2 else 1
        saved += (width * height - width_out * height_out) * channels * header.dtype.itemsize
    return oversized, total, saved


def rewrite(paths: list[Path], imgsz: int) -> int:
    """Rewrite each `.npy` at `imgsz`, via a temporary so a kill cannot truncate one.

    A half-written `.npy` under the final name is the failure this guards: it
    would be loaded in preference to the `.png`, and `np.load` on a truncated
    file raises inside a dataloader worker where the traceback is least legible.
    """
    import numpy as np

    done = 0
    for path in paths:
        array = np.load(path)
        resized = resize_to_imgsz(array, imgsz)
        temporary = path.with_suffix(".npy.partial")
        np.save(temporary, resized, allow_pickle=False)
        # np.save appends .npy to a name that lacks it; ours already has one.
        written = temporary if temporary.exists() else temporary.with_suffix(".partial.npy")
        written.replace(path)
        done += 1
        if done % 200 == 0:
            print(f"  {done}/{len(paths)}", flush=True)
    return done


def verify(root: Path, imgsz: int, sample: int = 40) -> tuple[int, int]:
    """Assert the **tensor the model sees** is unchanged. `(checked, mismatches)`.

    This is the claim the whole script rests on, and it has to be stated as the
    right invariant. The cache shape is *not* it: a 256x256 entry stays 256x256
    on purpose, and comparing raw cache arrays would report every one of those as
    a failure while saying nothing about training.

    What must hold is that `resize(cache)` equals `resize(png)` -- both put
    through the same `load_image` resize. That is true before the rewrite (the
    cache is the decoded PNG) and must still be true after it (the cache is the
    decoded PNG already resized, which `load_image` then leaves alone). Checking
    it against the `.png` rather than against what this script just wrote is the
    point: the PNG is the ground truth ultralytics falls back to.
    """
    import random

    import numpy as np
    from ultralytics.utils.patches import imread

    paths = sorted(root.glob(f"*{NPY_SUFFIX}"))
    random.seed(0)
    chosen = random.sample(paths, min(sample, len(paths)))
    mismatches = 0
    for path in chosen:
        source = path.with_suffix(".png")
        if not source.exists():
            continue
        decoded = imread(str(source))
        if decoded is None:
            # An unreadable source is a real failure, not a skip: the .png is the
            # fallback ultralytics uses when a .npy is missing or corrupt, so if
            # it cannot be decoded the cache entry has become the only copy.
            print(f"  UNREADABLE {source.name}: cannot decode the PNG fallback")
            mismatches += 1
            continue
        from_cache = resize_to_imgsz(np.load(path), imgsz)
        from_source = resize_to_imgsz(decoded, imgsz)
        if from_cache.shape != from_source.shape or not np.array_equal(from_cache, from_source):
            print(
                f"  MISMATCH {path.name}: via cache {from_cache.shape} "
                f"vs via png {from_source.shape}"
            )
            mismatches += 1
    return len(chosen), mismatches


def revert(root: Path) -> int:
    """Delete the cache for a split; ultralytics rebuilds it on the next run."""
    removed = 0
    for path in root.glob(f"*{NPY_SUFFIX}"):
        path.unlink()
        removed += 1
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--split", default="train", help="train | val | test")
    parser.add_argument("--imgsz", type=int, default=DEFAULT_IMGSZ)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verify", action="store_true", help="check the cache against the PNGs")
    parser.add_argument("--revert", action="store_true", help="delete the cache for this split")
    arguments = parser.parse_args()

    root = arguments.root / arguments.split
    if not root.is_dir():
        print(f"no such split: {root}", file=sys.stderr)
        return 2

    if arguments.revert:
        print(f"removed {revert(root)} cache entries from {root}; they rebuild on the next run")
        return 0

    if arguments.verify:
        checked, mismatches = verify(root, arguments.imgsz)
        print(f"verified {checked} entries against their PNG source: {mismatches} mismatch(es)")
        return 1 if mismatches else 0

    oversized, total, saved = plan(root, arguments.imgsz)
    print(
        f"{root}: {total} cache entries, {len(oversized)} oversized at imgsz={arguments.imgsz}, "
        f"{saved / 1e9:.2f} GB reclaimable (and that much less read per epoch)"
    )
    if arguments.dry_run or not oversized:
        return 0

    print(f"rewriting {len(oversized)}...")
    print(f"done: {rewrite(oversized, arguments.imgsz)} entries")
    checked, mismatches = verify(root, arguments.imgsz)
    print(f"verified {checked} against their PNG source: {mismatches} mismatch(es)")
    return 1 if mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())
