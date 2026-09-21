"""Real raster integration: tile offsets, seam duplication, holes and manifest rejection."""

import json
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
import torch
from rasterio.transform import from_origin
from shapely.geometry import shape

from backend.detect.yolo_lsk.infer import infer_scene, mask_geometry, merge_seams
from ml.datasets.oos_dataset import db_to_uint8
from ml.export.export import read_manifest, sha256
from scripts.analyze_final_release import matched_recall


def test_native_geotiff_seams_and_holes(tmp_path, monkeypatch):
    scene = tmp_path / "scene.tif"
    transform = from_origin(-90, 30, 0.0001, 0.0001)
    data = np.full((2, 64, 140), -10, dtype=np.float32)
    data[1, 15:50, 50:85] = -25
    data[1, 23:30, 60:66] = -10  # Hole must survive mask polygon conversion and seam merging.
    with rasterio.open(
        scene,
        "w",
        driver="GTiff",
        width=140,
        height=64,
        count=2,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
    ) as dst:
        dst.write(data)
        dst.set_band_description(1, "Sigma0_VH_db")
        dst.set_band_description(2, "Sigma0_VV_db")
    weights = tmp_path / "research.pt"
    weights.write_bytes(b"fixture")
    manifest = dict(
        classes=["slick"],
        sha256=sha256(weights),
        inference=dict(imgsz=64, batch=2, conf=0.2, retina_masks=True),
        raster=dict(band=2, db_window=[-35, 0]),
        tiling=dict(tile_size=64, overlap=0.25, merge_threshold=0.5),
    )
    weights.with_suffix(".json").write_text(json.dumps(manifest))
    oil_value = db_to_uint8(np.array([-25]))[0]

    class FakeYOLO:
        def __init__(self, *args, **kwargs):
            self.names = {0: "slick"}
            self.model = SimpleNamespace(state_dict=lambda: {})

        def predict(self, images, **kwargs):
            assert kwargs["retina_masks"]
            return [
                SimpleNamespace(
                    masks=SimpleNamespace(data=torch.tensor((image[:, :, 0] == oil_value)[None])),
                    boxes=SimpleNamespace(conf=torch.tensor([0.9]), cls=torch.tensor([0.0])),
                )
                for image in images
            ]

    monkeypatch.setattr("ultralytics.YOLO", FakeYOLO)
    with pytest.raises(ValueError, match="class scheme"):
        infer_scene(scene, weights)
    result = infer_scene(scene, weights, research=True, device="cpu")
    assert result["properties"]["tiles"] == 3
    assert result["properties"]["predictions_before_merge"] == 3
    assert len(result["features"]) == 1
    geometry = shape(result["features"][0]["geometry"])
    assert len(geometry.interiors) == 1
    assert geometry.area == pytest.approx((35 * 35 - 7 * 6) * 1e-8)
    assert geometry.bounds == pytest.approx((-89.995, 29.995, -89.9915, 29.9985))
    with rasterio.open(scene, "r+") as dst:
        dst.set_band_description(2, "")
    with pytest.raises(ValueError, match="explicitly named"):
        infer_scene(scene, weights, research=True, device="cpu")
    assumed = infer_scene(scene, weights, research=True, device="cpu", assume_vv_db_band=2)
    assert assumed["properties"]["band_metadata_verified"] is False
    weights.write_bytes(b"changed")
    with pytest.raises(ValueError, match="SHA-256"):
        read_manifest(weights, expected_classes=("slick",))


def test_overlapping_boxes_do_not_merge_disjoint_masks():
    first = np.zeros((20, 20), bool)
    first[2, 2:18] = True
    first[2:18, 2] = True
    second = np.zeros_like(first)
    second[17, 3:18] = True
    second[3:18, 17] = True
    detections = [
        dict(geometry=mask_geometry(m), confidence=0.9, class_id=0) for m in (first, second)
    ]
    assert len(merge_seams(detections)) == 2


def test_matched_recall_uses_saved_confidence_and_reports_unattainable():
    rows = [
        dict(ng=2, matched_confidences=[0.8], confidences=[0.8, 0.2], lookalike=False),
        dict(ng=0, matched_confidences=[], confidences=[0.9], lookalike=True),
    ]
    measured = matched_recall(rows, 0.5)
    assert measured["recall"] == 0.5
    assert measured["lookalike_fp_instances"] == 1
    assert matched_recall(rows, 0.75) == {"unattainable": True}
