"""Two-pass detection, pass one: a decimated overview says which tiles to segment.

A full Sentinel-1 IW scene is 864 model tiles, and nearly all of them are open
sea with nothing dark in it. You cannot know which tiles hold a slick until
something looks, but the first look does not need full resolution: the scene
read at ~1/16 (about 150 m pixels, 2048 on the long side) shows every region
darker than its surroundings, and only the tiles over one go to the model
(`infer_scene(select=...)`, pass two, at native resolution).

THE RULE, fixed before it was measured against a full sweep:

  * **Relative, not absolute.** A pixel is a candidate when it is at least
    `CONTRAST_DB` below the mean backscatter of the sea around it
    (`BACKGROUND_KM`, averaged in linear power, where averaging radar power is
    arithmetic). Oil damps Bragg waves by several dB against the local sea; an
    absolute cut would instead select every calm patch, which is the model's
    worst look-alike (ISSUES Q5).
  * **Specks are not regions.** A candidate region is at least `MIN_PIXELS`
    overview pixels (~0.1 km2), so speckle surviving the average does not
    select a tile.
  * **Generous at the edges.** A region selects every tile its box, grown by
    `MARGIN_PX` overview pixels, touches, so a slick split by a tile seam
    reaches the model whole on at least one side, as the full sweep's overlap
    intends.

What it cannot see, said plainly: a slick narrower than an overview pixel
dilutes into the sea around it, and a calm region dark everywhere has no
contrast. What it misses against the full sweep is measured, per scene, in
`PREVIOUS_WORK.md`; never assumed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

OVERVIEW_PX = 2048
# At least 8 x 8 pixels to an overview pixel, whatever the raster's size: 64 looks
# take single-look speckle from ~4.3 dB to ~0.5 dB, so a 2 dB region is not noise.
MIN_FACTOR = 8
BACKGROUND_KM = 10.0
CONTRAST_DB = 2.0
MIN_PIXELS = 4
MARGIN_PX = 2
KM_PER_DEG_LAT = 110.574


@dataclass(frozen=True, slots=True)
class Screen:
    """Which tiles pass one sends to the model, and why."""

    factor: int
    overview_shape: tuple[int, int]
    regions: int
    dark_fraction: float
    #: (row_off, col_off) of every selected tile window, full resolution.
    selected: frozenset[tuple[int, int]]
    tiles: int
    #: Candidate region boxes, full-resolution pixels (col0, row0, col1, row1).
    boxes: tuple[tuple[int, int, int, int], ...]

    def admits(self, tile: Any) -> bool:
        return (int(tile.window.row_off), int(tile.window.col_off)) in self.selected

    def as_dict(self) -> dict[str, object]:
        return {
            "rule": (
                f"overview at 1/{self.factor}; a region at least {CONTRAST_DB} dB below the mean of the "
                f"sea within {BACKGROUND_KM:g} km, at least {MIN_PIXELS} overview pixels; every tile its "
                f"box (+{MARGIN_PX} px) touches goes to the model"
            ),
            "factor": self.factor,
            "overview": list(self.overview_shape),
            "regions": self.regions,
            "darkFraction": round(self.dark_fraction, 5),
            "tilesSelected": len(self.selected),
            "tiles": self.tiles,
        }


def read_overview(path: Path, band: int, *, long_side: int = OVERVIEW_PX) -> tuple[np.ndarray, int, Any]:
    """The band averaged down to at most `long_side` pixels, in linear power; NaN where no data.

    SNAP's zero fill and non-finite pixels are no-data, as in `infer_scene`.
    Averaging happens in linear power -- an arithmetic mean of radar power --
    by reading at full resolution in strips, never by resampling the dB values.
    """
    import rasterio
    from rasterio.windows import Window

    with rasterio.open(path) as source:
        width, height = source.width, source.height
        factor = max(MIN_FACTOR, math.ceil(max(width, height) / long_side))
        out_h, out_w = math.ceil(height / factor), math.ceil(width / factor)
        power_sum = np.zeros((out_h, out_w), dtype=np.float64)
        count = np.zeros((out_h, out_w), dtype=np.int64)
        strip = factor * max(1, 256 // factor)
        for row0 in range(0, height, strip):
            rows = min(strip, height - row0)
            data = source.read(band, window=Window(0, row0, width, rows)).astype(np.float64)
            valid = np.isfinite(data) & (data != 0)
            power = np.where(valid, 10.0 ** (np.where(valid, data, 0.0) / 10.0), 0.0)
            pad_r = (-rows) % factor
            pad_c = (-width) % factor
            if pad_r or pad_c:
                power = np.pad(power, ((0, pad_r), (0, pad_c)))
                valid = np.pad(valid, ((0, pad_r), (0, pad_c)))
            r0 = row0 // factor
            blocks_r = power.shape[0] // factor
            shaped = (blocks_r, factor, power.shape[1] // factor, factor)
            power_sum[r0:r0 + blocks_r] += power.reshape(shaped).sum(axis=(1, 3))
            count[r0:r0 + blocks_r] += valid.reshape(shaped).sum(axis=(1, 3))
        transform = source.transform
    with np.errstate(invalid="ignore", divide="ignore"):
        overview = np.where(count > 0, power_sum / np.maximum(count, 1), np.nan)
    return overview, factor, transform


def screen_overview(
    overview: np.ndarray,
    factor: int,
    *,
    width: int,
    height: int,
    tile_size: int,
    overlap: float,
    pixel_deg: float,
    lat: float,
) -> Screen:
    """Pass one on an overview in linear power: candidate regions, then the tiles they touch."""
    from scipy import ndimage

    from backend.ingest.sar.tiling import iter_tiles

    valid = np.isfinite(overview)
    power = np.where(valid, overview, 0.0)
    # A square filter over pixels that are narrower east-west by cos(lat): sized
    # on the geometric mean of the two pixel sides.
    km_per_px = pixel_deg * factor * KM_PER_DEG_LAT * math.sqrt(math.cos(math.radians(lat)))
    size = max(3, round(BACKGROUND_KM / max(km_per_px, 1e-6)) | 1)
    total = ndimage.uniform_filter(power, size=size, mode="nearest")
    weight = ndimage.uniform_filter(valid.astype(np.float64), size=size, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        background = np.where(weight > 0.05, total / weight, np.nan)
        dark = valid & np.isfinite(background) & (power < background * 10.0 ** (-CONTRAST_DB / 10.0))

    labels, n = ndimage.label(dark)
    boxes: list[tuple[int, int, int, int]] = []
    if n:
        sizes = ndimage.sum(dark, labels, index=np.arange(1, n + 1))
        for index, found in enumerate(ndimage.find_objects(labels)):
            if found is None or sizes[index] < MIN_PIXELS:
                continue
            rs, cs = found
            r0 = max(0, rs.start - MARGIN_PX) * factor
            c0 = max(0, cs.start - MARGIN_PX) * factor
            r1 = min(overview.shape[0], rs.stop + MARGIN_PX) * factor
            c1 = min(overview.shape[1], cs.stop + MARGIN_PX) * factor
            boxes.append((c0, r0, min(c1, width), min(r1, height)))

    tiles = list(iter_tiles(width, height, tile_size=tile_size, overlap=overlap))
    selected: set[tuple[int, int]] = set()
    for tile in tiles:
        w = tile.window
        tc0, tr0 = int(w.col_off), int(w.row_off)
        tc1, tr1 = tc0 + int(w.width), tr0 + int(w.height)
        if any(c0 < tc1 and tc0 < c1 and r0 < tr1 and tr0 < r1 for c0, r0, c1, r1 in boxes):
            selected.add((tr0, tc0))
    return Screen(
        factor=factor,
        overview_shape=(int(overview.shape[0]), int(overview.shape[1])),
        regions=len(boxes),
        dark_fraction=float(dark.sum() / max(1, valid.sum())),
        selected=frozenset(selected),
        tiles=len(tiles),
        boxes=tuple(boxes),
    )


def screen_raster(path: Path, band: int, *, tile_size: int, overlap: float) -> Screen:
    """Pass one on a raster on disk."""
    import rasterio

    overview, factor, transform = read_overview(path, band)
    with rasterio.open(path) as source:
        width, height = source.width, source.height
        bounds = source.bounds
    return screen_overview(
        overview, factor, width=width, height=height, tile_size=tile_size, overlap=overlap,
        pixel_deg=abs(transform.e), lat=(bounds.top + bounds.bottom) / 2,
    )
