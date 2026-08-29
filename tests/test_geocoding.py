"""Geocoding must be reversible before SAR geometry is matched to AIS."""

from __future__ import annotations

import pytest
from rasterio.crs import CRS
from rasterio.transform import from_origin

from backend.ingest.sar.geo import (
    GeocodingError,
    max_roundtrip_error_px,
    pixel_to_lonlat,
    require_wgs84,
)


def test_pixel_geo_pixel_roundtrip_is_well_below_one_pixel() -> None:
    transform = from_origin(-91.0, 30.0, 0.0001, 0.0001)
    samples = [(0.0, 0.0), (10.25, 75.5), (1023.0, 1023.0)]

    assert max_roundtrip_error_px(transform, samples) < 1e-8
    assert pixel_to_lonlat(transform, 0, 0) == pytest.approx((-90.99995, 29.99995))


def test_only_epsg_4326_is_accepted_for_ais_overlay() -> None:
    require_wgs84(CRS.from_epsg(4326))
    with pytest.raises(GeocodingError, match="EPSG:4326"):
        require_wgs84(CRS.from_epsg(32615))
