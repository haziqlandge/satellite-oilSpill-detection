"""Run the SNAP GPT chain over every downloaded fixture `.SAFE` product.

Input comes from `scripts/download_cdse_fixture_safe.py`; output is geocoded
sigma0 dB GeoTIFF in `data/processed/sar/`, which is what PHASE-01's acceptance
criterion "all three fixture scenes fetched and pre-processed end-to-end" means.

Run from the repository root:

    .venv/Scripts/python.exe scripts/preprocess_fixtures.py

Safe to re-run: an existing output is skipped. One scene is minutes to tens of
minutes -- Refined Lee over a full IW GRDH scene is the expensive step.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from backend.ingest.sar.preprocess import (
    DEFAULT_MAX_HEAP_GB,
    SnapNotFoundError,
    SnapProcessingError,
    run_graph,
)

SOURCE_DIR = Path("data/raw/sar/safe")
TARGET_DIR = Path("data/processed/sar")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-heap-gb",
        type=int,
        default=DEFAULT_MAX_HEAP_GB,
        help=f"JVM heap for gpt (default {DEFAULT_MAX_HEAP_GB})",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="substring filter on the .SAFE name, to process a single scene",
    )
    arguments = parser.parse_args()

    products = sorted(SOURCE_DIR.glob("*.SAFE"))

    # SNAP warns that the calibration LUT "could be incorrect" on CDSE's
    # Cloud-Optimized packaging but not on the classic product, and an unreliable
    # sigma0 undermines every downstream stage. Skip rather than silently produce
    # a suspect result. See PHASE-01 "Confirmed on this hardware".
    cog = [p for p in products if "_COG" in p.name]
    for product in cog:
        print(f"skipping {product.name}\n    COG calibration LUT is unreliable in SNAP; use the classic product")
    products = [p for p in products if "_COG" not in p.name]

    if arguments.only:
        products = [p for p in products if arguments.only in p.name]
    if not products:
        print(
            f"no .SAFE products in {SOURCE_DIR}. "
            "Run scripts/download_cdse_fixture_safe.py first.",
            file=sys.stderr,
        )
        return 2

    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0

    for product in products:
        target = TARGET_DIR / f"{product.stem}_s0db.tif"
        print(f"\n=== {product.name}")
        if target.exists():
            print(f"    already processed: {target.name}")
            continue

        started = time.monotonic()
        print(f"    running SNAP chain -> {target.name}", flush=True)
        try:
            result = run_graph(product, target, max_heap_gb=arguments.max_heap_gb)
        except SnapNotFoundError as error:
            print(f"    {error}", file=sys.stderr)
            return 2
        except SnapProcessingError as error:
            print(f"    FAILED: {error}", file=sys.stderr)
            failures += 1
            continue

        elapsed = time.monotonic() - started
        size_gb = target.stat().st_size / 1024**3
        print(
            f"    OK in {elapsed / 60:.1f} min, {size_gb:.2f} GB, EPSG:{result.epsg}",
            flush=True,
        )

    if failures:
        print(f"\n{failures} scene(s) failed", file=sys.stderr)
        return 1
    print("\nall fixture scenes preprocessed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
