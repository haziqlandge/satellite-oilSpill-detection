import cv2
import numpy as np
from PIL import Image

from scripts import verify_split_overlap as overlap
from scripts.prepare_final_dataset import deduplicate


def test_duplicate_priority_keeps_holdout_and_reports_label_conflict():
    rows = [
        dict(split="train", name="a", path="train/a", pixel_sha256="same", label_sha256="one"),
        dict(split="val", name="b", path="val/b", pixel_sha256="same", label_sha256="two"),
        dict(split="test", name="c", path="test/c", pixel_sha256="same", label_sha256="two"),
    ]
    kept, removed = deduplicate(rows)
    assert [r["split"] for r in kept] == ["test"]
    assert {r["split"] for r in removed} == {"train", "val"}
    assert next(r for r in removed if r["split"] == "train")["label_conflict"]


def test_local_feature_registration_finds_rotated_crop_not_unrelated_texture(tmp_path, monkeypatch):
    for split in ["train", "val"]:
        (tmp_path / split).mkdir()
    rng = np.random.default_rng(3)
    original = cv2.GaussianBlur(rng.integers(10, 245, (400, 400), dtype=np.uint8), (3, 3), 0.7)
    unrelated = cv2.GaussianBlur(rng.integers(10, 245, (400, 400), dtype=np.uint8), (3, 3), 0.7)
    Image.fromarray(original).save(tmp_path / "train/source.png")
    Image.fromarray(unrelated).save(tmp_path / "train/unrelated.png")
    Image.fromarray(np.rot90(original[30:360, 40:370])).save(tmp_path / "val/crop.png")
    monkeypatch.setattr(overlap, "BASE", tmp_path)
    index = [overlap.features(p) for p in sorted((tmp_path / "train").glob("*.png"))]
    query = [overlap.features(tmp_path / "val/crop.png")]
    found = overlap.search(index, query, "train", "val")
    assert any(r["left"] == "source.png" and r["verified"] for r in found)
    assert not any(r["left"] == "unrelated.png" and r["verified"] for r in found)


def test_final_preflight_rejects_split_membership_change(tmp_path, monkeypatch):
    import json

    import pytest

    from scripts import train_final

    rows = []
    for split in ("train", "val", "test"):
        image = tmp_path / "images" / split / "tile.png"
        label = tmp_path / "labels" / split / "tile.txt"
        image.parent.mkdir(parents=True)
        label.parent.mkdir(parents=True)
        image.write_bytes(split.encode())
        label.write_text("")
        rows.append(
            dict(
                path=str(image),
                split=split,
                pixel_sha256=split,
                image_sha256=train_final.digest(image),
                label_sha256=train_final.digest(label),
            )
        )
        (tmp_path / f"{split}.txt").write_text(str(image) + "\n")
    manifest = dict(retained=rows, counts=dict(train=1, val=1, test=1))
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(train_final, "DATA", tmp_path)
    assert train_final.verify_data() == manifest
    (tmp_path / "train.txt").write_text(rows[1]["path"] + "\n")
    with pytest.raises(RuntimeError, match="split list does not match"):
        train_final.verify_data()
