"""Tiling preserves coverage and geographic placement."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from backend.ingest.sar.tiling import iter_tiles, write_tiles


def test_tiles_cover_source_extent_without_gaps() -> None:
    tiles = list(iter_tiles(10, 9, tile_size=4, overlap=0.25))
    coverage = np.zeros((9, 10), dtype=bool)
    for tile in tiles:
        row, col = int(tile.window.row_off), int(tile.window.col_off)
        height, width = int(tile.window.height), int(tile.window.width)
        coverage[row : row + height, col : col + width] = True

    assert coverage.all()
    assert tiles[-1].window.col_off + tiles[-1].window.width == 10
    assert tiles[-1].window.row_off + tiles[-1].window.height == 9


def test_written_tile_keeps_its_window_transform(tmp_path: Path) -> None:
    source = tmp_path / "source.tif"
    data = np.arange(36, dtype="float32").reshape(1, 6, 6)
    with rasterio.open(
        source,
        "w",
        driver="GTiff",
        width=6,
        height=6,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=from_origin(-91, 30, 0.01, 0.01),
    ) as destination:
        destination.write(data)

    paths = write_tiles(source, tmp_path / "tiles", tile_size=4, overlap=0.25)

    assert len(paths) == 4
    with rasterio.open(paths[-1]) as tile:
        assert tile.crs.to_epsg() == 4326
        assert tile.transform == from_origin(-90.98, 29.98, 0.01, 0.01)
        assert tile.read(1)[0, 0] == 14
