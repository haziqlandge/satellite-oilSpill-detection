"""Export the assets the console presentation overlay draws (`frontDemo/src/present/`).

The overlay (T and X on `#/console`) is a narrated demo add-on, and by the
user's decision (2026-09-27) nothing on its screen says what is real and what is
authored. This docstring and the overlay's `PROVENANCE` exports are where that
record lives instead:

Real
    * ``tiles/zenodo-*.webp``: twelve Zenodo Part I training tiles (8346860,
      ``Oil/``), every 100th, band 2 (VV) through the training dB window
      (``ml.datasets.oos_dataset.read_sar_uint8``).
    * ``may/scene.webp``: the 15 May 2023 Sentinel-1A pass the console's real
      run is built on, the preprocessed sigma0 dB raster, band 2, decimated.
    * ``may/clean-crop.webp`` and ``may/raw-crop.webp``: the same box around the
      run's seed, filtered (the preprocessed raster) and raw (the GRD COG's DN,
      warped through its own GCPs onto the filtered crop's grid). The raw crop is
      uncalibrated, so it is stretched to its own 2nd to 98th percentile in
      ``10 log10(DN^2)`` rather than through the calibrated dB window.
    * ``gate``: the backend's own gate (``backend.attribute.scoring.gate_admitted``,
      the loop ``score()`` runs) on the files the console ships for this pass:
      the origin field rebuilt from ``drift.json``'s hourly particle frames (the
      run steps every 10 minutes, so this is its hourly sampling), and the AIS in
      ``frontDemo/public/ais/real-20230515.json``.

Authored
    * ``score``: the six terms, weights and total of Case 2's top candidate, from
      ``tests/fixtures/scoring/gom-moving.json.gz`` (the console's authored
      scenario, on real AIS). The overlay shows it as how a candidate is scored,
      never as the 15 May result. It names the ship the published Case 2 names.
    * ``ranking``: Case 2's top five candidates by score, the published ship
      first; the others keep the console's masked MMSI labels.

Run: ``.venv/Scripts/python.exe -m scripts.export_present_assets``
"""

from __future__ import annotations

import gzip
import json
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ml.datasets.oos_dataset import SAR_BAND, db_to_uint8, read_sar_uint8

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontDemo" / "public" / "present"
SCENE_ID = "S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db"
RUN = ROOT / "frontDemo" / "public" / "runs" / SCENE_ID
AIS = ROOT / "frontDemo" / "public" / "ais" / "real-20230515.json"
PROCESSED = ROOT / "data" / "processed" / "sar" / f"{SCENE_ID}.tif"
RAW = ROOT / "data" / "raw" / "sar" / "s1a-iw-grd-vv-20230515t000208-20230515t000233-048537-05d69b-001-cog.tiff"
TILES = ROOT / "data" / "interim" / "datasets" / "zenodo" / "8346860" / "01_Train_Val_Oil_Spill_images" / "Oil"
CASE2 = ROOT / "tests" / "fixtures" / "scoring" / "gom-moving.json.gz"

TERM_LABELS = {
    "drift": "Drift", "parity": "Parity", "proximity": "Proximity",
    "temporality": "Timing", "behaviour": "Behaviour", "prior": "Vessel prior",
}
SCENE_WIDTH_PX = 1600
CROP_HALF_DEG = 0.06
CROP_PX = 900


def to_u8(db: np.ndarray) -> np.ndarray:
    """dB to 8-bit through the training window; non-finite (no data, land) is black."""
    arr = np.asarray(db, dtype=np.float32)
    return np.where(np.isfinite(arr), db_to_uint8(np.nan_to_num(arr, nan=-35.0)), 0).astype(np.uint8)


