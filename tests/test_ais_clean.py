"""Unit tests for the real AIS loading and cleaning path."""

from __future__ import annotations

import csv
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backend.ingest.ais.clean import clean_records
from backend.ingest.ais.loader import AIS_COLUMNS, AisRecord, iter_ais_records


def _csv_with_rows(mmsis: list[str]) -> str:
    """A minimal provider-shaped CSV with one row per supplied MMSI."""

    header = sorted(AIS_COLUMNS)
    lines = [",".join(header)]
    for index, mmsi in enumerate(mmsis):
        values = {name: "" for name in header}
        values["MMSI"] = mmsi
        values["BaseDateTime"] = f"2023-04-09T00:0{index}:00"
        values["LAT"] = "29.0"
        values["LON"] = "-90.0"
        lines.append(",".join(values[name] for name in header))
    return chr(10).join(lines) + chr(10)


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


# --- malformed rows in real provider data -----------------------------------
# Found on 2026-08-30 by running the loader over a real marinecadastre day:
# AIS_2023_04_09 contains exactly ONE row out of 8,235,199 whose MMSI is
# 'G338926440' (CGC OLIVER HENRY, a Coast Guard cutter off Guam). `int()` raised
# and killed the entire day's ingest. One unparseable identifier must not cost
# 8.2 million good rows -- but it must not vanish silently either.


def test_a_malformed_mmsi_does_not_abort_the_whole_file(tmp_path: Path) -> None:
    from backend.ingest.ais.loader import iter_ais_records

    path = tmp_path / "day.csv"
    path.write_text(_csv_with_rows(["338926440", "G338926440", "367123456"]), encoding="utf-8")

    records = list(iter_ais_records(path))

    assert [r.mmsi for r in records] == [338926440, 367123456]


def test_skipped_rows_are_counted_not_silently_dropped(tmp_path: Path) -> None:
    """A silent drop hides a provider-format change as 'slightly less traffic'."""

    from backend.ingest.ais.loader import LoadStats, iter_ais_records

    path = tmp_path / "day.csv"
    path.write_text(_csv_with_rows(["338926440", "G338926440", "367123456"]), encoding="utf-8")

    stats = LoadStats()
    list(iter_ais_records(path, stats=stats))

    assert stats.total == 3
    assert stats.parsed == 2
    assert stats.skipped == 1
    assert stats.reasons


def test_strict_mode_still_raises(tmp_path: Path) -> None:
    """Fixture and regression data should fail loudly, not degrade quietly."""

    from backend.ingest.ais.loader import AisRowError, iter_ais_records

    path = tmp_path / "day.csv"
    path.write_text(_csv_with_rows(["338926440", "G338926440"]), encoding="utf-8")

    with pytest.raises(AisRowError, match="G338926440"):
        list(iter_ais_records(path, strict=True))


def test_the_error_names_the_row_and_the_offending_value(tmp_path: Path) -> None:
    from backend.ingest.ais.loader import AisRowError, iter_ais_records

    path = tmp_path / "day.csv"
    path.write_text(_csv_with_rows(["338926440", "G338926440"]), encoding="utf-8")

    with pytest.raises(AisRowError) as caught:
        list(iter_ais_records(path, strict=True))

    message = str(caught.value)
    assert "2" in message, "the row number is what makes an 8-million-row file debuggable"
