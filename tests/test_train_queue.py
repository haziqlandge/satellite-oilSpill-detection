import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from ml.ablation.run_ablation import Cell
from scripts import train_queue as queue


def finish(project: Path, cell: Cell) -> None:
    folder = project / cell.name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "run.json").write_text(
        json.dumps(
            {
                "config": {"epochs": 60},
                "results": {"metrics/mAP50-95(M)": 0.2},
            }
        )
    )


def test_skips_completed_resumes_chunk_and_advances_in_order(tmp_path, monkeypatch):
    project, logs = tmp_path / "project", tmp_path / "logs"
    logs.mkdir()
    cells = [Cell("none", "ciou"), Cell("L1", "mpdiou"), Cell("L2", "mpdiou")]
    finish(project, cells[0])
    monkeypatch.setattr(queue, "grid", lambda: cells)
    calls = []

    def train(command, **kwargs):
        name = command[command.index("--only") + 1]
        calls.append(name)
        position, loss = name.split(":")
        cell = Cell(position, loss)
        if len(calls) == 1:
            folder = project / cell.name
            (folder / "weights").mkdir(parents=True)
            (folder / "weights/last.pt").write_bytes(b"checkpoint")
            (folder / "results.csv").write_text("epoch\n40\n")
            kwargs["stdout"].write("PAUSED: time boundary\n")
        else:
            finish(project, cell)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(queue.subprocess, "run", train)
    queue.run_pending(project, logs)
    assert calls == ["L1:mpdiou", "L1:mpdiou", "L2:mpdiou"]


@pytest.mark.parametrize("returncode", [0, 1])
def test_crash_or_no_progress_stops_queue(tmp_path, monkeypatch, returncode):
    logs = tmp_path / "logs"
    logs.mkdir()
    monkeypatch.setattr(queue, "grid", lambda: [Cell("L1", "mpdiou"), Cell("L2", "mpdiou")])
    calls = []

    def fail(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=returncode)

    monkeypatch.setattr(queue.subprocess, "run", fail)
    with pytest.raises(RuntimeError):
        queue.run_pending(tmp_path / "project", logs)
    assert len(calls) == 1


def test_stop_marker_prevents_launch(tmp_path, monkeypatch):
    (tmp_path / "queue.stop").touch()
    monkeypatch.setattr(queue.subprocess, "run", lambda *a, **k: pytest.fail("must not launch"))
    queue.run_pending(tmp_path / "project", tmp_path)


def test_final_queue_resumes_then_advances_selected_cells_and_skips_completed(
    tmp_path, monkeypatch
):
    project, logs = tmp_path / "project", tmp_path / "logs"
    logs.mkdir()
    calls = []

    def train(command, **kwargs):
        assert "scripts.train_final" in command
        name = command[command.index("--only") + 1]
        calls.append(name)
        folder = project / name
        folder.mkdir(parents=True, exist_ok=True)
        if len(calls) == 1:
            (folder / "weights").mkdir()
            (folder / "weights/last.pt").write_bytes(b"checkpoint")
            (folder / "results.csv").write_text("epoch\n70\n")
            kwargs["stdout"].write("PAUSED: time boundary\n")
            return SimpleNamespace(returncode=0)
        (folder / "run.json").write_text(
            json.dumps({"config": {"epochs": 100}, "results": {"metrics/mAP50-95(M)": 0.2}})
        )
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(queue.subprocess, "run", train)
    queue.run_pending(project, logs, final=True)
    assert calls == ["none-ciou", "none-ciou", "L1-ciou", "L4-ciou"]
    monkeypatch.setattr(queue.subprocess, "run", lambda *a, **k: pytest.fail("already complete"))
    queue.run_pending(project, logs, final=True)
