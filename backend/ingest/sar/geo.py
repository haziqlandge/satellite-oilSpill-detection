"""Pixel/coordinate conversion helpers for EPSG:4326 SAR rasters."""

from __future__ import annotations

from collections.abc import Iterable

from affine import Affine
from rasterio.crs import CRS


class GeocodingError(ValueError):
    """Raised when a raster cannot safely be used for SAR/AIS matching."""


def require_wgs84(crs: CRS | None) -> None:
    """Reject an output that is not explicitly geographic WGS84."""

    if crs is None or crs.to_epsg() != 4326:
        actual = crs.to_string() if crs is not None else "missing"
        raise GeocodingError(f"expected EPSG:4326 geocoding, got {actual}")


def pixel_to_lonlat(transform: Affine, row: float, col: float) -> tuple[float, float]:
    """Map a pixel centre to ``(longitude, latitude)`` with no integer rounding."""

    lon, lat = transform @ (col + 0.5, row + 0.5)
    return float(lon), float(lat)


def lonlat_to_pixel(transform: Affine, lon: float, lat: float) -> tuple[float, float]:
    """Map WGS84 coordinates back to floating-point ``(row, col)`` pixel indices."""

    col_centre, row_centre = ~transform @ (lon, lat)
    return float(row_centre - 0.5), float(col_centre - 0.5)


def max_roundtrip_error_px(
    transform: Affine, pixels: Iterable[tuple[float, float]]
) -> float:
    """Return the maximum pixel→geo→pixel Euclidean error in pixels."""

    maximum = 0.0
    for row, col in pixels:
        lon, lat = pixel_to_lonlat(transform, row, col)
        output_row, output_col = lonlat_to_pixel(transform, lon, lat)
        maximum = max(maximum, ((row - output_row) ** 2 + (col - output_col) ** 2) ** 0.5)
    return maximum