def case2_score() -> dict[str, Any]:
    """Case 2's top candidate: total and the six terms, in the order the overlay draws them."""
    fixture = json.loads(gzip.decompress(CASE2.read_bytes()))
    suspects = fixture["expected"]["integral"]["suspects"]
    top = suspects[0]
    weights = {t["key"]: t["weight"] for t in top["evidence"]["terms"]}
    return {
        "label": top["label"],
        "isTruth": bool(top.get("isTruth")),
        "rank": top["rank"],
        "of": len(suspects),
        "detail": top["detail"],
        "total": top["total"],
        "terms": [
            {"key": key, "label": label, "value": top["terms"][key], "weight": weights[key]}
            for key, label in TERM_LABELS.items()
        ],
    }


def case2_ranking(top: int = 5) -> list[dict[str, Any]]:
    """Case 2's ranked candidates, best first: the published ship, then the others as the console masks them."""
    fixture = json.loads(gzip.decompress(CASE2.read_bytes()))
    return [
        {
            "rank": s["rank"],
            "label": s["label"],
            "kind": s["detail"].split(" \u00b7 ")[0],
            "total": s["total"],
            "isTruth": bool(s.get("isTruth")),
        }
        for s in fixture["expected"]["integral"]["suspects"][:top]
    ]


def _webp(array: np.ndarray, path: Path, width: int | None = None, *, nearest: bool = False) -> None:
    image = Image.fromarray(array)
    if width is not None and image.width != width:
        height = round(image.height * width / image.width)
        image = image.resize((width, height), Image.Resampling.NEAREST if nearest else Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=80)


def usable_tile(u8: np.ndarray) -> bool:
    """Open sea only: a tile with land (clipped white) or no data (black) reads as a glitch at mosaic size."""
    return float(np.mean((u8 == 255) | (u8 == 0))) < 0.005


def export_tiles(out: Path) -> list[str]:
    names: list[str] = []
    for source in sorted(TILES.glob("*.tif"))[::50]:
        u8 = read_sar_uint8(source, band=SAR_BAND)
        if not usable_tile(u8):
            continue
        name = f"tiles/zenodo-{len(names):02d}.webp"
        _webp(u8, out / name, 320)
        names.append(name)
        if len(names) == 12:
            break
    return names


def export_scene(out: Path) -> dict[str, Any]:
    import rasterio

    with rasterio.open(PROCESSED) as src:
        height = round(src.height * SCENE_WIDTH_PX / src.width)
        band = src.read(SAR_BAND, out_shape=(height, SCENE_WIDTH_PX))
        b = src.bounds
        info = {"id": SCENE_ID, "bounds": [b.left, b.bottom, b.right, b.top],
                "widthPx": src.width, "heightPx": src.height, "image": "may/scene.webp"}
    # Outside the swath and on masked land the raster holds exactly 0 dB (no
    # nodata tag); sea never reaches 0 dB here, so 0 is "no picture" and goes
    # transparent, letting the overlay's coast show through.
    valid = np.isfinite(band) & (band != 0)
    alpha = np.where(valid, 255, 0).astype(np.uint8)
    path = out / "may" / "scene.webp"
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.dstack([to_u8(band), alpha]), "LA").save(path, "WEBP", quality=80)
    return info


