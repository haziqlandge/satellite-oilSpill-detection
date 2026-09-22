"""Cut a small, genuinely georeferenced window out of a processed SAR scene.

The console can read a GeoTIFF's own position, which is the only way an upload
gets a location that is MEASURED rather than asserted by the operator. The
processed scenes are the only georeferenced rasters this project holds -- the
corpus tiles carry no geotransform at all (DATA.md) -- but each one is about
3.58 GB across 32,585 x 21,409 pixels, which no browser is going to open.

So this cuts a window. What comes out is a real product, not a mock-up: the
pixels are the scene's own, the CRS is the scene's own, and the geotransform is
the scene's own transform offset to the window. Nothing about the position is
invented, which is the entire point -- a GeoTIFF with a fabricated geotransform
would be worse than no GeoTIFF, because the console would believe it.

Two things it carries forward rather than hides:

  * **Band 2 is taken as VV.** `DATA.md` D5 records that the band order is an
    assumption, not something read from metadata, and that band 1 (VH) holds
    about 0.51 dB of contrast -- effectively none. The output states the band it
    took in a tag so the assumption travels with the file.
  * **Values stay float32 sigma-0 dB.** They are not stretched to 8-bit here.
    The browser applies the project's fixed window, so the file keeps the
    science values and the display mapping stays in one place.

    .venv/Scripts/python.exe -m scripts.cut_geotiff_window --list
    .venv/Scripts/python.exe -m scripts.cut_geotiff_window --scene 20230409 --size 1536
"""

from __future__ import annotations

import argparse
import json
import pathlib

import rasterio
from rasterio.windows import Window

from backend.config import REPO_ROOT

SCENES = REPO_ROOT / "data/processed/sar"
DETECTIONS = REPO_ROOT / "eval/final/scenes"
DEFAULT_OUT = REPO_ROOT / "data/processed/sar/windows"


def largest_detection_centre(scene_stem: str) -> tuple[float, float] | None:
    """Centroid of the biggest detected polygon in this scene, if there is one."""
    path = DETECTIONS / f"{scene_stem}.geojson"
    if not path.exists():
        return None
    document = json.loads(path.read_text())
    best: tuple[float, float] | None = None
    best_area = 0.0
    for feature in document.get("features", []):
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        rings = coordinates if geometry["type"] == "Polygon" else [r for p in coordinates for r in p]
        for ring in rings:
            xs = [c[0] for c in ring]
            ys = [c[1] for c in ring]
            area = (max(xs) - min(xs)) * (max(ys) - min(ys))
            if area > best_area:
                best_area = area
                best = (sum(xs) / len(xs), sum(ys) / len(ys))
    return best


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="show the scenes on disk and exit")
    parser.add_argument("--scene", help="substring of the scene file name, e.g. 20230409")
    parser.add_argument("--size", type=int, default=1536, help="window edge, pixels")
    parser.add_argument("--band", type=int, default=2, help="1 is VH, 2 is VV (assumed)")
    parser.add_argument("--lon", type=float, help="window centre; defaults to the largest detection")
    parser.add_argument("--lat", type=float)
    parser.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    scenes = sorted(SCENES.glob("*_s0db.tif"))
    if args.list or not args.scene:
        if not scenes:
            print(f"no processed scenes under {SCENES}")
            return 0
        print(f"{len(scenes)} processed scene(s):")
        for path in scenes:
            centre = largest_detection_centre(path.stem)
            where = f"largest detection at {centre[0]:.4f}, {centre[1]:.4f}" if centre else "no detections on file"
            print(f"  {path.name}  ({path.stat().st_size / 2**30:.2f} GB) -- {where}")
        if not args.scene:
            print("\npass --scene <substring> to cut a window")
        return 0

    matches = [p for p in scenes if args.scene in p.name]
    if len(matches) != 1:
        print(f"--scene {args.scene!r} matched {len(matches)} scenes; be more specific")
        return 1
    source = matches[0]

    centre = (args.lon, args.lat) if args.lon is not None and args.lat is not None else None
    if centre is None:
        centre = largest_detection_centre(source.stem)
    if centre is None:
        print("no --lon/--lat given and no detections on file for this scene")
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    with rasterio.open(source) as dataset:
        if args.band > dataset.count:
            print(f"scene has {dataset.count} bands; --band {args.band} is out of range")
            return 1
        row, col = dataset.index(centre[0], centre[1])
        half = args.size // 2
        # Clamped so a detection near the scene edge still yields a full window.
        col_off = max(0, min(dataset.width - args.size, col - half))
        row_off = max(0, min(dataset.height - args.size, row - half))
        window = Window(col_off, row_off, args.size, args.size)
        data = dataset.read(args.band, window=window)
        transform = dataset.window_transform(window)
        profile = dataset.profile | {
            "count": 1,
            "width": args.size,
            "height": args.size,
            "transform": transform,
            "driver": "GTiff",
            "compress": "deflate",
            "predictor": 3,
            "tiled": False,
            "BIGTIFF": "NO",
        }
        # The scene's acquisition instant is in its name; carry it in a tag so a
        # reader does not have to parse the file name to find the time.
        stamp = source.stem.split("_")[4] if len(source.stem.split("_")) > 4 else ""
        out = args.out / f"{source.stem}_win{args.size}.tif"
        with rasterio.open(out, "w", **profile) as sink:
            sink.write(data, 1)
            sink.update_tags(
                TIFFTAG_DATETIME=(
                    f"{stamp[0:4]}:{stamp[4:6]}:{stamp[6:8]} {stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]}"
                    if len(stamp) >= 15
                    else ""
                ),
                SOURCE_SCENE=source.name,
                SOURCE_BAND=str(args.band),
                BAND_ASSUMPTION="band 2 taken as VV; see DATA.md D5, not read from metadata",
                UNITS="sigma0 dB, float32",
            )

    bounds = rasterio.transform.array_bounds(args.size, args.size, transform)
    print(f"wrote {out.relative_to(REPO_ROOT)} ({out.stat().st_size / 2**20:.1f} MB)")
    print(f"  centre  {centre[0]:.4f}, {centre[1]:.4f}")
    print(f"  bounds  {[round(v, 5) for v in bounds]}")
    print(f"  crs     {profile['crs']}  band {args.band} of {source.name}")
    print(f"  finite  {float(data.min()):.2f} to {float(data.max()):.2f} dB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
