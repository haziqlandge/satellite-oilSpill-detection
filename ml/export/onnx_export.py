"""Export the research release to ONNX for the browser, and prove it matches.

The console's upload path used to screen for dark regions with Otsu, and on
Part I scenes that outlined the sea: median precision .045 over 24 validation
scenes, against .915 for this model run through `infer_scene` on the same
scenes. The model has to run where the upload is, which is the browser, so it
goes out as ONNX for `onnxruntime-web` (`FUTURE_WORK.md` section 4.1).

fp32, not fp16. The release manifest records `half: false` and `export.py`
exists to not change tensor precision; the WASM backend is also fp32-native.

The export is not trusted on its own say-so. The same real tile -- band 2 of a
TRAIN scene through the corpus dB window, exactly what `infer_scene` feeds the
model -- goes through PyTorch and through ONNX Runtime, and the raw outputs
must agree. The numbers are written into the web manifest.

    .venv/Scripts/python.exe -m ml.export.onnx_export

The .onnx is gitignored like every other weight file (`*.onnx`); the manifest
beside it is small and committed, and carries the hash a copy must match.
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any, cast

import numpy as np

from ml.datasets.oos_dataset import read_sar_uint8
from ml.export.export import WEIGHTS, read_manifest, sha256

OUTPUT_DIR = Path("frontDemo/public/models")
# A train scene, never val or test: this is a numerical parity check, not an
# evaluation, and the held-out split is consumed (CLAUDE.md section 6).
PARITY_SCENE = Path("data/interim/datasets/zenodo/8346860/01_Train_Val_Oil_Spill_images/Oil/00000.tif")
# Box coordinates are input pixels (0-1024); scores, mask coefficients and
# prototypes are O(1). One absolute tolerance cannot serve both: float32
# rounding alone moves a pixel coordinate by ~3e-3.
PIXEL_TOLERANCE = 0.05
VALUE_TOLERANCE = 1e-3


def web_manifest(
    manifest: dict[str, Any], *, onnx_sha256: str, weights_sha256: str, parity: dict[str, float]
) -> dict[str, Any]:
    """What the browser needs to run the export exactly as `infer_scene` does."""

    return dict(
        name=manifest["name"],
        classes=manifest["classes"],
        status=manifest["status"],
        file=f"{manifest['name']}.onnx",
        sha256=onnx_sha256,
        source_weights_sha256=weights_sha256,
        precision="fp32",
        input=dict(size=manifest["inference"]["imgsz"], channels=3, scale=1 / 255, pad_value=114),
        inference=dict(
            conf=manifest["inference"]["conf"],
            iou=manifest["inference"]["iou"],
            max_det=manifest["inference"]["max_det"],
        ),
        raster=manifest["raster"],
        tiling=manifest["tiling"],
        parity=parity,
        limitations=manifest["limitations"],
    )


def tile_input(scene: Path, size: int) -> np.ndarray:
    """The centre tile of a scene as the model's NCHW float input.

    The centre, because that is where the parity scene's slick lies: a tile
    with no detection in it would compare two sets of near-zero scores.
    """

    full = read_sar_uint8(scene)
    top = max(0, (full.shape[0] - size) // 2)
    left = max(0, (full.shape[1] - size) // 2)
    grey = full[top : top + size, left : left + size]
    return np.repeat(grey[None, None], 3, axis=1).astype(np.float32) / 255.0


def _find(output: Any, shape: tuple[int, ...]) -> np.ndarray:
    """The first tensor of `shape` anywhere in a nested model output."""

    if hasattr(output, "shape") and tuple(output.shape) == tuple(shape):
        return np.asarray(output.detach().cpu().numpy())
    if isinstance(output, (list, tuple)):
        for item in output:
            try:
                return _find(item, shape)
            except LookupError:
                continue
    raise LookupError(f"no tensor of shape {shape} in the model output")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    manifest = read_manifest(WEIGHTS, expected_classes=("slick",))
    size = int(manifest["inference"]["imgsz"])

    import onnx
    import onnxruntime as ort
    import torch
    from ultralytics import YOLO

    from ml.models.yolo_seg_lsk import register_lsk

    register_lsk()
    with tempfile.TemporaryDirectory() as tmp:
        # Exported beside a copy: ultralytics writes next to its input, and
        # `weights/` is visible to git (CLAUDE.md section 8).
        copy = Path(tmp) / WEIGHTS.name
        shutil.copyfile(WEIGHTS, copy)
        model = YOLO(str(copy), task="segment")
        exported = Path(
            model.export(
                format="onnx", imgsz=size, opset=17, dynamic=False, simplify=False,
                half=False, batch=1, device="cpu",
            )
        )
        onnx.checker.check_model(str(exported))

        tile = tile_input(PARITY_SCENE, size)
        session = ort.InferenceSession(str(exported), providers=["CPUExecutionProvider"])
        got_boxes, got_protos = session.run(None, {session.get_inputs()[0].name: tile})
        # ultralytics types `.model` loosely; after loading a .pt it is the network.
        net = cast("torch.nn.Module", model.model).float().eval()
        with torch.no_grad():
            reference = net(torch.from_numpy(tile))
        # The eval-mode head nests its outputs differently from the exported
        # graph, so the reference tensors are found by shape, not by position.
        ref_boxes = _find(reference, got_boxes.shape)
        ref_protos = _find(reference, got_protos.shape)
        conf = manifest["inference"]["conf"]
        parity = dict(
            box_pixels_max_abs=float(np.abs(got_boxes[:, :4] - ref_boxes[:, :4]).max()),
            scores_coeffs_max_abs=float(np.abs(got_boxes[:, 4:] - ref_boxes[:, 4:]).max()),
            protos_max_abs=float(np.abs(got_protos - ref_protos).max()),
            candidates_over_conf=int((got_boxes[0, 4] > conf).sum()),
            candidates_over_conf_torch=int((ref_boxes[0, 4] > conf).sum()),
        )
        if (
            parity["box_pixels_max_abs"] > PIXEL_TOLERANCE
            or max(parity["scores_coeffs_max_abs"], parity["protos_max_abs"]) > VALUE_TOLERANCE
            or parity["candidates_over_conf"] != parity["candidates_over_conf_torch"]
            or parity["candidates_over_conf"] == 0
        ):
            raise ValueError(f"ONNX disagrees with PyTorch: {parity}")

        args.out.mkdir(parents=True, exist_ok=True)
        target = args.out / f"{manifest['name']}.onnx"
        shutil.copyfile(exported, target)

    shapes = {o.name: o.shape for o in session.get_outputs()}
    out = web_manifest(manifest, onnx_sha256=sha256(target), weights_sha256=sha256(WEIGHTS), parity=parity)
    out["outputs"] = shapes
    target.with_suffix(".json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(dict(file=str(target), bytes=target.stat().st_size, outputs=shapes, parity=parity), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
