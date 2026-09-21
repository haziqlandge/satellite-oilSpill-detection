"""The ablation grid's bookkeeping — resume, ordering and the results table.

No training happens here. What these defend is that a 30-hour grid can be
interrupted and continued without silently skipping or repeating a cell, and
that the table it produces states its own caveats rather than presenting a
screened run as a 100-epoch one.
"""

from __future__ import annotations

import json
from pathlib import Path

from ml.ablation.run_ablation import (
    LOSSES,
    Cell,
    grid,
    is_complete,
    write_results,
)
from ml.models.yolo_seg_lsk import POSITIONS


def _record(project: Path, name: str, *, results: dict | None) -> Path:
    path = project / name / "run.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict = {"config": {"batch": 8, "workers": 3}}
    if results is not None:
        payload["results"] = results
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_the_grid_is_twelve_cells() -> None:
    """Six LSK positions x two losses -- P004 Table 1."""

    cells = grid()
    assert len(cells) == len(POSITIONS) * len(LOSSES) == 12
    assert len({c.name for c in cells}) == 12


def test_the_grid_covers_every_combination() -> None:
    pairs = {(c.position, c.loss) for c in grid()}
    assert pairs == {(p, loss) for p in POSITIONS for loss in LOSSES}


def test_a_finished_cell_is_skipped(tmp_path: Path) -> None:
    _record(tmp_path, "L5-mpdiou", results={"metrics/mAP50-95(M)": 0.5})

    assert is_complete(Cell("L5", "mpdiou"), tmp_path)


def test_a_cell_killed_before_finishing_is_retried(tmp_path: Path) -> None:
    """The pre-flight record is written *before* training starts.

    Treating the file's existence as completion would skip every run that died
    part-way -- and a 30-hour grid will be interrupted.
    """

    _record(tmp_path, "L5-mpdiou", results=None)

    assert not is_complete(Cell("L5", "mpdiou"), tmp_path)


def test_an_unstarted_cell_is_not_complete(tmp_path: Path) -> None:
    assert not is_complete(Cell("none", "ciou"), tmp_path)


def test_a_corrupt_record_is_retried_not_trusted(tmp_path: Path) -> None:
    path = tmp_path / "L1-ciou" / "run.json"
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")

    assert not is_complete(Cell("L1", "ciou"), tmp_path)


def test_the_results_table_states_the_screening_caveat(tmp_path: Path) -> None:
    """A screened grid presented as a 100-epoch grid would misrepresent it."""

    _record(tmp_path, "none-ciou", results={"metrics/mAP50-95(M)": 0.41, "metrics/mAP50(M)": 0.62})
    out = write_results(tmp_path, 60, tmp_path / "results.md")
    text = out.read_text(encoding="utf-8")

    assert "60 epochs" in text
    assert "not a 100-epoch grid" in text
    assert "binary baseline" in text  # not the two-class model
    assert "workers" in text  # the deviation is disclosed


def test_only_completed_cells_appear(tmp_path: Path) -> None:
    _record(tmp_path, "none-ciou", results={"metrics/mAP50-95(M)": 0.41, "metrics/mAP50(M)": 0.62})
    _record(tmp_path, "L1-ciou", results=None)

    text = write_results(tmp_path, 60, tmp_path / "results.md").read_text(encoding="utf-8")

    assert "| none | CIOU |" in text
    assert "| L1 | CIOU |" not in text


def test_an_empty_grid_still_writes_a_table(tmp_path: Path) -> None:
    text = write_results(tmp_path, 60, tmp_path / "results.md").read_text(encoding="utf-8")

    assert "no completed runs yet" in text


def test_results_report_progress_and_material_l2_gap(tmp_path: Path) -> None:
    _record(tmp_path, "none-ciou", results={"metrics/mAP50-95(M)": 0.19818})
    _record(tmp_path, "L1-ciou", results={"metrics/mAP50-95(M)": 0.19854})
    _record(tmp_path, "L2-ciou", results={"metrics/mAP50-95(M)": 0.19048})

    text = write_results(tmp_path, 60, tmp_path / "results.md").read_text(encoding="utf-8")

    assert "Progress: 3 of 12" in text
    assert "0.00770 below `none-ciou`" in text
    assert "0.00806 below `L1-ciou`" in text
    assert "single-seed screen" in text


# --- pretrained transfer must be identical across cells --------------------


def test_the_l1_index_map_shifts_only_the_backbone_tail() -> None:
    """L1 splices at index 9, so stock layers 9+ move up one; 0-8 do not."""

    from ml.models.yolo_seg_lsk import stock_index_map

    mapping = stock_index_map("L1")
    assert 8 not in mapping
    assert mapping[9] == 10
    assert mapping[23] == 24


def test_positions_other_than_l1_need_no_remap() -> None:
    """They append after every stock layer, so indices are untouched."""

    from ml.models.yolo_seg_lsk import stock_index_map

    for position in ("none", "L2", "L3", "L4", "L5"):
        assert stock_index_map(position) == {}


import pytest  # noqa: E402


@pytest.mark.slow
def test_every_cell_receives_the_same_pretrained_weights() -> None:
    """The confound that would have invalidated the whole grid.

    Handing a YAML to `YOLO()` builds from random initialisation, and layer
    indices shift differently per position, so without care the cells start from
    materially different points and the grid measures pretraining rather than
    LSK. Measured during development, before the fixes:

        none 510   L1 192   L2-L5 378   (of ~394 non-head tensors)

    All six must now agree exactly. LSK's own tensors have no pretrained
    counterpart and stay random, which is correct -- only they are new.
    """

    import tempfile

    from ultralytics import YOLO

    from ml.ablation.run_ablation import PRETRAINED, load_pretrained_backbone
    from ml.models.yolo_seg_lsk import POSITIONS, register_lsk, write_config

    register_lsk()
    root = Path(tempfile.mkdtemp())

    transferred = {}
    for position in POSITIONS:
        model = YOLO(str(write_config(position, root / f"y-{position}.yaml")), task="segment")
        count, _ = load_pretrained_backbone(model, PRETRAINED, position)
        transferred[position] = count

    assert len(set(transferred.values())) == 1, transferred
    assert all(v > 0 for v in transferred.values())
