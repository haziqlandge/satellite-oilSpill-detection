"""The §1.5 contract on the server: a stored segmentation for this exact input and model.

The console's "Use precomputed result" button (`frontDemo/src/sim/precomputed.ts`)
swaps a live segmenter run for one made earlier, and `POST /api/v1/runs` honours
the same contract with the same files:

  * keyed by the **SHA-256 of the file's bytes**, so a renamed copy still finds
    its entry and a different file with the same name never does;
  * stamped with the **model's SHA-256** and refused for any other model -- here
    both links of the chain are checked: the entry was made by the browser's
    ONNX export, and that export was made from the release weights the live
    backend path would run (`source_weights_sha256`);
  * **only the segmentation is swapped.** Seed choice, characterisation, CFAR,
    wind, drift and everything after run live on the file in hand, and every
    place the result is shown says PRECOMPUTED, by what, and when.

Entries are the browser segmenter's WASM output (`npm run precompute:uploads`),
which `check:precomputed` holds to the live browser run pixel for pixel.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from backend.config import REPO_ROOT

PRECOMPUTED_DIR = REPO_ROOT / "frontDemo" / "public" / "precomputed"
ONNX_MANIFEST = REPO_ROOT / "frontDemo" / "public" / "models" / "L1-ciou-research.json"


@dataclass(frozen=True, slots=True)
class Lookup:
    entry: dict[str, Any] | None
    reason: str

    @property
    def ok(self) -> bool:
        return self.entry is not None


def find_precomputed(
    sha256: str,
    *,
    weights_sha256: str,
    directory: Path = PRECOMPUTED_DIR,
    onnx_manifest: Path = ONNX_MANIFEST,
) -> Lookup:
    """The stored segmentation for these bytes under the release model, or why there is none."""
    index_path = directory / "index.json"
    if not index_path.exists():
        return Lookup(None, "no precomputed results exist on this machine")
    name = json.loads(index_path.read_text(encoding="utf-8")).get("entries", {}).get(sha256)
    if not name:
        return Lookup(None, "no precomputed result exists for this file; it has to run live")
    entry = json.loads((directory / name).read_text(encoding="utf-8"))
    if entry.get("version") != 1:
        return Lookup(None, f"unknown precomputed format (version {entry.get('version')})")
    if entry.get("sha256") != sha256:
        return Lookup(None, "the stored result is for a different file")
    if not onnx_manifest.exists():
        return Lookup(None, "the browser model's manifest is missing, so the stored result's model cannot be checked")
    onnx = json.loads(onnx_manifest.read_text(encoding="utf-8"))
    if entry["model"]["sha256"] != onnx.get("sha256"):
        return Lookup(None, "the stored result was made by a different model than the browser's current one")
    if onnx.get("source_weights_sha256") != weights_sha256:
        return Lookup(None, "the browser model was not exported from the release weights this backend runs")
    total = int(sum(entry["maskRuns"]))
    if total != entry["width"] * entry["height"]:
        return Lookup(None, f"the stored mask covers {total} of {entry['width'] * entry['height']} pixels")
    return Lookup(entry, "")


def decode_runs(runs: list[int], length: int) -> np.ndarray:
    """Run lengths alternating 0 and 1, starting with 0 (`precomputed.ts` `decodeRuns`)."""
    mask = np.zeros(length, dtype=np.uint8)
    at = 0
    for r, n in enumerate(runs):
        if n < 0 or at + n > length:
            raise ValueError("mask runs overrun the mask")
        if r % 2 == 1:
            mask[at:at + n] = 1
        at += n
    if at != length:
        raise ValueError(f"mask runs cover {at} of {length} pixels")
    return mask


def entry_detections(entry: dict[str, Any], transform: Any) -> dict[str, Any]:
    """The stored mask as a detection FeatureCollection in lon/lat, shaped as `infer_scene`'s.

    The mask is the union of every detection's mask, so each connected region
    becomes one feature carrying the highest score among the detections whose
    box it overlaps -- the one stored figure that belongs to it.
    """
    from shapely.affinity import affine_transform
    from shapely.geometry import box, mapping

    from backend.detect.yolo_lsk.infer import mask_geometry

    width, height = int(entry["width"]), int(entry["height"])
    mask = decode_runs(entry["maskRuns"], width * height).reshape(height, width).astype(bool)
    geometry = mask_geometry(mask)
    parts = [] if geometry.is_empty else list(getattr(geometry, "geoms", [geometry]))
    boxes = [(box(*d["box"]), float(d["score"])) for d in entry.get("detections", [])]
    coefficients = [transform.a, transform.b, transform.d, transform.e, transform.c, transform.f]
    features = []
    for index, part in enumerate(parts):
        scores = [score for b, score in boxes if b.intersects(part)]
        features.append({
            "type": "Feature",
            "id": index,
            "geometry": mapping(affine_transform(part, coefficients)),
            "properties": {
                "class_name": "slick",
                "confidence": max(scores) if scores else 0.0,
                "research_only": True,
            },
        })
    return {"type": "FeatureCollection", "features": features}