def export_clean(out: Path, seed: tuple[float, float]) -> dict[str, Any]:
    import rasterio
    from rasterio.transform import GCPTransformer
    from rasterio.warp import Resampling, reproject
    from rasterio.windows import from_bounds

    lon, lat = seed
    west, south, east, north = lon - CROP_HALF_DEG, lat - CROP_HALF_DEG, lon + CROP_HALF_DEG, lat + CROP_HALF_DEG
    with rasterio.open(PROCESSED) as src:
        window = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
        filtered = src.read(SAR_BAND, window=window)
        if src.nodata is not None:
            filtered = np.where(filtered == src.nodata, np.nan, filtered)
        dst_transform = src.window_transform(window)
        dst_crs = src.crs
    with rasterio.open(RAW) as raw:
        gcps, gcp_crs = raw.gcps
        corners = [GCPTransformer(gcps).rowcol(x, y) for x in (west, east) for y in (south, north)]
        rows = [r for r, _ in corners]
        cols = [c for _, c in corners]
        r0, c0 = max(0, min(rows) - 64), max(0, min(cols) - 64)
        r1, c1 = min(raw.height, max(rows) + 64), min(raw.width, max(cols) + 64)
        dn = raw.read(1, window=((r0, r1), (c0, c1))).astype(np.float32)
    shifted = [type(g)(row=g.row - r0, col=g.col - c0, x=g.x, y=g.y, z=g.z) for g in gcps]
    warped = np.full(filtered.shape, np.nan, dtype=np.float32)
    reproject(source=dn, destination=warped, gcps=shifted, src_crs=gcp_crs, dst_transform=dst_transform,
              dst_crs=dst_crs, resampling=Resampling.nearest, src_nodata=0, dst_nodata=np.nan)
    raw_db = 10 * np.log10(np.square(warped) + 1)
    lo, hi = np.nanpercentile(raw_db, [2, 98])
    raw_u8 = np.where(np.isfinite(raw_db), ((np.clip(raw_db, lo, hi) - lo) / (hi - lo) * 255).round(), 0)
    _webp(raw_u8.astype(np.uint8), out / "may" / "raw-crop.webp", CROP_PX, nearest=True)
    _webp(to_u8(filtered), out / "may" / "clean-crop.webp", CROP_PX, nearest=True)
    return {"bounds": [west, south, east, north], "raw": "may/raw-crop.webp", "filtered": "may/clean-crop.webp"}


def export_gate() -> dict[str, Any]:
    from backend.attribute.candidates import attribution_input
    from backend.attribute.scoring import gate_admitted, score
    from backend.attribute.weights import GATE_THRESHOLD
    from backend.drift.origin_field import build_origin_field

    drift = json.loads((RUN / "drift.json").read_text())
    scene = json.loads((RUN / "scene.json").read_text())
    traffic = json.loads(AIS.read_text())
    acquired = datetime.fromisoformat(drift["acquiredAtIso"].replace("Z", "+00:00")).astimezone(UTC).replace(tzinfo=None)
    # A backward run's history descends in time: row 0 is the observation (CLAUDE.md, traps).
    back = sorted((f for f in drift["frames"] if f["hour"] <= 0), key=lambda f: -f["hour"])
    lon = np.array([f["particles"][0::2] for f in back], dtype=np.float64)
    lat = np.array([f["particles"][1::2] for f in back], dtype=np.float64)
    times = tuple(acquired + timedelta(hours=f["hour"]) for f in back)
    field = build_origin_field(lon, lat, times)
    inp = attribution_input(field=field, acquired=acquired, character=scene["characterisation"], payload=drift,
                            traffic=traffic, backward_hours=drift["backwardHours"])
    admitted = gate_admitted(inp)
    if len(admitted) != score(inp)["gate"]["admitted"]:
        raise SystemExit("gate_admitted disagrees with score(); the extraction is broken")
    known = {v["id"] for v in traffic["vessels"]}
    ids = [v.mmsi for v in admitted]
    if not set(ids) <= known:
        raise SystemExit("an admitted id is not in the AIS file the overlay draws")
    return {"considered": len(inp.vessels), "admitted": len(ids), "admittedIds": ids,
            "threshold": GATE_THRESHOLD}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    drift = json.loads((RUN / "drift.json").read_text())
    seed = (float(drift["seed"][0]), float(drift["seed"][1]))
    journey: dict[str, Any] = {
        "scene": export_scene(OUT),
        "clean": export_clean(OUT, seed),
        "tiles": export_tiles(OUT),
        "gate": export_gate(),
        "score": case2_score(),
        "ranking": case2_ranking(),
    }
    (OUT / "journey.json").write_text(json.dumps(journey, indent=1))
    gate = journey["gate"]
    print(f"journey.json: scene {journey['scene']['widthPx']}x{journey['scene']['heightPx']} px, "
          f"{len(journey['tiles'])} tiles, gate {gate['admitted']} of {gate['considered']} "
          f"(threshold {gate['threshold']}), score {journey['score']['total']:.3f}")
    if not math.isfinite(journey["score"]["total"]):
        raise SystemExit("case 2 total is not finite")


if __name__ == "__main__":
    main()
