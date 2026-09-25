"""Clip AIS to an area of interest and a time window, at ingest.

`PLAN/CONSTRAINTS.md` requires this and says why: Supabase is **500 MB** on the
free tier and 8 GB on Pro, a marinecadastre national day is ~0.82 GB uncompressed
and millions of rows, and `ais_points` is the table that reaches the ceiling
first. We only ever query traffic near a detection, so nationwide rows are dead
weight. Raw CSVs stay on local disk under `data/raw/`; only the clipped subset is
inserted.

Two design points are load-bearing rather than incidental:

**The box is buffered, not the scene footprint.** Backward drift is the whole
point of the system: a slick observed inside the scene was released *somewhere
else, earlier*, quite possibly outside the imaged area. Clipping tightly to the
footprint would delete the very vessel the pipeline exists to identify. The
buffer is sized from the drift horizon, below.

**The window looks backward.** The origin precedes the observation, so the
window runs from `acquisition - backward_hours` to the acquisition, not forward
from it.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from backend.ingest.ais.loader import AisRecord

# Mean length of a degree of latitude. Longitude shrinks by cos(latitude).
_KM_PER_DEGREE_LAT = 111.32

# PHASE-04 runs backward drift over 0-48 h, so the AIS has to cover at least
# that or the origin window is queried against data that was never loaded.
DEFAULT_BACKWARD_HOURS = 48

# How far outside the AOI a vessel can sit and still be a plausible origin.
# Sized from the drift horizon: Gulf surface currents run ~0.5 m/s (the Loop
# Current considerably faster), and 0.5 m/s over 48 h is ~86 km. 100 km is that
# rounded up. Widen it if the horizon is extended.
DEFAULT_BUFFER_KM = 100.0


@dataclass(frozen=True, slots=True)
class BoundingBox:
    """A geographic rectangle in EPSG:4326 degrees."""

    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def __post_init__(self) -> None:
        # A transposed lat/lon pair produces an empty box that silently clips
        # every record away, which looks exactly like "no traffic in the AOI".
        if self.min_lon > self.max_lon:
            raise ValueError(
                f"min_lon {self.min_lon} is east of max_lon {self.max_lon}; "
                "the bounds are probably transposed"
            )
        if self.min_lat > self.max_lat:
            raise ValueError(
                f"min_lat {self.min_lat} is north of max_lat {self.max_lat}; "
                "the bounds are probably transposed"
            )

    def contains(self, *, lon: float, lat: float) -> bool:
        return self.min_lon <= lon <= self.max_lon and self.min_lat <= lat <= self.max_lat

    def buffered_km(self, distance_km: float) -> BoundingBox:
        """Widen the box by roughly `distance_km` on every side.

        Longitude is scaled by `cos(latitude)`: at 29 N a degree of longitude is
        only ~0.87 of a degree of latitude, so applying the same degree offset to
        both axes would under-buffer longitude -- which is the axis the Gulf
        scenes are widest in.
        """

        lat_pad = distance_km / _KM_PER_DEGREE_LAT

        # Use the latitude closest to the equator, where a degree of longitude is
        # longest, so the padding is never short anywhere along the edge.
        reference_lat = min(abs(self.min_lat), abs(self.max_lat))
        scale = math.cos(math.radians(reference_lat))
        lon_pad = lat_pad / scale if scale > 1e-6 else 180.0

        return BoundingBox(
            min_lon=max(-180.0, self.min_lon - lon_pad),
            min_lat=max(-90.0, self.min_lat - lat_pad),
            max_lon=min(180.0, self.max_lon + lon_pad),
            max_lat=min(90.0, self.max_lat + lat_pad),
        )


@dataclass(frozen=True, slots=True)
class TimeWindow:
    """A closed UTC interval, inclusive at both ends."""

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        for name, value in (("start", self.start), ("end", self.end)):
            if value.tzinfo is None:
                raise ValueError(f"{name} must be timezone-aware UTC, got a naive datetime")
        if self.start > self.end:
            raise ValueError(f"start {self.start} is after end {self.end}")

    def contains(self, when: datetime) -> bool:
        return self.start <= when <= self.end


def window_for_acquisition(
    acquired_at: datetime,
    *,
    backward_hours: int = DEFAULT_BACKWARD_HOURS,
    forward_hours: int = 0,
) -> TimeWindow:
    """The AIS window relevant to a scene acquired at `acquired_at`.

    Runs **backward** from the acquisition, because the origin precedes the
    observation. `forward_hours` exists for cases where traffic just after the
    pass is wanted for context; it defaults to none.
    """

    if acquired_at.tzinfo is None:
        raise ValueError(
            "acquired_at must be timezone-aware UTC. marinecadastre timestamps are "
            "UTC, and a naive value here fails later inside the clip loop instead."
        )

    return TimeWindow(
        start=acquired_at - timedelta(hours=backward_hours),
        end=acquired_at + timedelta(hours=forward_hours),
    )


def clip_records(
    records: Iterable[AisRecord],
    *,
    bbox: BoundingBox,
    window: TimeWindow,
) -> Iterator[AisRecord]:
    """Yield only the records inside both the box and the window.

    A generator on purpose: a national day is millions of rows and must stream
    from the CSV to the insert without being materialised.
    """

    for record in records:
        if not window.contains(record.base_date_time):
            continue
        if not bbox.contains(lon=record.lon, lat=record.lat):
            continue
        yield record


class MissingAisDayError(FileNotFoundError):
    """A daily extract the window needs is not on disk."""


def daily_files_for_window(window: TimeWindow) -> list[str]:
    """The marinecadastre daily-extract stems a window spans, in order.

    A 48 h window anchored at 00:02 touches **three** calendar days. Loading only
    the acquisition day yields about two minutes of overlap, which does not look
    like an error -- it looks like light traffic. Measured on 2026-08-30: the
    Apr 9 file alone gave 2,330 rows in the AOI, where the correct three-file set
    gave 2,955,407.
    """

    stems: list[str] = []
    day = window.start.date()
    last = window.end.date()
    while day <= last:
        stems.append(f"AIS_{day:%Y_%m_%d}")
        day += timedelta(days=1)
    return stems


def resolve_daily_files(directory: Path, window: TimeWindow) -> list[Path]:
    """Resolve the window's daily extracts under `directory`, or say what is missing.

    Raises rather than returning a short list: a silently under-loaded window
    produces a confident answer computed from partial traffic, which is worse
    than no answer at all when the output is an accusation.
    """

    resolved: list[Path] = []
    missing: list[str] = []

    for stem in daily_files_for_window(window):
        for suffix in (".zip", ".zst", ".csv"):
            candidate = directory / f"{stem}{suffix}"
            if candidate.exists():
                resolved.append(candidate)
                break
        else:
            missing.append(stem)

    if missing:
        raise MissingAisDayError(
            f"{directory}: the window {window.start:%Y-%m-%d %H:%M}.."
            f"{window.end:%Y-%m-%d %H:%M} UTC needs {', '.join(missing)}, "
            "which is not present. Loading the remaining days would silently "
            "under-cover the window."
        )

    return resolved


# The Gulf of Mexico AOI, taken from the **measured** footprint of the
# terrain-corrected Case 1 product (2026-08-30): lon -91.1022..-88.1751,
# lat 27.9531..29.8763, then buffered for drift. All three P004 fixture scenes
# are the same Port of South Louisiana frame. The footprint is the region
# registry's (`aisFootprint`, `backend/regions.py`).
def _footprint(region_id: str) -> BoundingBox:
    from backend.regions import box, region

    west, south, east, north = box(region(region_id), "aisFootprint")
    return BoundingBox(min_lon=west, min_lat=south, max_lon=east, max_lat=north)


GULF_OF_MEXICO = _footprint("gulf-of-mexico").buffered_km(DEFAULT_BUFFER_KM)
