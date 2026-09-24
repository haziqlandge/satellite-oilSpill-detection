"""The CFAR-backed review pack (FUTURE_WORK §2.1-2.3) and applying a reviewer's decisions.

The pilot's proposer could never propose `oos`: it needs a bright target near a
linear instance, and no CFAR had been run, so `bright_target_distance_px` was
-1 for all 355 instances (ISSUES B2). These tests build a pack from a synthetic
scene where the answer is known -- a bright vessel with a thin dark trail off
its stern, and a compact patch far from anything -- and then apply decisions
the way a reviewer's download would.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

from backend.ingest.datasets.relabel import load_confirmed  # noqa: E402
from scripts.apply_review_decisions import ReviewBundleError, apply_bundle  # noqa: E402
from scripts.cfar_review_pack import build_pack  # noqa: E402

SIZE = 256
PIXEL_DEG = 8.983e-05  # the corpus's own spacing, ~10 m


def _scene(tmp: Path, identity: str) -> tuple[str, str]:
    rng = np.random.default_rng(0)
    sea = 10 ** (-20 / 10) * rng.exponential(1.0, (SIZE, SIZE))
    db = 10 * np.log10(sea)
    mask = np.zeros((SIZE, SIZE), dtype=np.uint8)
    # A vessel: 3x3, 30 dB above the sea.
    db[99:102, 59:62] = 10.0
    # Its trail: long, thin, 10 dB darker than the sea, starting just astern.
    db[98:102, 66:200] -= 10.0
    mask[98:102, 66:200] = 1
    # A compact dark patch far from any target.
    yy, xx = np.ogrid[:SIZE, :SIZE]
    blob = (yy - 205) ** 2 + (xx - 205) ** 2 <= 10**2
    db[blob] -= 6.0
    mask[blob] = 1

    image = tmp / "data" / f"{identity}.tif"
    mask_path = tmp / "data" / f"{identity}_mask.tif"
    image.parent.mkdir(parents=True, exist_ok=True)
    transform = from_origin(-89.5, 28.5, PIXEL_DEG, PIXEL_DEG)
    with rasterio.open(image, "w", driver="GTiff", width=SIZE, height=SIZE, count=2,
                       dtype="float32", crs="EPSG:4326", transform=transform) as out:
        out.write((db - 7.0).astype(np.float32), 1)  # a weaker VH-like band 1
        out.write(db.astype(np.float32), 2)
    with rasterio.open(mask_path, "w", driver="GTiff", width=SIZE, height=SIZE, count=1,
                       dtype="uint8") as out:
        out.write(mask, 1)
    return image.relative_to(tmp).as_posix(), mask_path.relative_to(tmp).as_posix()


def _pilot(tmp: Path) -> Path:
    pilot = tmp / "pilot"
    (pilot / "reviews").mkdir(parents=True)
    image, mask = _scene(tmp, "8346860__Oil__99999")
    review = {
        "source": "8346860__Oil__99999",
        "class_scheme": ["oos", "slick_unknown"],
        "instances": [],
        "original_image": image,
        "original_mask": mask,
        "split": "train",
    }
    (pilot / "reviews" / "8346860__Oil__99999.json").write_text(json.dumps(review))
    return pilot


def test_cfar_makes_oos_proposable_and_the_evidence_is_measured(tmp_path: Path) -> None:
    out = tmp_path / "pack"
    summary = build_pack(_pilot(tmp_path), out, repo_root=tmp_path)

    review = json.loads((out / "reviews" / "8346860__Oil__99999.json").read_text())
    assert review["cfar"]["status"] == "run"
    assert review["cfar"]["targets"], "the vessel was not found"
    vessel = review["cfar"]["targets"][0]
    assert abs(vessel["row"] - 100) < 2 and abs(vessel["col"] - 60) < 2

    by_class = {i["proposed_class"]: i for i in review["instances"]}
    trail = by_class["oos"]
    assert 0 < trail["terms"]["bright_target_distance_px"] <= 300
    assert trail["evidence"]["contrast_db"] < -8.0
    assert trail["evidence"]["target_at_end"] is True
    # Both measure to the trail itself, a few px astern -- not to its
    # centroid, 70 px down the trail (relabel.propose_all).
    assert trail["evidence"]["nearest_target_px"] < 10
    assert trail["terms"]["bright_target_distance_px"] == pytest.approx(trail["evidence"]["nearest_target_px"], abs=1.5)
    assert trail["evidence"]["nearest_target_m"] == pytest.approx(
        trail["evidence"]["nearest_target_px"] * 10, rel=0.25)
    patch = by_class["slick_unknown"]
    assert patch["evidence"]["contrast_db"] < -4.0
    # Every record leaves unconfirmed; the pack proposes, a human decides.
    assert all(i["confirmed_class"] is None and i["confirmed_by"] is None for i in review["instances"])
    assert summary["proposed"]["oos"] == 1
    assert (out / "index.html").exists()


def test_a_raster_without_calibrated_power_is_not_cfar_d(tmp_path: Path) -> None:
    from PIL import Image

    pilot = tmp_path / "pilot"
    (pilot / "reviews").mkdir(parents=True)
    (tmp_path / "data").mkdir()
    Image.fromarray(np.full((64, 64, 3), 90, dtype=np.uint8)).save(tmp_path / "data" / "sentinel_7.png")
    mask = np.zeros((64, 64, 3), dtype=np.uint8)
    mask[20:40, 20:40] = 255
    Image.fromarray(mask).save(tmp_path / "data" / "sentinel_7_mask.png")
    (pilot / "reviews" / "15298010__train__sentinel_7.json").write_text(json.dumps({
        "source": "15298010__train__sentinel_7", "class_scheme": ["oos", "slick_unknown"], "instances": [],
        "original_image": "data/sentinel_7.png", "original_mask": "data/sentinel_7_mask.png", "split": "train",
    }))

    build_pack(pilot, tmp_path / "pack", repo_root=tmp_path)

    review = json.loads((tmp_path / "pack" / "reviews" / "15298010__train__sentinel_7.json").read_text())
    assert review["cfar"]["status"] == "not_applicable"
    assert "calibrated" in review["cfar"]["reason"]
    assert review["instances"][0]["evidence"]["contrast_db"] is None


def test_the_pack_refuses_to_overwrite(tmp_path: Path) -> None:
    pilot = _pilot(tmp_path)
    build_pack(pilot, tmp_path / "pack", repo_root=tmp_path)
    with pytest.raises(FileExistsError):
        build_pack(pilot, tmp_path / "pack", repo_root=tmp_path)


def _bundle(**record: object) -> dict:
    base = {"source": "8346860__Oil__99999", "label": 1}
    return {"version": 1, "reviewer": "Haziq (non-specialist, rubric-assisted)",
            "decisions": [{**base, **record}]}


def test_applied_decisions_load_through_the_confirmed_label_gate(tmp_path: Path) -> None:
    out = tmp_path / "pack"
    build_pack(_pilot(tmp_path), out, repo_root=tmp_path)
    review_path = out / "reviews" / "8346860__Oil__99999.json"
    labels = [i["label"] for i in json.loads(review_path.read_text())["instances"]]

    bundle = _bundle(label=labels[0], decision="oos", confidence="medium", notes="trail off the vessel")
    bundle["decisions"].append({"source": "8346860__Oil__99999", "label": labels[1],
                                "decision": "reject_lookalike", "confidence": "low", "notes": ""})
    summary = apply_bundle(bundle, out)

    assert load_confirmed(review_path) == {labels[0]: "oos"}
    stored = {i["label"]: i for i in json.loads(review_path.read_text())["instances"]}
    assert stored[labels[1]]["confirmed_class"] is None
    assert stored[labels[1]]["review_decision"] == "reject_lookalike"
    assert stored[labels[0]]["confirmed_by"] == "Haziq (non-specialist, rubric-assisted)"
    assert summary == {"confirmed": 1, "rejected": 1, "deferred": 0}


@pytest.mark.parametrize(
    ("record", "reviewer", "message"),
    [
        ({"decision": "oil"}, "Haziq", "decision"),
        ({"decision": "oos"}, "", "reviewer"),
        ({"decision": "oos", "label": 999}, "Haziq", "no instance"),
        ({"decision": "oos", "source": "nope"}, "Haziq", "no review"),
    ],
)
def test_a_bad_bundle_is_refused_whole(tmp_path: Path, record: dict, reviewer: str, message: str) -> None:
    out = tmp_path / "pack"
    build_pack(_pilot(tmp_path), out, repo_root=tmp_path)
    before = (out / "reviews" / "8346860__Oil__99999.json").read_text()
    bundle = _bundle(**record)
    bundle["reviewer"] = reviewer

    with pytest.raises(ReviewBundleError, match=message):
        apply_bundle(bundle, out)
    assert (out / "reviews" / "8346860__Oil__99999.json").read_text() == before
