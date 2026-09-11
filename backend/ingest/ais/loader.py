"""Streaming readers for MarineCadastre AIS extracts.

The provider currently distributes 2023 daily extracts as ZIP archives.  Earlier
archives and third-party mirrors may be raw CSV or Zstandard-compressed CSV, so
the reader accepts all three forms without loading a national daily file into
memory.
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TextIO

import zstandard

AIS_COLUMNS = frozenset(
    {
        "MMSI",
        "BaseDateTime",
        "LAT",
        "LON",
        "SOG",
        "COG",
        "Heading",
        "VesselName",
        "IMO",
        "CallSign",
        "VesselType",
        "Status",
        "Length",
        "Width",
        "Draft",
        "Cargo",
        "TransceiverClass",
    }
)


@dataclass(frozen=True, slots=True)
class AisRecord:
    """One normalised AIS message, shared by real and synthetic data paths."""

    mmsi: int
    base_date_time: datetime
    lat: float
    lon: float
    sog: float | None
    cog: float | None
    heading: float | None
    vessel_name: str | None
    imo: str | None
    call_sign: str | None
    vessel_type: int | None
    status: int | None
    length: float | None
    width: float | None
    draft: float | None
    cargo: int | None
    transceiver_class: str | None


def _optional_str(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def _optional_float(value: str | None) -> float | None:
    value = _optional_str(value)
    return float(value) if value is not None else None


def _optional_int(value: str | None) -> int | None:
    value = _optional_str(value)
    return int(float(value)) if value is not None else None


def parse_ais_row(row: dict[str, str]) -> AisRecord:
    """Parse one provider row; structural cleaning belongs in ``clean.py``."""

    missing = AIS_COLUMNS.difference(row)
    if missing:
        raise ValueError(f"AIS row is missing columns: {', '.join(sorted(missing))}")

    timestamp = datetime.fromisoformat(row["BaseDateTime"].replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=UTC)
    else:
        timestamp = timestamp.astimezone(UTC)

    return AisRecord(
        mmsi=int(row["MMSI"]),
        base_date_time=timestamp,
        lat=float(row["LAT"]),
        lon=float(row["LON"]),
        sog=_optional_float(row["SOG"]),
        cog=_optional_float(row["COG"]),
        heading=_optional_float(row["Heading"]),
        vessel_name=_optional_str(row["VesselName"]),
        imo=_optional_str(row["IMO"]),
        call_sign=_optional_str(row["CallSign"]),
        vessel_type=_optional_int(row["VesselType"]),
        status=_optional_int(row["Status"]),
        length=_optional_float(row["Length"]),
        width=_optional_float(row["Width"]),
        draft=_optional_float(row["Draft"]),
        cargo=_optional_int(row["Cargo"]),
        transceiver_class=_optional_str(row["TransceiverClass"]),
    )


class AisRowError(ValueError):
    """One provider row could not be parsed, with the row number and value."""


@dataclass
class LoadStats:
    """Counts for one file read. Skipped rows are reported, never silent.

    A silent drop is the dangerous option: a provider format change would show up
    as "slightly less traffic in the AOI" rather than as an error, and traffic
    volume is an input to the attribution scoring.
    """

    total: int = 0
    parsed: int = 0
    skipped: int = 0
    reasons: Counter[str] = field(default_factory=Counter)


def _records_from_text(
    stream: TextIO,
    *,
    strict: bool = False,
    stats: LoadStats | None = None,
) -> Iterator[AisRecord]:
    """Parse rows, optionally tolerating individual malformed ones.

    A real marinecadastre day (AIS_2023_04_09) carries exactly **one** row in
    8,235,199 whose MMSI is `G338926440` -- the Coast Guard cutter CGC OLIVER
    HENRY, off Guam. Parsing it strictly aborted the entire national day. One
    unparseable identifier must not cost 8.2 million good rows, so by default the
    row is skipped and counted; `strict=True` restores the hard failure for
    fixtures and regression data, where quiet degradation would be worse.
    """

    for number, row in enumerate(csv.DictReader(stream), start=1):
        if stats is not None:
            stats.total += 1
        try:
            record = parse_ais_row(row)
        except (ValueError, KeyError) as error:
            problem = AisRowError(f"row {number}: {error} (MMSI={row.get('MMSI')!r})")
            if strict:
                raise problem from error
            if stats is not None:
                stats.skipped += 1
                stats.reasons[type(error).__name__] += 1
            continue
        if stats is not None:
            stats.parsed += 1
        yield record


def iter_ais_records(
    path: Path,
    *,
    strict: bool = False,
    stats: LoadStats | None = None,
) -> Iterator[AisRecord]:
    """Yield messages from a ``.zip``, ``.zst`` or plain CSV extract.

    ZIP archives must contain exactly one CSV payload.  This catches accidental
    ingestion of a documentation archive before any data reaches PostGIS.
    """

    suffix = path.suffix.lower()
    if suffix == ".zip":
        with zipfile.ZipFile(path) as archive:
            members = [entry for entry in archive.infolist() if not entry.is_dir()]
            if len(members) != 1:
                raise ValueError(f"expected one CSV in {path.name}, found {len(members)}")
            with archive.open(members[0]) as binary, io.TextIOWrapper(binary, encoding="utf-8-sig") as text:
                yield from _records_from_text(text, strict=strict, stats=stats)
        return

    if suffix == ".zst":
        with (
            path.open("rb") as binary,
            zstandard.ZstdDecompressor().stream_reader(binary) as decoded,
            io.TextIOWrapper(decoded, encoding="utf-8-sig") as text,
        ):
            yield from _records_from_text(text, strict=strict, stats=stats)
        return

    if suffix == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as text:
            yield from _records_from_text(text, strict=strict, stats=stats)
        return

    raise ValueError(f"unsupported AIS extract {path}; expected .zip, .zst or .csv")
