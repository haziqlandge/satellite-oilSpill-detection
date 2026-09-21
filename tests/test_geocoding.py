"""Geocoding must be reversible before SAR geometry is matched to AIS."""

from __future__ import annotations

from pathlib import Path

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


# --- the same invariant, on a real terrain-corrected product -----------------


def _processed_products() -> list[Path]:
    """Geocoded outputs of the SNAP chain, if any have been produced here."""

    return sorted(Path("data/processed/sar").glob("*_s0db.tif"))


@pytest.mark.skipif(not _processed_products(), reason="no processed scene on this machine")
def test_roundtrip_holds_on_a_real_terrain_corrected_scene() -> None:
    """PHASE-01's acceptance criterion, against SNAP's own geotransform.

    The synthetic test above proves the arithmetic inverts. It cannot prove that
    what Terrain-Correction actually wrote inverts -- that depends on the CRS
    and transform SNAP chose, which is exactly what silently reprojecting to a
    UTM zone would break. "A metre of geocoding error is a metre of error in
    proximity scoring, propagated silently into an accusation."
    """

    import rasterio

    for product in _processed_products():
        with rasterio.open(product) as dataset:
            require_wgs84(dataset.crs)
            width, height = dataset.width, dataset.height
            transform = dataset.transform

        # Corners, centre, and an off-grid interior point.
        samples = [
            (0.0, 0.0),
            (0.0, float(width - 1)),
            (float(height - 1), 0.0),
            (float(height - 1), float(width - 1)),
            (height / 2.0, width / 2.0),
            (height * 0.317, width * 0.733),
        ]

        error = max_roundtrip_error_px(transform, samples)
        assert error < 1.0, f"{product.name}: round-trip error {error} px exceeds 1 px"
