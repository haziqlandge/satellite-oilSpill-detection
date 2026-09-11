"""Ingest AIS for a P004 fixture case: clip -> clean -> trajectories -> PostGIS.

Implements the storage decision recorded in `PLAN/CONSTRAINTS.md` (2026-08-30):
**only `ais_tracks` is inserted, not `ais_points`.** AOI + window clipping alone
leaves ~2.9 M rows per case (~700 MB with indexes) against a 500 MB Supabase free
tier; one `LINESTRING M` per vessel is ~2,172 rows and ~70 MB, and the M ordinate
already makes the spatiotemporal gate a single PostGIS operation.

Run from the repository root. It **measures without writing** by default:

    .venv/Scripts/python.exe scripts/ingest_ais_fixture.py --case 1

    .venv/Scripts/python.exe scripts/ingest_ais_fixture.py --case 1 --insert

Every daily file the window spans is required; a missing day raises rather than
silently under-covering the window, because a confident answer computed from
partial traffic is worse than no answer when the output is an accusation.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from backend.ingest.ais.behaviour import as_storage_payload
from backend.ingest.ais.clean import clean_records
from backend.ingest.ais.clip import (
    DEFAULT_BACKWARD_HOURS,
    GULF_OF_MEXICO,
    MissingAisDayError,
    clip_records,
    resolve_daily_files,
    window_for_acquisition,
)
from backend.ingest.ais.loader import LoadStats, iter_ais_records
from backend.ingest.ais.trajectory import build_trajectories

AIS_DIR = Path("data/raw/ais/2023")

# The three P004 Port of South Louisiana fixtures (PLAN/INDEX.md).
CASES: dict[int, tuple[datetime, str]] = {
    1: (datetime(2023, 4, 9, 0, 2, 6, tzinfo=UTC), "platform leak, no vessel within 5 km"),
    2: (datetime(2023, 5, 15, 0, 2, 8, tzinfo=UTC), "moving tanker, ~19 km slick (headline)"),
    3: (datetime(2023, 12, 5, 23, 57, 19, tzinfo=UTC), "vessel berthed since 3 Dec (adversarial)"),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", type=int, choices=sorted(CASES), required=True)
    parser.add_argument(
        "--backward-hours",
        type=int,
        default=DEFAULT_BACKWARD_HOURS,
        help=f"AIS history before acquisition (default {DEFAULT_BACKWARD_HOURS}, the PHASE-04 horizon)",
    )
    parser.add_argument(
        "--insert",
        action="store_true",
        help="write ais_tracks to the database; without it the run only measures",
    )
    arguments = parser.parse_args()

    acquired_at, description = CASES[arguments.case]
    window = window_for_acquisition(acquired_at, backward_hours=arguments.backward_hours)

    print(f"Case {arguments.case}: {description}")
    print(f"  acquired {acquired_at:%Y-%m-%d %H:%M:%S} UTC")
    print(f"  window   {window.start:%Y-%m-%d %H:%M} .. {window.end:%Y-%m-%d %H:%M} UTC")
    print(
        f"  AOI      lon {GULF_OF_MEXICO.min_lon:.3f}..{GULF_OF_MEXICO.max_lon:.3f}  "
        f"lat {GULF_OF_MEXICO.min_lat:.3f}..{GULF_OF_MEXICO.max_lat:.3f}"
    )

    try:
        files = resolve_daily_files(AIS_DIR, window)
    except MissingAisDayError as error:
        print(f"\n{error}", file=sys.stderr)
        return 2

    print(f"  files    {', '.join(path.name for path in files)}\n")

    started = time.monotonic()
    national = skipped = clipped = 0
    kept: list = []

    for path in files:
        stats = LoadStats()
        before = len(kept)
        kept.extend(
            clip_records(
                iter_ais_records(path, stats=stats), bbox=GULF_OF_MEXICO, window=window
            )
        )
        national += stats.total
        skipped += stats.skipped
        print(
            f"  {path.name}: {stats.total:>9,} national -> {len(kept) - before:>8,} in AOI"
            + (f"  ({stats.skipped} unparseable)" if stats.skipped else "")
        )

    clipped = len(kept)
    cleaned = list(clean_records(kept))
    trajectories = build_trajectories(cleaned, source="real")
    elapsed = time.monotonic() - started

    print(f"\n  national rows   : {national:,}")
    print(f"  unparseable     : {skipped:,}")
    print(f"  after clip      : {clipped:,}  ({clipped / max(national, 1):.2%} of national)")
    print(f"  after clean     : {len(cleaned):,}")
    print(f"  trajectories    : {len(trajectories):,} vessels")
    if trajectories:
        vertices = sum(len(t.points) for t in trajectories)
        print(f"  total vertices  : {vertices:,}  (~{vertices * 24 / 1024**2:.0f} MB as LINESTRING M)")
        print(f"  vs ais_points   : {clipped:,} rows (~{clipped * 250 / 1024**2:.0f} MB with indexes)")
    print(f"  elapsed         : {elapsed / 60:.1f} min")

    if not arguments.insert:
        print("\nmeasured only; pass --insert to write ais_tracks")
        return 0

    from sqlalchemy import delete

    from backend.db.models import AisTrack
    from backend.db.session import session_scope

    print(f"\ninserting {len(trajectories):,} tracks into ais_tracks ...")
    with session_scope() as session:
        # Re-running a case must not accumulate duplicate tracks.
        session.execute(
            delete(AisTrack).where(
                AisTrack.started_at <= window.end,
                AisTrack.ended_at >= window.start,
                AisTrack.source == "real",
            )
        )
        session.bulk_insert_mappings(
            AisTrack,
            [
                trajectory.as_db_values(behaviour=as_storage_payload(trajectory.points))
                for trajectory in trajectories
            ],
        )
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
