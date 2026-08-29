"""Unit tests for the real AIS loading and cleaning path."""

from __future__ import annotations

import csv
from datetime import UTC, datetime, timedelta
from pathlib import Path

from backend.ingest.ais.clean import clean_records
from backend.ingest.ais.loader import AIS_COLUMNS, AisRecord, iter_ais_records


def _record(**changes: object) -> AisRecord:
    values: dict[str, object] = {
        "mmsi": 123456789,
        "base_date_time": datetime(2023, 5, 15, tzinfo=UTC),
        "lat": 29.0,
        "lon": -90.0,
        "sog": 8.0,
        "cog": 90.0,
        "heading": 90.0,
        "vessel_name": "TEST VESSEL",
        "imo": None,
        "call_sign": None,
        "vessel_type": 70,
        "status": 0,
        "length": None,
        "width": None,
        "draft": None,
        "cargo": None,
        "transceiver_class": "A",
    }
    values.update(changes)
    return AisRecord(**values)  # type: ignore[arg-type]


def test_cleaning_deduplicates_normalises_sentinels_and_drops_bad_positions() -> None:
    first = _record(cog=360.0, heading=511.0)
    bad_position = _record(mmsi=987654321, lat=91.0)

    cleaned = list(clean_records([first, first, bad_position]))

    assert len(cleaned) == 1
    assert cleaned[0].cog is None
    assert cleaned[0].heading is None


def test_cleaning_drops_impossible_jump_but_keeps_fast_legitimate_transit() -> None:
    first = _record()
    legitimate = _record(base_date_time=first.base_date_time + timedelta(hours=1), lon=-89.5)
    impossible = _record(
        base_date_time=first.base_date_time + timedelta(hours=2), lon=-70.0
    )

    cleaned = list(clean_records([first, legitimate, impossible]))

    assert cleaned == [first, legitimate]


def test_csv_loader_parses_provider_schema(tmp_path: Path) -> None:
    source = tmp_path / "ais.csv"
    with source.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=sorted(AIS_COLUMNS))
        writer.writeheader()
        writer.writerow(
            {
                "MMSI": "123456789",
                "BaseDateTime": "2023-05-15T00:00:00",
                "LAT": "29.0",
                "LON": "-90.0",
                "SOG": "0.0",
                "COG": "360.0",
                "Heading": "511.0",
                "VesselName": "",
                "IMO": "",
                "CallSign": "",
                "VesselType": "",
                "Status": "",
                "Length": "",
                "Width": "",
                "Draft": "",
                "Cargo": "",
                "TransceiverClass": "B",
            }
        )

    records = list(iter_ais_records(source))

    assert records[0].mmsi == 123456789
    assert records[0].base_date_time.tzinfo is UTC
    assert records[0].transceiver_class == "B"
