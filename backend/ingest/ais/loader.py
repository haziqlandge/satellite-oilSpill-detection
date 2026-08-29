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
from collections.abc import Iterator
from dataclasses import dataclass
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


def _records_from_text(stream: TextIO) -> Iterator[AisRecord]:
    for row in csv.DictReader(stream):
        yield parse_ais_row(row)


def iter_ais_records(path: Path) -> Iterator[AisRecord]:
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
                yield from _records_from_text(text)
        return

    if suffix == ".zst":
        with (
            path.open("rb") as binary,
            zstandard.ZstdDecompressor().stream_reader(binary) as decoded,
            io.TextIOWrapper(decoded, encoding="utf-8-sig") as text,
        ):
            yield from _records_from_text(text)
        return

    if suffix == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as text:
            yield from _records_from_text(text)
        return

    raise ValueError(f"unsupported AIS extract {path}; expected .zip, .zst or .csv")
