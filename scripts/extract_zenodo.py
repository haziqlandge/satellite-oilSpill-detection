"""Extract the downloaded Zenodo archives into `data/interim/datasets/zenodo/`.

Second half of the corpus pipeline: `download_zenodo.py` fetches and MD5-verifies
the archives, this unpacks them into the image and mask directories PHASE-02
assembles a training set from.

Run from the repository root:

    .venv/Scripts/python.exe scripts/extract_zenodo.py

Safe to interrupt and re-run. An archive whose destination already exists is
skipped, and a run that dies part-way leaves a `.partial` directory rather than
a half-populated one under the final name -- so an interrupted extraction can
never be mistaken for a complete one.

A `.part` file is a download still in flight; those are reported and skipped
rather than fed to the extractor, which would fail confusingly on a truncated
archive.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

from backend.ingest.datasets.extract import (
    ExtractionError,
    extract_archive,
    find_extractor,
)
from backend.ingest.datasets.zenodo import RECORDS

SOURCE_DIR = Path("data/raw/datasets/zenodo")
TARGET_DIR = Path("data/interim/datasets/zenodo")

# 7z of imagery expands to roughly its own size again. Checked before starting
# so a 38 GB archive does not fill the disk 90% of the way in.
EXTRACTION_FACTOR = 1.2


def _human(size: float) -> str:
    return f"{size / 1024**3:.2f} GB"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--records",
        default=None,
        help="comma-separated record ids; default is every record already downloaded",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="list what would be extracted and the space it needs, then stop",
    )
    arguments = parser.parse_args()

    if not SOURCE_DIR.exists():
        print(f"nothing at {SOURCE_DIR}. Run scripts/download_zenodo.py first.", file=sys.stderr)
        return 2

    wanted = None
    if arguments.records:
        wanted = {r.strip() for r in arguments.records.split(",") if r.strip()}

    pending: list[tuple[str, Path, Path]] = []
    in_flight: list[Path] = []

    for record_dir in sorted(SOURCE_DIR.iterdir()):
        if not record_dir.is_dir():
            continue
        if wanted is not None and record_dir.name not in wanted:
            continue
        for archive in sorted(record_dir.iterdir()):
            if archive.suffix == ".part":
                in_flight.append(archive)
                continue
            if archive.suffix.lower() not in {".7z", ".zip"}:
                continue
            destination = TARGET_DIR / record_dir.name / archive.stem
            pending.append((record_dir.name, archive, destination))

    if in_flight:
        print("still downloading, skipped:")
        for archive in in_flight:
            print(f"    {archive.parent.name}/{archive.name}")
        print()

    if not pending:
        print("no complete archives to extract")
        return 0

    outstanding = [entry for entry in pending if not entry[2].exists()]
    need = sum(archive.stat().st_size for _, archive, _ in outstanding) * EXTRACTION_FACTOR
    free = shutil.disk_usage(Path.cwd().anchor).free

    print(f"archives found:   {len(pending)}")
    print(f"already extracted: {len(pending) - len(outstanding)}")
    print(f"to extract:       {len(outstanding)}  (~{_human(need)} needed, {_human(free)} free)\n")

    for record_id, archive, destination in pending:
        state = "extracted" if destination.exists() else "pending"
        print(f"  [{state:>9}] {record_id}/{archive.name}  ({_human(archive.stat().st_size)})")

    if need > free:
        print(f"\nnot enough disk: need ~{_human(need)}, have {_human(free)}.", file=sys.stderr)
        return 1

    if arguments.dry_run:
        print("\ndry run: nothing extracted")
        return 0

    if any(archive.suffix.lower() == ".7z" for _, archive, dest in outstanding if not dest.exists()):
        try:
            tool = find_extractor()
        except ExtractionError as error:
            print(f"\n{error}", file=sys.stderr)
            return 1
        print(f"\nusing {tool.flavour} at {tool.path}")
    else:
        tool = None

    failures = 0
    for record_id, archive, destination in pending:
        if destination.exists():
            continue
        print(f"\n=== {record_id}/{archive.name} -- {RECORDS.get(record_id, 'unknown record')}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        try:
            written = extract_archive(archive, destination, extractor=tool)
        except (ExtractionError, OSError) as error:
            print(f"    FAILED: {error}", file=sys.stderr)
            failures += 1
            continue
        elapsed = (time.monotonic() - started) / 60
        print(f"    {written} files in {elapsed:.1f} min -> {destination}")

    if failures:
        print(f"\n{failures} archive(s) failed", file=sys.stderr)
        return 1
    print("\nall available archives extracted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
