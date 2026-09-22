"""The stale-prefix rewrite must be safe, idempotent, and readable by Ultralytics.

The risk these guard is not "does it change the string". It is that a rewrite of
the frozen split silently changes *which tiles are in it*, or produces a form
Ultralytics passes through untouched -- both of which look fine until a training
run months later reports a dataset that does not exist.
"""

import json

import pytest
import yaml

from scripts import repath_artifacts as repath

STALE = "C:\\Users\\someone\\Downloads\\oilSpil2l16\\oilSpil2l\\data\\processed\\x.png"


def test_repo_relative_accepts_either_separator_and_any_home():
    forward = "D:/elsewhere/oilSpil2l16/oilSpil2l/data/processed/x.png"
    assert repath.repo_relative(STALE) == "data/processed/x.png"
    assert repath.repo_relative(forward) == "data/processed/x.png"


def test_repo_relative_leaves_an_already_relative_path_alone():
    assert repath.repo_relative("data/processed/x.png") is None
    assert repath.repo_relative("./../oos/images/train/x.png") is None


def _tree(tmp_path, monkeypatch):
    """A miniature of the real layout: split lists beside the images they name."""
    monkeypatch.setattr(repath, "REPO_ROOT", tmp_path)
    repath._RESOLVED.clear()
    images = tmp_path / "data/processed/dataset/oos/images/train"
    images.mkdir(parents=True)
    version = tmp_path / "data/processed/dataset/final-v11"
    version.mkdir(parents=True)
    for name in ("a", "b"):
        (images / f"{name}.png").write_bytes(b"")
    return version, images


def test_split_rewrite_is_relative_to_the_list_and_keeps_every_tile(tmp_path, monkeypatch):
    version, _ = _tree(tmp_path, monkeypatch)
    listing = version / "train.txt"
    prefix = "C:/Users/someone/Downloads/oilSpil2l16/oilSpil2l"
    listing.write_text(
        f"{prefix}/data/processed/dataset/oos/images/train/a.png\n"
        f"{prefix}/data/processed/dataset/oos/images/train/b.png\n"
    )

    assert repath.fix_split_list(listing, apply=True) == 2
    lines = listing.read_text().splitlines()
    assert lines == ["./../oos/images/train/a.png", "./../oos/images/train/b.png"]
    # The leading "./" is what Ultralytics rewrites against the list's own
    # directory; without it the line is passed through as-is.
    assert all(line.startswith("./") for line in lines)
    for line in lines:
        assert (listing.parent / line).resolve().exists()


def test_split_rewrite_is_idempotent(tmp_path, monkeypatch):
    version, _ = _tree(tmp_path, monkeypatch)
    listing = version / "train.txt"
    listing.write_text(
        "C:/Users/someone/Downloads/oilSpil2l16/oilSpil2l"
        "/data/processed/dataset/oos/images/train/a.png\n"
    )
    repath.fix_split_list(listing, apply=True)
    once = listing.read_text()
    assert repath.fix_split_list(listing, apply=True) == 0
    assert listing.read_text() == once


def test_split_rewrite_refuses_a_reference_that_does_not_resolve(tmp_path, monkeypatch):
    version, _ = _tree(tmp_path, monkeypatch)
    listing = version / "train.txt"
    listing.write_text(
        "C:/Users/someone/Downloads/oilSpil2l16/oilSpil2l"
        "/data/processed/dataset/oos/images/train/missing.png\n"
    )
    with pytest.raises(repath.RepathError, match="does not resolve"):
        repath.fix_split_list(listing, apply=True)


def test_check_mode_writes_nothing(tmp_path, monkeypatch):
    version, _ = _tree(tmp_path, monkeypatch)
    listing = version / "train.txt"
    original = (
        "C:/Users/someone/Downloads/oilSpil2l16/oilSpil2l"
        "/data/processed/dataset/oos/images/train/a.png\n"
    )
    listing.write_text(original)
    assert repath.fix_split_list(listing, apply=False) == 1
    assert listing.read_text() == original


def test_data_yaml_loses_path_so_the_root_is_the_file_it_sits_in(tmp_path, monkeypatch):
    version, _ = _tree(tmp_path, monkeypatch)
    yaml_file = version / "data.yaml"
    yaml_file.write_text(
        yaml.safe_dump(
            dict(path="C:/Users/someone/x", train="train.txt", nc=1, names={0: "slick"})
        )
    )
    assert repath.fix_data_yaml(yaml_file, apply=True) == 1
    document = yaml.safe_load(yaml_file.read_text())
    assert "path" not in document
    assert document["train"] == "train.txt"
    assert document["names"] == {0: "slick"}
    assert repath.fix_data_yaml(yaml_file, apply=True) == 0


def test_json_rewrite_only_touches_the_named_fields(tmp_path, monkeypatch):
    _tree(tmp_path, monkeypatch)
    record = tmp_path / "manifest.json"
    stale = (
        "C:/Users/someone/Downloads/oilSpil2l16/oilSpil2l"
        "/data/processed/dataset/oos/images/train/a.png"
    )
    record.write_text(json.dumps({"retained": [{"path": stale, "note": stale}]}))
    assert repath._fix_json_fields(record, ("path",), apply=True) == 1
    document = json.loads(record.read_text())
    assert document["retained"][0]["path"] == "data/processed/dataset/oos/images/train/a.png"
    assert document["retained"][0]["note"] == stale


def test_the_repository_itself_is_clean():
    """A guard, not a unit test: no artifact still points at another machine.

    Passes vacuously on a clean clone, where `data/` and `runs/` are absent --
    there is nothing to be stale. It bites on a machine that has them.
    """
    assert repath.main(["--check"]) == 0, "run `python -m scripts.repath_artifacts` to fix"
