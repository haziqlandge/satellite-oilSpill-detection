"""The browser export of the release segmenter: manifest, parity input, artefact hash."""

import json
from pathlib import Path

import numpy as np
import pytest

from ml.export.export import sha256
from ml.export.onnx_export import OUTPUT_DIR, _find, tile_input, web_manifest

RELEASE = {
    "name": "L1-ciou-research",
    "classes": ["slick"],
    "status": "research-only",
    "inference": {"imgsz": 1024, "batch": 4, "conf": 0.2, "iou": 0.7, "max_det": 1000},
    "raster": {"band": 2, "units": "sigma0_db", "db_window": [-35.0, 0.0], "masked_zero": True},
    "tiling": {"tile_size": 1024, "overlap": 0.1, "merge_metric": "IOS", "merge_threshold": 0.5},
    "limitations": ["One slick class; never relabel predictions as oos."],
}


def test_web_manifest_carries_the_release_settings_unchanged():
    out = web_manifest(RELEASE, onnx_sha256="a" * 64, weights_sha256="b" * 64, parity={"x": 0.0})

    # The browser must run the export exactly as infer_scene runs the checkpoint.
    assert out["inference"] == {"conf": 0.2, "iou": 0.7, "max_det": 1000}
    assert out["tiling"] == RELEASE["tiling"]
    assert out["raster"]["band"] == 2 and out["raster"]["db_window"] == [-35.0, 0.0]
    assert out["input"] == {"size": 1024, "channels": 3, "scale": 1 / 255, "pad_value": 114}
    # One research class, never promoted to `oos`.
    assert out["classes"] == ["slick"] and out["status"] == "research-only"
    assert out["file"] == "L1-ciou-research.onnx" and out["precision"] == "fp32"
    assert out["limitations"] == RELEASE["limitations"]


def test_parity_tile_is_band_two_through_the_window_from_the_centre(tmp_path):
    rasterio = pytest.importorskip("rasterio")
    from rasterio.transform import from_origin

    size, crop = 64, 32
    band1 = np.full((size, size), -50.0, dtype=np.float32)  # VH-like; must not be read
    band2 = np.full((size, size), -35.0, dtype=np.float32)
    band2[16:48, 16:48] = 0.0  # the centre crop is exactly this block
    path = tmp_path / "scene.tif"
    with rasterio.open(
        path, "w", driver="GTiff", width=size, height=size, count=2, dtype="float32",
        crs="EPSG:4326", transform=from_origin(0, 0, 1e-4, 1e-4),
    ) as dst:
        dst.write(np.stack([band1, band2]))

    tile = tile_input(path, crop)

    assert tile.shape == (1, 3, crop, crop) and tile.dtype == np.float32
    np.testing.assert_allclose(tile, 1.0)  # 0 dB is the top of the window


def test_find_locates_a_tensor_by_shape_in_a_nested_output():
    torch = pytest.importorskip("torch")
    boxes = torch.zeros(1, 37, 8)
    protos = torch.ones(1, 32, 4, 4)
    nested = (boxes, (torch.zeros(2), [protos]))

    assert _find(nested, (1, 32, 4, 4)).sum() == protos.numel()
    assert _find(nested, (1, 37, 8)).shape == (1, 37, 8)
    with pytest.raises(LookupError):
        _find(nested, (9, 9))


def test_exported_model_matches_its_manifest_when_present():
    manifest_path = Path(OUTPUT_DIR) / "L1-ciou-research.json"
    if not manifest_path.exists():
        pytest.skip("model not exported on this machine")
    manifest = json.loads(manifest_path.read_text())
    model = manifest_path.with_name(manifest["file"])
    if not model.exists():
        pytest.skip(".onnx is gitignored and not exported here")

    # A stale or hand-copied model would run silently under the wrong name.
    assert sha256(model) == manifest["sha256"]
    assert manifest["parity"]["candidates_over_conf"] == manifest["parity"]["candidates_over_conf_torch"]
