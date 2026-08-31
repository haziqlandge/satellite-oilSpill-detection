"""Conservative, explainable cleaning for AIS point streams."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import replace
from math import asin, cos, radians, sin, sqrt

from backend.ingest.ais.loader import AisRecord

# 70 kn allows documented high-speed craft while rejecting implausible jumps.
MAX_IMPLAUSIBLE_SPEED_KN = 70.0


def _distance_nm(a: AisRecord, b: AisRecord) -> float:
    """Great-circle distance in nautical miles (haversine)."""

    lat1, lon1, lat2, lon2 = map(radians, (a.lat, a.lon, b.lat, b.lon))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 3440.065 * 2 * asin(sqrt(h))


def _has_valid_position(record: AisRecord) -> bool:
    # 91/181 are provider sentinels, not locations at the edge of the world.
    return -90 <= record.lat <= 90 and -180 <= record.lon <= 180 and not (
        abs(record.lat) == 91 or abs(record.lon) == 181
    )


def _normalise_navigation_sentinels(record: AisRecord) -> AisRecord:
    return replace(
        record,
        cog=None if record.cog == 360 else record.cog,
        heading=None if record.heading == 511 else record.heading,
    )


def _is_impossible_jump(previous: AisRecord, current: AisRecord) -> bool:
    elapsed_seconds = (current.base_date_time - previous.base_date_time).total_seconds()
    if elapsed_seconds <= 0:
        return False
    implied_speed_kn = _distance_nm(previous, current) / (elapsed_seconds / 3600)
    return implied_speed_kn > MAX_IMPLAUSIBLE_SPEED_KN


def clean_records(records: Iterable[AisRecord]) -> Iterator[AisRecord]:
    """Yield a deduplicated, valid, navigation-normalised AIS stream.

    Input should be time ordered (as MarineCadastre daily extracts are).  A bad
    point never advances the per-vessel baseline, preventing one corrupt point
    from discarding the next legitimate report as a second "jump".
    """

    seen: set[tuple[int, object]] = set()
    previous_by_mmsi: dict[int, AisRecord] = {}
    for raw in records:
        key = (raw.mmsi, raw.base_date_time)
        if key in seen or not _has_valid_position(raw):
            continue
        seen.add(key)

        record = _normalise_navigation_sentinels(raw)
        previous = previous_by_mmsi.get(record.mmsi)
        if previous is not None and _is_impossible_jump(previous, record):
            continue
        previous_by_mmsi[record.mmsi] = record
        yield record
