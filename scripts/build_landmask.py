"""Build the frontend's land mask from the coastline the drift physics uses.

WHAT THIS REPLACES. The previous version of this script sampled the Esri Ocean
basemap tiles and classified pixels on blue-minus-red. That produced a mask for
three hand-drawn boxes and nothing else, so an upload anywhere outside them --
Bali, Java, the Red Sea, most of the corpus -- drifted and drew AIS lanes over
land. It also classified a *picture* of a coastline, and it disagreed with the
backend at the shore: OpenDrift strands and slides parcels against GSHHG, the
frontend tested them against pixel colour, and `overlayFrames` had to nudge up
to a third of the rendered parcels off the beach to hide the difference.

WHAT THIS DOES. It rasterises the GSHHG full-resolution shoreline -- the exact
polygons OpenDrift's `reader_global_landmask` answers from, taken from the same
`roaring_landmask` package, not a second download of a different product --
onto a global grid of 1/240 degree cells, which is also the grid of
roaring_landmask's own raster. One coastline, one grid, for both halves of the
system. The backend's point-in-polygon answer is authoritative; this raster is
that answer sampled at cell centres, and `tests/test_landmask.py` checks the
two agree.

Natural Earth was the other candidate and was rejected deliberately: it would
have been a third coastline, coarser than both the physics and the basemap, and
the frontend/backend disagreement would have been documented rather than
removed.

OUTPUT, in two parts:

* `frontDemo/public/landmask/band_<row>.bin` -- every 5 degree tile that holds
  both land and water, packed one file per 5 degree latitude band, row 00 at
  the south pole. Fetched on
  demand for an upload, from this project's own static files: no third-party
  service is consulted at runtime.
* `frontDemo/src/sim/landmask.generated.ts` -- the kind of every tile on Earth
  (all water, all land, or mixed), so open ocean and continental interiors are
  answered synchronously everywhere; plus the mixed tiles that the authored
  scenarios and samples need, bundled so they run synchronously at load.

A tile is 1200 x 1200 cells, row-major from its south-west corner, run-length
encoded: alternating water/land run lengths starting with water, each an
unsigned LEB128 varint. The TypeScript decoder is `decodeTile` in
`frontDemo/src/sim/landmask.ts`; `decode_tile` here is its twin.

The data is GSHHG (Wessel & Smith), distributed under the LGPL; see
https://www.soest.hawaii.edu/pwessel/gshhg/.

About four minutes for the globe. Run:

    .venv/Scripts/python.exe -m scripts.build_landmask
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import struct
import time
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path

import numpy as np

from backend.config import REPO_ROOT

CELLS_PER_DEG = 240
TILE_DEG = 5
TILE_CELLS = TILE_DEG * CELLS_PER_DEG
TILE_COLS = 360 // TILE_DEG
TILE_ROWS = 180 // TILE_DEG

WATER, LAND, MIXED = "0", "1", "2"
BAND_MAGIC = b"LMB1"

PUBLIC_DIR = REPO_ROOT / "frontDemo" / "public" / "landmask"
OUT = REPO_ROOT / "frontDemo" / "src" / "sim" / "landmask.generated.ts"


@dataclass(frozen=True)
class Region:
    """An area whose mixed tiles are bundled so it resolves synchronously."""

    name: str
    west: float
    south: float
    east: float
    north: float


# Every authored scene and sample theatre, padded to cover its drift envelope
# and shipping lanes. The runs for these are built synchronously as the page
# loads, before anything could be fetched, so their tiles ship in the bundle.
# The boxes are the region registry's `landmask` extents (`backend/regions.py`).
def _bundled() -> tuple[Region, ...]:
    from backend.regions import box, regions

    return tuple(Region(entry["id"], *box(entry, "landmask")) for entry in regions() if "landmask" in entry)


BUNDLED = _bundled()


def tile_index(row: int, col: int) -> int:
    return row * TILE_COLS + col


def tiles_for(region: Region) -> set[int]:
    rows = range(int((region.south + 90) // TILE_DEG), int((region.north + 90) // TILE_DEG) + 1)
    cols = range(int((region.west + 180) // TILE_DEG), int((region.east + 180) // TILE_DEG) + 1)
    return {tile_index(r, c) for r in rows for c in cols}


def encode_tile(grid: np.ndarray) -> bytes:
    """Run-length encode a boolean tile, row-major from its south-west corner.

    Vectorised, because a pure-Python loop over a few million runs is what made
    the first attempt at this take the better part of an hour.
    """
    flat = np.ascontiguousarray(grid, dtype=bool).ravel()
    change = np.flatnonzero(flat[1:] != flat[:-1]) + 1
    runs = np.diff(np.concatenate(([0], change, [flat.size]))).astype(np.int64)
    if flat[0]:
        runs = np.concatenate(([0], runs))  # the stream always opens with water

    width = np.ones(runs.size, dtype=np.int64)
    rest = runs >> 7
    while rest.any():
        width += rest > 0
        rest >>= 7
    starts = np.concatenate(([0], np.cumsum(width)[:-1]))
    out = np.zeros(int(width.sum()), dtype=np.uint8)
    for byte in range(int(width.max())):
        sel = width > byte
        value = (runs[sel] >> (7 * byte)) & 0x7F
        more = np.where(width[sel] > byte + 1, 0x80, 0)
        out[starts[sel] + byte] = value | more
    return out.tobytes()


def decode_tile(data: bytes, cells: int = TILE_CELLS * TILE_CELLS) -> np.ndarray:
    """The inverse of `encode_tile`, as a flat boolean array."""
    out = np.zeros(cells, dtype=bool)
    position = 0
    land = False
    shift = 0
    run = 0
    for byte in data:
        run |= (byte & 0x7F) << shift
        if byte & 0x80:
            shift += 7
            continue
        if land:
            out[position : position + run] = True
        position += run
        land = not land
        run = 0
        shift = 0
    if position != cells:
        raise ValueError(f"tile decodes to {position} cells, expected {cells}")
    return out


def pack_band(tiles: list[tuple[int, bytes]]) -> bytes:
    """One latitude band's mixed tiles: magic, count, (col, offset, length)..., payload."""
    header = bytearray(BAND_MAGIC)
    header += struct.pack("<H", len(tiles))
    offset = 0
    for col, data in tiles:
        header += struct.pack("<BII", col, offset, len(data))
        offset += len(data)
    return bytes(header) + b"".join(data for _, data in tiles)


