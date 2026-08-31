"""Write overlapping georeferenced SAR tiles without losing pixel↔geo mapping."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import rasterio
from rasterio.windows import Window
from rasterio.windows import transform as window_transform


@dataclass(frozen=True, slots=True)
class Tile:
    """A source-raster window and its deterministic output name."""

    row: int
    col: int
    window: Window

    @property
    def filename(self) -> str:
        return f"tile_r{self.row:05d}_c{self.col:05d}.tif"


def _starts(length: int, tile_size: int, stride: int) -> list[int]:
    if length <= tile_size:
        return [0]
    starts = list(range(0, length - tile_size + 1, stride))
    last = length - tile_size
    if starts[-1] != last:
        starts.append(last)
    return starts


def iter_tiles(
    width: int, height: int, *, tile_size: int = 1024, overlap: float = 0.1
) -> Iterator[Tile]:
    """Cover a raster with fixed-size overlapping windows, including both edges."""

    if width <= 0 or height <= 0:
        raise ValueError("raster dimensions must be positive")
    if tile_size <= 0:
        raise ValueError("tile_size must be positive")
    if not 0 <= overlap < 1:
        raise ValueError("overlap must be in [0, 1)")
    stride = max(1, round(tile_size * (1 - overlap)))
    for row, row_offset in enumerate(_starts(height, tile_size, stride)):
        for col, col_offset in enumerate(_starts(width, tile_size, stride)):
            yield Tile(
                row=row,
                col=col,
                window=Window(
                    col_off=col_offset,
                    row_off=row_offset,
                    width=min(tile_size, width - col_offset),
                    height=min(tile_size, height - row_offset),
                ),
            )


def write_tiles(
    source_path: Path, output_dir: Path, *, tile_size: int = 1024, overlap: float = 0.1
) -> list[Path]:
    """Write GeoTIFF tiles retaining the source CRS and per-window transform."""

    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    with rasterio.open(source_path) as source:
        if source.crs is None:
            raise ValueError("source raster has no CRS")
        for tile in iter_tiles(source.width, source.height, tile_size=tile_size, overlap=overlap):
            profile = source.profile.copy()
            profile.update(
                width=int(tile.window.width),
                height=int(tile.window.height),
                transform=window_transform(tile.window, source.transform),
                driver="GTiff",
            )
            output_path = output_dir / tile.filename
            with rasterio.open(output_path, "w", **profile) as destination:
                destination.write(source.read(window=tile.window))
            outputs.append(output_path)
    return outputs
