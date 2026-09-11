"""Download and verify the Zenodo training corpus (PHASE-01).

Four records, ~91 GB of 7z/zip archives, listed in
`backend.ingest.datasets.zenodo.RECORDS`. Every file is checked against the MD5
Zenodo publishes, because a truncated multi-gigabyte archive does not announce
itself -- it surfaces later as a short image count or a corrupt read partway
through training.

Run from the repository root:

    .venv/Scripts/python.exe scripts/download_zenodo.py --records essential

Safe to re-run and safe to interrupt: verified files are skipped, and a partial
transfer resumes from a `.part` sibling rather than starting over.

Free space is checked before anything is fetched. This is the failure that
actually happened on 2026-08-29 -- 91 GB of archives against 59.9 GB free -- and
a disk that fills at 80% of a 38 GB file wastes hours rather than reporting a
problem up front.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

from backend.ingest.datasets.zenodo import (
    DEFAULT_CONNECTIONS,
    RECORDS,
    ZenodoError,
    ZenodoFile,
    download_file_parallel,
    fetch_record,
)

TARGET_DIR = Path("data/raw/datasets/zenodo")

# Smallest first: the masks and the Refined SOS corrections are tens of MB and
# land in seconds, so relabelling (PHASE-01's largest hidden cost) can start
# while the bulk image archives are still arriving.
ORDER = ["15298010", "13761290", "8346860", "8253899"]

# Part II is 42.8 GB of negatives to fill a pool that PHASE-01 sizes at ~10% of
# each split, so it is separable from the set that everything else depends on.
GROUPS = {
    "essential": ["15298010", "13761290", "8346860"],
    "negatives": ["8253899"],
    "all": ORDER,
}

# 7z extraction needs roughly as much again as the archive itself.
EXTRACTION_FACTOR = 2.0

# A 38 GB file over a domestic link takes hours, and a transient drop must not
# cost the whole transfer. Observed on 2026-08-30: the link went down mid-file
# and every remaining file then failed instantly on `getaddrinfo`, turning one
# blip into eight failures. Each attempt resumes from the `.part` file, so a
# retry costs the remainder rather than restarting.
MAX_ATTEMPTS = 8
BACKOFF_CAP_S = 300.0


def _human(size: float) -> str:
    return f"{size / 1024**3:.2f} GB"


def _plan(record_ids: list[str]) -> dict[str, list[ZenodoFile]]:
    plan: dict[str, list[ZenodoFile]] = {}
    for record_id in record_ids:
        print(f"listing record {record_id} -- {RECORDS.get(record_id, 'unknown')}")
        plan[record_id] = fetch_record(record_id)
    return plan


def _outstanding(plan: dict[str, list[ZenodoFile]]) -> int:
    """Bytes still to fetch, ignoring files already present at full size."""

    total = 0
    for record_id, files in plan.items():
        for entry in files:
            path = TARGET_DIR / record_id / entry.key
            if path.exists() and entry.size and path.stat().st_size == entry.size:
                continue
            partial = path.with_name(path.name + ".part")
            have = partial.stat().st_size if partial.exists() else 0
            total += max(0, entry.size - have)
    return total


def _progress(key: str):
    state = {"last": 0.0}

    def report(written: int, total: int | None) -> None:
        now = time.monotonic()
        if now - state["last"] < 30 and written != total:
            return
        state["last"] = now
        if total:
            print(f"    {key}: {_human(written)} / {_human(total)} ({written / total:.0%})", flush=True)
        else:
            print(f"    {key}: {_human(written)}", flush=True)

    return report


def _fetch_with_retry(entry: ZenodoFile, target: Path, connections: int) -> None:
    """Download one file, retrying transient network failures.

    `OSError` covers both `URLError` (DNS and connection failures) and socket
    timeouts. `ZenodoError` here means the checksum failed; that is retried too,
    because the usual cause is a corrupted transfer rather than a bad archive on
    Zenodo -- but `download_file` has already discarded the bad `.part`, so the
    retry restarts that file rather than resuming it.
    """

    delay = 15.0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            download_file_parallel(
                entry, target, connections=connections, progress=_progress(entry.key)
            )
            return
        except (OSError, ZenodoError) as error:
            if attempt == MAX_ATTEMPTS:
                raise
            print(
                f"    attempt {attempt}/{MAX_ATTEMPTS} failed ({error}); "
                f"retrying in {delay:.0f}s",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(delay)
            delay = min(delay * 2, BACKOFF_CAP_S)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--records",
        default="essential",
        help="'essential' (Parts I+III+Refined SOS), 'negatives' (Part II), 'all', or comma-separated ids",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="list what would be fetched and the space it needs, then stop",
    )
    parser.add_argument(
        "--connections",
        type=int,
        default=DEFAULT_CONNECTIONS,
        help=(
            f"parallel byte-range connections per file (default {DEFAULT_CONNECTIONS}, "
            "i.e. serial). Parallel is implemented and tested but UNPROVEN: the one "
            "measurement suggesting it helped was taken while a serial transfer was "
            "still running, so it means nothing. Serial alone measures ~9 MB/s."
        ),
    )
    parser.add_argument(
        "--allow-tight-disk",
        action="store_true",
        help="proceed even if there is no room for 7z extraction as well",
    )
    arguments = parser.parse_args()

    selection = arguments.records.strip()
    if selection in GROUPS:
        record_ids = GROUPS[selection]
    else:
        record_ids = [r.strip() for r in selection.split(",") if r.strip()]
    unknown = [r for r in record_ids if r not in RECORDS]
    if unknown:
        print(f"unknown record id(s): {', '.join(unknown)}", file=sys.stderr)
        return 2

    plan = _plan(record_ids)
    need = _outstanding(plan)
    free = shutil.disk_usage(Path.cwd().anchor).free

    print(f"\nto fetch: {_human(need)}")
    print(f"free now: {_human(free)}")
    print(f"with 7z extraction headroom (x{EXTRACTION_FACTOR:g}): {_human(need * EXTRACTION_FACTOR)}")

    for record_id, files in plan.items():
        print(f"\n  record {record_id} -- {RECORDS[record_id]}")
        for entry in sorted(files, key=lambda f: -f.size):
            print(f"     {_human(entry.size):>10}  {entry.key}")

    if need > free:
        print(
            f"\nnot enough disk: need {_human(need)}, have {_human(free)}. "
            "Nothing was downloaded.",
            file=sys.stderr,
        )
        return 1

    if need * EXTRACTION_FACTOR > free and not arguments.allow_tight_disk:
        print(
            f"\nthe archives fit ({_human(need)} of {_human(free)}) but leave no room to "
            f"extract them (~{_human(need * EXTRACTION_FACTOR)} needed in total).\n"
            "Re-run with --allow-tight-disk to download anyway and extract elsewhere.",
            file=sys.stderr,
        )
        return 1

    if arguments.dry_run:
        print("\ndry run: nothing downloaded")
        return 0

    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0

    for record_id in record_ids:
        destination_dir = TARGET_DIR / record_id
        print(f"\n=== record {record_id} -- {RECORDS[record_id]}")
        # Smallest file first, so the masks are on disk before the images.
        for entry in sorted(plan[record_id], key=lambda f: f.size):
            target = destination_dir / entry.key
            started = time.monotonic()
            print(f"  {entry.key} ({_human(entry.size)})", flush=True)
            try:
                _fetch_with_retry(entry, target, arguments.connections)
            except (OSError, ZenodoError) as error:
                print(f"    FAILED after {MAX_ATTEMPTS} attempts: {error}", file=sys.stderr)
                failures += 1
                continue
            elapsed = time.monotonic() - started
            print(f"    verified in {elapsed / 60:.1f} min", flush=True)

    if failures:
        print(f"\n{failures} file(s) failed -- re-run to resume", file=sys.stderr)
        return 1
    print("\nall selected records downloaded and checksum-verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
