"""Tests for public STAC asset selection, with no network dependency."""

from __future__ import annotations

import pytest

from backend.ingest.sar.fetch import select_measurement_assets


def test_selects_vv_and_vh_assets_despite_key_convention() -> None:
    item = {
        "id": "S1A_TEST",
        "properties": {"datetime": "2023-05-15T00:02:00Z"},
        "assets": {
            "measurement-vv": {"href": "https://example.test/vv.tif"},
            "data_2": {"title": "VH backscatter", "href": "https://example.test/vh.tif"},
            "thumbnail": {"href": "https://example.test/thumb.jpg"},
        },
    }

    assets = select_measurement_assets(item)

    assert [(asset.polarization, asset.href) for asset in assets] == [
        ("VH", "https://example.test/vh.tif"),
        ("VV", "https://example.test/vv.tif"),
    ]


def test_rejects_items_without_measurements() -> None:
    with pytest.raises(ValueError, match="no VV/VH"):
        select_measurement_assets(
            {"id": "S1A_TEST", "properties": {"datetime": "2023-05-15T00:02:00Z"}, "assets": {}}
        )
