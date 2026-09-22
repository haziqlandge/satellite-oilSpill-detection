"""Build the land mask the drift simulation needs, from the basemap it draws on.

The project carries no coastline geometry, which is why backward drift used to
reconstruct origins on top of Louisiana and the Kutch peninsula: the integrator
was a random walk on an unbounded plane and nothing in it knew where the water
stopped. `frontDemo/src/sim/scenarios.ts` records the technique that solved the
same problem for AIS corridors by hand -- sample the Esri `Ocean/World_Ocean_Base`
tiles and classify on `blue - red`, because water is blue-dominant and land is a
near-white cream. This script is that method, run over whole boxes instead of
single points, and its output is the mask the integrator tests against.

Calibrated 2026-09-22 against the documented figures and reproducing them:

    open Gulf   (-89.28, 28.28)  rgb(174,204,232)  blue-red  +58
    delta land  (-89.42, 29.33)  rgb(233,235,222)  blue-red  -11

The gap is wide, so the threshold sits at +12 as recorded. Deriving the mask
from the very basemap the operator is looking at is the point: a mask from some
other coastline product would disagree with the rendered shoreline at exactly
the zoom levels where the disagreement is visible.

Cells are 0.005 degrees, about 550 m, which resolves the Mississippi passes and
the Gulf of Kutch well enough for a cloud whose own scale is kilometres. A cell
counts as land when at least half of its source pixels are land, so a narrow
channel survives rather than being sealed by a single pixel of levee.

Tiles are cached on disk, so a re-run costs nothing. Run:

    .venv/Scripts/python.exe -m scripts.build_landmask
"""

from __future__ import annotations

import argparse
import base64
import io
import math
import urllib.error
import urllib.request
from dataclasses import dataclass

import numpy as np
from PIL import Image

from backend.config import REPO_ROOT

TILE_URL = (
    "https://services.arcgisonline.com/ArcGIS/rest/services"
    "/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"
)
ZOOM = 10
TILE_PX = 256
# Documented in scenarios.ts: water runs +36..+58, land -3..-11.
WATER_THRESHOLD = 12
CELL_DEG = 0.005

OUT = REPO_ROOT / "frontDemo" / "src" / "sim" / "landmask.generated.ts"
CACHE = REPO_ROOT / "data" / "interim" / "basemap-tiles"


@dataclass(frozen=True)
class Box:
    """A named area to mask. Anything outside every box is treated as water."""

    name: str
    west: float
    south: float
    east: float
    north: float


# Chosen to cover each scene's full drift envelope, not just its centre -- the
# backward field is widest at the far end of the horizon, which is where it used
# to end up ashore.
BOXES = (
    Box("gulf-of-mexico", -91.2, 27.5, -88.6, 29.9),
    Box("kutch", 67.0, 21.0, 70.6, 23.4),
    Box("mumbai", 70.8, 18.6, 73.2, 20.4),
)


def lon_to_tile_x(lon: float, zoom: int) -> float:
    return (lon + 180.0) / 360.0 * (2**zoom)


def lat_to_tile_y(lat: float, zoom: int) -> float:
    radians = math.radians(lat)
    return (1 - math.log(math.tan(radians) + 1 / math.cos(radians)) / math.pi) / 2 * (2**zoom)




