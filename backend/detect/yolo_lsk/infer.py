"""Stream native-resolution SAR tiles and merge seams with SAHI candidate matching.

Returns research GeoJSON, not operational two-class Detection database rows.
"""

import argparse
import json
import time
from itertools import batched
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.features import shapes
from sahi.postprocess.combine import batched_greedy_nmm
from shapely.affinity import affine_transform
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from backend.ingest.sar.geo import require_wgs84
from backend.ingest.sar.tiling import iter_tiles
from ml.datasets.oos_dataset import db_to_uint8
from ml.export.export import read_manifest, sha256


def mask_geometry(mask, col_offset=0, row_offset=0):
    """Pixel-edge polygons, including interior holes; no contour simplification."""
    return unary_union(
        [
            shape(geom)
            for geom, value in shapes(
                mask.astype(np.uint8),
                mask=mask.astype(bool),
                transform=Affine.translation(col_offset, row_offset),
            )
            if value
        ]
    )


def merge_seams(detections, threshold=0.5):
    """Repeat after unions so a complete middle tile can bridge two partial views."""
    while detections:
        merged = _merge_pass(detections, threshold)
        if len(merged) == len(detections):
            return merged
        detections = merged
    return []


def _merge_pass(detections, threshold):
    if not detections:
        return []
    boxes = np.array(
        [(*d["geometry"].bounds, d["confidence"], d["class_id"]) for d in detections],
        dtype=np.float32,
    )
    groups = batched_greedy_nmm(boxes, match_metric="IOS", match_threshold=threshold)
    merged = []
    for keeper, candidates in groups.items():
        item = dict(detections[keeper])
        for candidate in candidates:
            other = detections[candidate]
            overlap = item["geometry"].intersection(other["geometry"]).area
            if overlap / min(item["geometry"].area, other["geometry"].area) >= threshold:
                item["geometry"] = item["geometry"].union(other["geometry"])
            else:
                # Overlapping boxes alone must not join separate thin slicks.
                merged.append(other)
        merged.append(item)
    return merged