def unpack_band(blob: bytes) -> dict[int, bytes]:
    if blob[:4] != BAND_MAGIC:
        raise ValueError("not a land-mask band file")
    (count,) = struct.unpack_from("<H", blob, 4)
    base = 6 + count * 9
    tiles = {}
    for i in range(count):
        col, offset, length = struct.unpack_from("<BII", blob, 6 + i * 9)
        tiles[col] = blob[base + offset : base + offset + length]
    return tiles


def band_path(row: int) -> Path:
    """By row index, 00 at the south pole. A signed latitude would put `+` in a URL."""
    return PUBLIC_DIR / f"band_{row:02d}.bin"


def load_polygons():  # type: ignore[no-untyped-def]
    import roaring_landmask
    import shapely

    wkb = roaring_landmask.Shapes.wkb(roaring_landmask.LandmaskProvider.Gshhg)
    polygons = shapely.get_parts(shapely.from_wkb(wkb))
    source = {
        "package": f"roaring_landmask {metadata.version('roaring_landmask')}",
        "polygons": int(polygons.size),
        "vertices": int(shapely.get_num_coordinates(polygons).sum()),
        "sha256": hashlib.sha256(wkb).hexdigest()[:16],
    }
    return polygons, source


def rasterise_band(tree, polygons, row: int) -> np.ndarray:  # type: ignore[no-untyped-def]
    """Land for one 5 degree latitude band, row 0 at its southern edge.

    The whole band is filled in one GDAL call. Clipping the continental
    polygons per tile instead is O(vertices) per tile, and Eurasia alone is
    over a million vertices touching hundreds of tiles.

    A cell is land when its CENTRE is inside a polygon (GDAL's default rule),
    which is the same question `roaring_landmask.contains` answers for a point.
    """
    import shapely
    from rasterio.features import rasterize
    from rasterio.transform import from_origin

    south = row * TILE_DEG - 90
    band = shapely.box(-180, south, 180, south + TILE_DEG)
    hits = tree.query(band, predicate="intersects")
    if hits.size == 0:
        return np.zeros((TILE_CELLS, 360 * CELLS_PER_DEG), dtype=bool)
    grid = rasterize(
        ((polygons[i], 1) for i in hits),
        out_shape=(TILE_CELLS, 360 * CELLS_PER_DEG),
        transform=from_origin(-180, south + TILE_DEG, 1 / CELLS_PER_DEG, 1 / CELLS_PER_DEG),
        fill=0,
        dtype="uint8",
    )
    return np.asarray(grid[::-1], dtype=bool)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rows",
        help="comma-separated band rows to rebuild (0 = -90..-85); default all",
    )
    args = parser.parse_args()

    from shapely.strtree import STRtree

    started = time.time()
    polygons, source = load_polygons()
    tree = STRtree(polygons)
    print(
        f"GSHHG full: {source['polygons']:,} polygons, {source['vertices']:,} vertices "
        f"({source['package']}), loaded in {time.time() - started:.1f}s",
        flush=True,
    )

    rows = [int(r) for r in args.rows.split(",")] if args.rows else list(range(TILE_ROWS))
    kinds = [WATER] * (TILE_ROWS * TILE_COLS)
    bundled_wanted = set().union(*(tiles_for(region) for region in BUNDLED))
    bundled: dict[int, bytes] = {}
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    total_bytes = 0
    for row in rows:
        tick = time.time()
        grid = rasterise_band(tree, polygons, row)
        mixed: list[tuple[int, bytes]] = []
        for col in range(TILE_COLS):
            tile = grid[:, col * TILE_CELLS : (col + 1) * TILE_CELLS]
            index = tile_index(row, col)
            if not tile.any():
                continue
            if tile.all():
                kinds[index] = LAND
                continue
            kinds[index] = MIXED
            data = encode_tile(tile)
            mixed.append((col, data))
            if index in bundled_wanted:
                bundled[index] = data
        path = band_path(row)
        if mixed:
            blob = pack_band(mixed)
            path.write_bytes(blob)
            total_bytes += len(blob)
        elif path.exists():
            path.unlink()
        land_tiles = sum(kinds[tile_index(row, c)] == LAND for c in range(TILE_COLS))
        print(
            f"  band {row * TILE_DEG - 90:+03d}..{row * TILE_DEG - 85:+03d}: "
            f"{len(mixed):2d} mixed, {land_tiles:2d} all-land, "
            f"{sum(len(d) for _, d in mixed) / 1024:6.1f} KB  ({time.time() - tick:.1f}s)",
            flush=True,
        )

    if args.rows:
        # A partial rebuild cannot rewrite the global index without the other
        # rows' kinds, and guessing them would ship a wrong index.
        print("partial rebuild: band files written, generated index left untouched")
        return 0

    entries = "\n".join(
        f'  [{index}, "{base64.b64encode(data).decode("ascii")}"],'
        for index, data in sorted(bundled.items())
    )
    OUT.write_text(
        "/* Generated by scripts/build_landmask.py -- do not edit.\n"
        " *\n"
        " * GSHHG full-resolution shoreline, the polygons OpenDrift's landmask answers\n"
        f" * from ({source['package']}: {source['polygons']:,} polygons,\n"
        f" * {source['vertices']:,} vertices, WKB sha256 {source['sha256']}), rasterised\n"
        f" * at 1/{CELLS_PER_DEG} degree with a cell counted as land when its centre is.\n"
        " * GSHHG is Wessel & Smith, LGPL.\n"
        " *\n"
        f" * TILE_KINDS holds one character per {TILE_DEG} degree tile, row-major from\n"
        " * (-180, -90): 0 all water, 1 all land, 2 mixed. Mixed tiles are fetched from\n"
        " * public/landmask/ on demand; the ones authored scenes need are bundled\n"
        " * below as [tile index, base64 run-length stream].\n"
        " */\n\n"
        f"export const CELLS_PER_DEG = {CELLS_PER_DEG};\n"
        f"export const TILE_DEG = {TILE_DEG};\n"
        f'export const LANDMASK_SOURCE = "GSHHG full ({source["package"]}, sha256 {source["sha256"]})";\n\n'
        f'export const TILE_KINDS =\n  "{"".join(kinds)}";\n\n'
        "export const BUNDLED_TILES: [number, string][] = [\n" + entries + "\n];\n",
        encoding="utf-8",
    )
    print(
        f"{kinds.count(MIXED)} mixed tiles in {sum(1 for r in range(TILE_ROWS) if band_path(r).exists())} "
        f"band files, {total_bytes / 1e6:.2f} MB; {len(bundled)} bundled "
        f"({OUT.stat().st_size / 1024:.0f} KB generated). {time.time() - started:.0f}s total."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