def fetch_tile(z: int, x: int, y: int) -> Image.Image:
    path = CACHE / f"{z}_{x}_{y}.png"
    if path.exists():
        return Image.open(path).convert("RGB")
    url = TILE_URL.format(z=z, x=x, y=y)
    request = urllib.request.Request(url, headers={"User-Agent": "slicktrace-landmask/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return Image.open(io.BytesIO(payload)).convert("RGB")


def land_for_box(box: Box) -> tuple[int, int, np.ndarray]:
    """A boolean land grid for `box`, sampled from the basemap tiles.

    Sampling is done per cell centre against the tile pixel that contains it,
    then a cell is land when at least half of its samples are. Working cell-wise
    rather than stitching whole tiles keeps the Mercator distortion handled in
    one place -- the cell grid is uniform in degrees, the tiles are not.
    """
    nx = round((box.east - box.west) / CELL_DEG)
    ny = round((box.north - box.south) / CELL_DEG)

    # Every tile the box touches, fetched once.
    x0 = math.floor(lon_to_tile_x(box.west, ZOOM))
    x1 = math.floor(lon_to_tile_x(box.east, ZOOM))
    y0 = math.floor(lat_to_tile_y(box.north, ZOOM))
    y1 = math.floor(lat_to_tile_y(box.south, ZOOM))
    tiles: dict[tuple[int, int], np.ndarray] = {}
    total = (x1 - x0 + 1) * (y1 - y0 + 1)
    for index, tx in enumerate(range(x0, x1 + 1)):
        for ty in range(y0, y1 + 1):
            try:
                tiles[(tx, ty)] = np.asarray(fetch_tile(ZOOM, tx, ty), dtype=np.int16)
            except urllib.error.URLError as error:
                raise SystemExit(f"{box.name}: tile {ZOOM}/{tx}/{ty} unavailable: {error}") from error
        print(f"  {box.name}: column {index + 1}/{x1 - x0 + 1} ({total} tiles)", flush=True)

    # Two samples per cell in each direction, so a cell is decided by four
    # points rather than one and a single levee pixel cannot seal a channel.
    grid = np.zeros((ny, nx), dtype=bool)
    offsets = (0.25, 0.75)
    for row in range(ny):
        for col in range(nx):
            land_votes = 0
            for fy in offsets:
                lat = box.south + (row + fy) * CELL_DEG
                ty_f = lat_to_tile_y(lat, ZOOM)
                ty = math.floor(ty_f)
                py = min(TILE_PX - 1, int((ty_f - ty) * TILE_PX))
                for fx in offsets:
                    lon = box.west + (col + fx) * CELL_DEG
                    tx_f = lon_to_tile_x(lon, ZOOM)
                    tx = math.floor(tx_f)
                    px = min(TILE_PX - 1, int((tx_f - tx) * TILE_PX))
                    tile = tiles.get((tx, ty))
                    if tile is None:
                        continue
                    pixel = tile[py, px]
                    if int(pixel[2]) - int(pixel[0]) < WATER_THRESHOLD:
                        land_votes += 1
            grid[row, col] = land_votes >= 2
    return nx, ny, grid


def pack(grid: np.ndarray) -> str:
    """Row-major bits, LSB first within each byte, base64 for the bundle."""
    return base64.b64encode(np.packbits(grid.ravel(), bitorder="little").tobytes()).decode("ascii")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="build a single box by name")
    args = parser.parse_args()

    boxes = [b for b in BOXES if not args.only or b.name == args.only]
    entries = []
    for box in boxes:
        print(f"{box.name}: {box.west},{box.south} .. {box.east},{box.north}", flush=True)
        nx, ny, grid = land_for_box(box)
        land = int(grid.sum())
        print(f"  {nx} x {ny} cells, {land} land ({100 * land / grid.size:.1f}%)", flush=True)
        entries.append(
            "  {\n"
            f'    name: "{box.name}",\n'
            f"    west: {box.west}, south: {box.south}, east: {box.east}, north: {box.north},\n"
            f"    nx: {nx}, ny: {ny}, cell: {CELL_DEG},\n"
            f'    bits: "{pack(grid)}",\n'
            "  },"
        )

    OUT.write_text(
        "/* Generated by scripts/build_landmask.py -- do not edit.\n"
        " *\n"
        " * Land sampled from the Esri Ocean basemap the map itself draws, classified\n"
        " * on blue-red with the threshold recorded in scenarios.ts. Cells are\n"
        f" * {CELL_DEG} degrees (~550 m), row-major from the south-west corner, one bit\n"
        " * per cell, LSB first, base64. A point outside every box is open water.\n"
        " */\n\n"
        "export interface LandBox {\n"
        "  name: string;\n"
        "  west: number; south: number; east: number; north: number;\n"
        "  nx: number; ny: number; cell: number;\n"
        "  bits: string;\n"
        "}\n\n"
        "export const LAND_BOXES: LandBox[] = [\n" + "\n".join(entries) + "\n];\n",
        encoding="utf-8",
    )
    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(REPO_ROOT)} ({size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
