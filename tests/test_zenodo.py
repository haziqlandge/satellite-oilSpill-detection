"""Zenodo verification logic. A truncated archive must never pass."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import pytest

from backend.ingest.datasets.zenodo import (
    RECORDS,
    ZenodoError,
    ZenodoFile,
    fetch_record,
    verify,
)


class _Ctx:
    def __init__(self, payload: io.BytesIO) -> None:
        self._payload = payload

    def __enter__(self) -> io.BytesIO:
        return self._payload

    def __exit__(self, *_: object) -> None:
        return None


def _entry(path: Path, *, size: int | None = None, digest: str | None = None) -> ZenodoFile:
    data = path.read_bytes()
    return ZenodoFile(
        key=path.name,
        size=len(data) if size is None else size,
        checksum=f"md5:{hashlib.md5(data).hexdigest() if digest is None else digest}",
        link="https://example.invalid/file",
    )


def test_all_four_planned_records_are_listed() -> None:
    """The plan depends on Parts I-III plus the Refined SOS masks."""

    assert set(RECORDS) == {"8346860", "8253899", "13761290", "15298010"}


def test_verify_accepts_an_intact_file(tmp_path: Path) -> None:
    path = tmp_path / "a.zip"
    path.write_bytes(b"payload" * 100)
    assert verify(path, _entry(path)) is True


def test_verify_rejects_a_truncated_file(tmp_path: Path) -> None:
    """The failure mode this module exists to catch."""

    path = tmp_path / "a.zip"
    path.write_bytes(b"payload" * 100)
    entry = _entry(path)
    path.write_bytes(b"payload" * 50)  # truncate after the checksum was taken

    assert verify(path, entry) is False


def test_verify_rejects_corruption_at_the_same_size(tmp_path: Path) -> None:
    """Same length, different bytes -- only the checksum catches this."""

    path = tmp_path / "a.zip"
    path.write_bytes(b"A" * 700)
    entry = _entry(path)
    path.write_bytes(b"B" * 700)

    assert verify(path, entry) is False


def test_verify_rejects_a_missing_file(tmp_path: Path) -> None:
    path = tmp_path / "gone.zip"
    entry = ZenodoFile(key="gone.zip", size=10, checksum="md5:x", link="https://example.invalid")
    assert verify(path, entry) is False


def test_verify_falls_back_to_size_when_no_checksum_published(tmp_path: Path) -> None:
    path = tmp_path / "a.zip"
    path.write_bytes(b"x" * 64)
    entry = ZenodoFile(key="a.zip", size=64, checksum="", link="https://example.invalid")

    assert verify(path, entry) is True


def test_fetch_record_parses_files(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "files": [
            {
                "key": "part1.zip",
                "size": 123,
                "checksum": "md5:abc123",
                "links": {"self": "https://zenodo.invalid/part1.zip"},
            }
        ]
    }
    monkeypatch.setattr(
        "backend.ingest.datasets.zenodo.urlopen",
        lambda *_a, **_k: _Ctx(io.BytesIO(json.dumps(payload).encode())),
    )

    files = fetch_record("8346860")

    assert len(files) == 1
    assert files[0].key == "part1.zip"
    assert files[0].algorithm == "md5"
    assert files[0].digest == "abc123"


def test_fetch_record_raises_when_no_files(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.ingest.datasets.zenodo.urlopen",
        lambda *_a, **_k: _Ctx(io.BytesIO(json.dumps({"files": []}).encode())),
    )

    with pytest.raises(ZenodoError, match="no files"):
        fetch_record("8346860")
