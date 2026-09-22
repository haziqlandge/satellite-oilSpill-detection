"""The frontend land mask, and whether it agrees with the coastline OpenDrift uses.

The frontend and the backend used to disagree about where the shore was -- one
classified basemap pixel colour, the other tested GSHHG polygons -- and a third
of some real runs' parcels had to be nudged off the beach to hide it. The mask
is now GSHHG itself, rasterised; the last test here is what keeps that true.
"""

from __future__ import annotations

import re

import numpy as np
import pytest

from scripts.build_landmask import (
    BUNDLED,
    CELLS_PER_DEG,
    OUT,
    TILE_CELLS,
    TILE_COLS,
    TILE_DEG,
    TILE_ROWS,
    band_path,
    decode_tile,
    encode_tile,
    pack_band,
    tiles_for,
    unpack_band,
)


@pytest.mark.parametrize(
    "case",
    ["random", "block", "opens-on-land", "single-cell", "all-water-but-last"],
)
def test_tile_encoding_round_trips(case: str) -> None:
    rng = np.random.default_rng(0)
    grid = np.zeros((TILE_CELLS, TILE_CELLS), dtype=bool)
    if case == "random":
        grid = rng.random(grid.shape) < 0.5
    elif case == "block":
        grid[100:900, 300:1100] = True
    elif case == "opens-on-land":
        grid[:] = True
        grid[-1, -1] = False
    elif case == "single-cell":
        grid[0, 0] = True
    else:
        grid[-1, -1] = True
    assert np.array_equal(decode_tile(encode_tile(grid)), grid.ravel())


def test_decode_refuses_a_truncated_tile() -> None:
    grid = np.zeros((TILE_CELLS, TILE_CELLS), dtype=bool)
    grid[5:10, 5:10] = True
    with pytest.raises(ValueError, match="decodes to"):
        decode_tile(encode_tile(grid)[:-1])


def test_band_packing_round_trips() -> None:
    assert unpack_band(pack_band([(3, b"ab"), (70, b"cde")])) == {3: b"ab", 70: b"cde"}


def _generated() -> tuple[str, dict[int, bytes]]:
    import base64

    if not OUT.exists():
        pytest.skip("landmask.generated.ts not built")
    text = OUT.read_text(encoding="utf-8")
    kinds = re.search(r'TILE_KINDS =\s*"([012]+)"', text)
    assert kinds, "TILE_KINDS missing from the generated module"
    bundled = {
        int(index): base64.b64decode(data)
        for index, data in re.findall(r'\[(\d+), "([A-Za-z0-9+/=]+)"\]', text)
    }
    return kinds.group(1), bundled


def test_index_and_band_files_describe_the_same_tiles() -> None:
    kinds, bundled = _generated()
    assert len(kinds) == TILE_ROWS * TILE_COLS
    for row in range(TILE_ROWS):
        mixed = {col for col in range(TILE_COLS) if kinds[row * TILE_COLS + col] == "2"}
        path = band_path(row)
        on_disk = set(unpack_band(path.read_bytes())) if path.exists() else set()
        assert on_disk == mixed, f"band {row}: index and file disagree"

    # Every authored region's coastal tiles ship in the bundle, byte-identical
    # to the fetched copy, so a scene never runs against a half-loaded coast.
    wanted = {i for region in BUNDLED for i in tiles_for(region) if kinds[i] == "2"}
    assert wanted == set(bundled)
    for index, data in bundled.items():
        assert unpack_band(band_path(index // TILE_COLS).read_bytes())[index % TILE_COLS] == data


# Places where getting it wrong has already cost something: the delta the
# first hindcast reconstructed onto, and the islands uploads drifted across.
AGREEMENT_SITES = {
    "Mississippi delta": (-89.4, 29.3),
    "Bali and Lombok": (115.5, -8.5),
    "Java north coast": (110.5, -6.8),
    "Gulf of Kutch": (69.5, 22.5),
    "Red Sea": (39.2, 20.2),
}


@pytest.mark.parametrize("site", sorted(AGREEMENT_SITES))
def test_frontend_mask_agrees_with_opendrift(site: str) -> None:
    """Sampled at cell centres, the raster must give OpenDrift's own answer."""
    roaring = pytest.importorskip("roaring_landmask")
    kinds, _ = _generated()
    lon, lat = AGREEMENT_SITES[site]
    row = int((lat + 90) // TILE_DEG)
    col = int((lon + 180) // TILE_DEG)
    assert kinds[row * TILE_COLS + col] == "2", f"{site} should be a coastal tile"
    tile = decode_tile(unpack_band(band_path(row).read_bytes())[col])

    rng = np.random.default_rng(7)
    cells = rng.integers(0, TILE_CELLS * TILE_CELLS, 20_000)
    y, x = np.divmod(cells, TILE_CELLS)
    lons = col * TILE_DEG - 180 + (x + 0.5) / CELLS_PER_DEG
    lats = row * TILE_DEG - 90 + (y + 0.5) / CELLS_PER_DEG
    truth = _roaring(roaring).contains_many(lons, lats)

    agreement = float(np.mean(tile[cells] == truth))
    assert truth.any() and not truth.all(), f"{site}: sample should straddle the coast"
    assert agreement >= 0.999, f"{site}: frontend mask agrees with OpenDrift on {agreement:.4%}"


_mask = None


def _roaring(module):  # type: ignore[no-untyped-def]
    global _mask
    if _mask is None:
        _mask = module.RoaringLandmask.new()
    return _mask
