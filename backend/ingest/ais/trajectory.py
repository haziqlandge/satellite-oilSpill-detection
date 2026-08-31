"""Build time-aware vessel trajectories from cleaned AIS messages.

PostGIS stores each trajectory as ``LINESTRING M`` where the M ordinate is UTC
epoch seconds.  Keeping time in the geometry lets Phase-06 gate a track against
the drift field without reconstructing timestamps from a separate table.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from backend.ingest.ais.loader import AisRecord


@dataclass(frozen=True, slots=True)
class AisTrajectory:
    """One vessel trajectory and its PostGIS-compatible LINESTRING M geometry."""

    mmsi: int
    vessel_name: str | None
    started_at: datetime
    ended_at: datetime
    points: tuple[AisRecord, ...]
    source: str = "real"

    @property
    def ewkt(self) -> str:
        """Return the trajectory as SRID-tagged EWKT for GeoAlchemy/PostGIS."""

        coordinates = ", ".join(
            f"{point.lon:.8f} {point.lat:.8f} {point.base_date_time.timestamp():.3f}"
            for point in self.points
        )
        return f"SRID=4326;LINESTRING M ({coordinates})"

    def as_db_values(self) -> dict[str, object]:
        """Values matching ``AisTrack`` apart from its generated primary key."""

        return {
            "mmsi": self.mmsi,
            "vessel_name": self.vessel_name,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "geom": self.ewkt,
            "source": self.source,
        }


def build_trajectories(
    records: Iterable[AisRecord], *, source: str = "real", min_points: int = 2
) -> list[AisTrajectory]:
    """Group cleaned messages by vessel and build chronological trajectories.

    A single point cannot form a line and is therefore excluded.  Callers should
    feed ``clean_records`` first; this function sorts each vessel defensively so
    tests and synthetic generators do not rely on provider file order.
    """

    if source not in {"real", "synthetic"}:
        raise ValueError("source must be 'real' or 'synthetic'")
    if min_points < 2:
        raise ValueError("min_points must be at least 2 for LINESTRING M")

    by_mmsi: dict[int, list[AisRecord]] = defaultdict(list)
    for record in records:
        by_mmsi[record.mmsi].append(record)

    trajectories: list[AisTrajectory] = []
    for mmsi, vessel_points in by_mmsi.items():
        points = tuple(sorted(vessel_points, key=lambda point: point.base_date_time))
        if len(points) < min_points:
            continue
        vessel_name = next((point.vessel_name for point in points if point.vessel_name), None)
        trajectories.append(
            AisTrajectory(
                mmsi=mmsi,
                vessel_name=vessel_name,
                started_at=points[0].base_date_time,
                ended_at=points[-1].base_date_time,
                points=points,
                source=source,
            )
        )
    return sorted(trajectories, key=lambda trajectory: (trajectory.started_at, trajectory.mmsi))