def infer_scene(
    scene,
    weights,
    *,
    research=False,
    device="0",
    progress=None,
    assume_vv_db_band=None,
    band=None,
    select=None,
):
    """Segment every tile of a scene, or the tiles `select` admits, and merge the seams.

    `band` overrides the manifest's band for a raster that carries one band
    cut from a scene (a window), and `select` is the second pass of the live
    pipeline's two-pass detection (`backend/pipeline/screen.py`): a predicate on
    `Tile` that keeps only the tiles its overview screen found candidates in.
    Both default to the full-scene sweep this was written for; tiles `select`
    rejects are counted in `properties.unselected_tiles`, never read.
    """
    started = time.perf_counter()
    expected = ("slick",) if research else ("oos", "slick_unknown")
    manifest = read_manifest(weights, expected_classes=expected)
    import torch
    from ultralytics import YOLO

    from ml.models.yolo_seg_lsk import register_lsk

    register_lsk()
    torch.set_num_threads(6)
    model = YOLO(str(weights), task="segment")
    if list(model.names.values()) != manifest["classes"]:
        raise ValueError("Checkpoint classes disagree with manifest")
    if any(not torch.isfinite(t).all() for t in model.model.state_dict().values()):
        raise ValueError("Non-finite model tensor")
    settings = dict(manifest["inference"])
    batch_size = settings.pop("batch")
    detections = []
    tile_count = 0
    skipped = 0
    unselected = 0
    with rasterio.open(scene) as source:
        require_wgs84(source.crs)
        band = manifest["raster"]["band"] if band is None else band
        if source.count < band:
            raise ValueError("Expected an explicitly named VV sigma0 dB band")
        description = (source.descriptions[band - 1] or "").upper()
        band_metadata_verified = "VV" in description and "DB" in description
        if not description and research and assume_vv_db_band == band:
            pass  # Historical SNAP exports omit names; record this assumption in every output.
        elif "VV" not in description:
            raise ValueError("Expected an explicitly named VV sigma0 dB band")
        elif "DB" not in description:
            raise ValueError("Expected sigma0 dB, not linear power")
        tile_options = {k: manifest["tiling"][k] for k in ("tile_size", "overlap")}
        tiles = list(iter_tiles(source.width, source.height, **tile_options))
        if select is not None:
            chosen = [tile for tile in tiles if select(tile)]
            unselected = len(tiles) - len(chosen)
            tiles = chosen
        for chunk in batched(tiles, batch_size):
            images, windows, valid_masks = [], [], []
            for tile in chunk:
                data = source.read(band, window=tile.window, masked=True)
                valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data) & (data.data != 0)
                tile_count += 1
                if not valid.any():
                    skipped += 1
                    continue
                scaled = db_to_uint8(
                    np.where(valid, data.data, 0), window=tuple(manifest["raster"]["db_window"])
                )
                images.append(np.repeat(scaled[..., None], 3, axis=2))
                windows.append(tile.window)
                valid_masks.append(valid)
            if images:
                results = model.predict(images, device=device, verbose=False, **settings)
                for result, window, valid in zip(results, windows, valid_masks, strict=True):
                    if result.masks is None:
                        continue
                    masks = result.masks.data.cpu().numpy().astype(bool)
                    if masks.shape[1:] != valid.shape:
                        raise ValueError(
                            "Prediction mask was resized away from native raster pixels"
                        )
                    for mask, score, category in zip(
                        masks,
                        result.boxes.conf.cpu().tolist(),
                        result.boxes.cls.cpu().tolist(),
                        strict=True,
                    ):
                        geom = mask_geometry(mask & valid, window.col_off, window.row_off)
                        if not geom.is_empty:
                            detections.append(
                                dict(geometry=geom, confidence=float(score), class_id=int(category))
                            )
            if progress:
                progress(tile_count, len(tiles))
        unmerged_count = len(detections)
        detections = merge_seams(detections, manifest["tiling"]["merge_threshold"])
        transform = source.transform
        features = []
        for index, detection in enumerate(detections):
            geo = affine_transform(
                detection["geometry"],
                [transform.a, transform.b, transform.d, transform.e, transform.c, transform.f],
            )
            features.append(
                dict(
                    type="Feature",
                    id=index,
                    geometry=mapping(geo),
                    properties=dict(
                        class_name=manifest["classes"][detection["class_id"]],
                        confidence=detection["confidence"],
                        research_only=research,
                    ),
                )
            )
        elapsed = time.perf_counter() - started
        return dict(
            type="FeatureCollection",
            features=features,
            properties=dict(
                scene=str(Path(scene).resolve()),
                width=source.width,
                height=source.height,
                crs="EPSG:4326",
                band_metadata_verified=band_metadata_verified,
                assumed_vv_db_band=assume_vv_db_band,
                tiles=tile_count,
                skipped_empty_tiles=skipped,
                unselected_tiles=unselected,
                band=band,
                predictions_before_merge=unmerged_count,
                seconds=elapsed,
                under_60_seconds=elapsed < 60,
                weights_sha256=manifest["sha256"],
                manifest_sha256=sha256(Path(weights).with_suffix(".json")),
                source_sha256=sha256(Path(__file__)),
                disclaimer="Research detections; no chemical oil confirmation or source attribution.",
            ),
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path)
    parser.add_argument("--weights", type=Path, default=Path("weights/L1-ciou-research.pt"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--assume-vv-db-band",
        type=int,
        help="Research-only explicit band assumption for unnamed legacy TIFFs",
    )
    parser.add_argument(
        "--research", action="store_true", help="Explicitly allow the single slick class"
    )
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite {args.output}")
    output = infer_scene(
        args.scene,
        args.weights,
        research=args.research,
        assume_vv_db_band=args.assume_vv_db_band,
        progress=lambda done, total: print(f"Tiles {done}/{total}", flush=True),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as stream:
        json.dump(output, stream)
    print(json.dumps(output["properties"], indent=2))


if __name__ == "__main__":
    main()
