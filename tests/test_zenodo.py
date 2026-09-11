"""Zenodo verification logic. A truncated archive must never pass."""

from __future__ import annotations

import hashlib
import io
import itertools
import json
from pathlib import Path

import pytest

from backend.ingest.datasets.zenodo import (
    RECORDS,
    ZenodoError,
    ZenodoFile,
    download_file,
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


class _Response:
    """Minimal stand-in for the object `urlopen` returns.

    `status` is the part that matters: a server may honour `Range` with 206, or
    ignore it and answer 200 with the whole file. Appending in the second case
    silently corrupts the archive, so the two must be told apart.
    """

    def __init__(self, body: bytes, status: int = 200) -> None:
        self._body = io.BytesIO(body)
        self.status = status

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def _capture(responses: list[_Response], seen: list[dict[str, str]]):
    def _open(request, *_a, **_k):  # type: ignore[no-untyped-def]
        seen.append(dict(getattr(request, "headers", {}) or {}))
        return responses.pop(0)

    return _open


def test_download_resumes_from_a_partial_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A half-received archive continues rather than restarting."""

    body = b"oilspill" * 128
    target = tmp_path / "part1.7z"
    partial = tmp_path / "part1.7z.part"
    partial.write_bytes(body[:400])

    entry = ZenodoFile(
        key="part1.7z",
        size=len(body),
        checksum=f"md5:{hashlib.md5(body).hexdigest()}",
        link="https://zenodo.invalid/part1.7z",
    )
    seen: list[dict[str, str]] = []
    monkeypatch.setattr(
        "backend.ingest.datasets.zenodo.urlopen",
        _capture([_Response(body[400:], status=206)], seen),
    )

    result = download_file(entry, target)

    assert result.read_bytes() == body
    assert not partial.exists()
    # The range header must ask for exactly what is missing.
    assert any("bytes=400-" in value for value in seen[0].values())


def test_download_restarts_when_the_server_ignores_range(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The CDSE trap: a 200 to a ranged request means the whole file came back.

    Appending it onto the partial bytes would produce a corrupt archive that
    still has a plausible size, so the partial must be discarded instead.
    """

    body = b"lookalike" * 96
    target = tmp_path / "part2.7z"
    (tmp_path / "part2.7z.part").write_bytes(body[:300])

    entry = ZenodoFile(
        key="part2.7z",
        size=len(body),
        checksum=f"md5:{hashlib.md5(body).hexdigest()}",
        link="https://zenodo.invalid/part2.7z",
    )
    monkeypatch.setattr(
        "backend.ingest.datasets.zenodo.urlopen",
        _capture([_Response(body, status=200)], []),
    )

    result = download_file(entry, target)

    assert result.read_bytes() == body


def test_download_leaves_a_verified_file_alone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Re-running a 91 GB fetch must not re-download what is already correct."""

    body = b"already here"
    target = tmp_path / "done.7z"
    target.write_bytes(body)
    entry = _entry(target)

    def _explode(*_a: object, **_k: object) -> None:
        raise AssertionError("download attempted for an already-verified file")

    monkeypatch.setattr("backend.ingest.datasets.zenodo.urlopen", _explode)

    assert download_file(entry, target) == target


def test_download_keeps_the_partial_when_the_checksum_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A corrupt result must raise, and must not be left as a final filename."""

    target = tmp_path / "bad.7z"
    entry = ZenodoFile(
        key="bad.7z",
        size=8,
        checksum="md5:" + hashlib.md5(b"expected").hexdigest(),
        link="https://zenodo.invalid/bad.7z",
    )
    monkeypatch.setattr(
        "backend.ingest.datasets.zenodo.urlopen",
        _capture([_Response(b"WRONGWRO", status=200)], []),
    )

    with pytest.raises(ZenodoError, match="checksum"):
        download_file(entry, target)

    assert not target.exists()


# --- parallel segmented download -------------------------------------------
#
# Zenodo throttles per connection, so four disjoint ranges run ~4x a single
# stream (measured 2026-08-31: 19.4 MB/s vs a contended 0.7). The risk that
# buys is an archive of exactly the right *size* and wrong *content*, which is
# why every test below is about ordering, ranges and the 206 check rather than
# about speed.


class _RangeServer:
    """Serves byte ranges out of an in-memory payload, counting connections."""

    def __init__(self, payload: bytes, *, honour_range: bool = True) -> None:
        self.payload = payload
        self.honour_range = honour_range
        self.requests: list[str | None] = []

    def __call__(self, request, timeout=None):
        header = request.headers.get("Range")
        self.requests.append(header)
        if header and self.honour_range:
            spec = header.split("=", 1)[1]
            start_text, _, end_text = spec.partition("-")
            start = int(start_text)
            end = int(end_text) if end_text else len(self.payload) - 1
            return _FakeResponse(self.payload[start : end + 1], status=206)
        return _FakeResponse(self.payload, status=200)


class _FakeResponse:
    def __init__(self, body: bytes, status: int) -> None:
        self._body = body
        self._offset = 0
        self.status = status

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = len(self._body) - self._offset
        chunk = self._body[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def _bytes_entry(payload: bytes, link: str = "https://example.invalid/big.7z"):
    from backend.ingest.datasets.zenodo import ZenodoFile

    return ZenodoFile(
        key="big.7z",
        size=len(payload),
        checksum=f"md5:{hashlib.md5(payload).hexdigest()}",
        link=link,
    )


def _payload(size: int) -> bytes:
    # Position-dependent, so a mis-ordered assembly cannot accidentally match.
    return bytes((i * 7 + (i >> 8)) % 251 for i in range(size))


def test_parallel_download_assembles_segments_in_order(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Out-of-order assembly gives the right size and wrong bytes."""

    from backend.ingest.datasets import zenodo as module

    payload = _payload(module.MIN_PARALLEL_BYTES + 5000)
    server = _RangeServer(payload)
    monkeypatch.setattr(module, "urlopen", server)

    target = tmp_path / "big.7z"
    module.download_file_parallel(_bytes_entry(payload), target, connections=4)

    assert target.read_bytes() == payload


def test_parallel_download_opens_one_connection_per_segment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.ingest.datasets import zenodo as module

    payload = _payload(module.MIN_PARALLEL_BYTES + 5000)
    server = _RangeServer(payload)
    monkeypatch.setattr(module, "urlopen", server)

    module.download_file_parallel(_bytes_entry(payload), tmp_path / "big.7z", connections=4)

    assert len(server.requests) == 4
    assert all(r is not None and r.startswith("bytes=") for r in server.requests)


def test_segments_cover_the_file_exactly_with_no_gap_or_overlap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A gap truncates the archive; an overlap corrupts it. Both pass a size check."""

    from backend.ingest.datasets import zenodo as module

    payload = _payload(module.MIN_PARALLEL_BYTES + 12345)
    server = _RangeServer(payload)
    monkeypatch.setattr(module, "urlopen", server)

    module.download_file_parallel(_bytes_entry(payload), tmp_path / "big.7z", connections=4)

    spans = sorted(
        (int(r.split("=")[1].split("-")[0]), int(r.split("-")[1])) for r in server.requests
    )
    assert spans[0][0] == 0
    assert spans[-1][1] == len(payload) - 1
    for (_, end), (next_start, _) in itertools.pairwise(spans):
        assert next_start == end + 1


def test_a_server_that_ignores_range_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CDSE answers 200 with the whole file; treating that as a segment corrupts.

    The result would be an archive of plausible size and wrong content.
    """

    from backend.ingest.datasets import zenodo as module

    payload = _payload(module.MIN_PARALLEL_BYTES + 5000)
    monkeypatch.setattr(module, "urlopen", _RangeServer(payload, honour_range=False))

    with pytest.raises(module.ZenodoError, match="ranged request"):
        module.download_file_parallel(_bytes_entry(payload), tmp_path / "big.7z", connections=4)

    assert not (tmp_path / "big.7z").exists()


def test_a_bad_checksum_leaves_no_final_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.ingest.datasets import zenodo as module
    from backend.ingest.datasets.zenodo import ZenodoFile

    payload = _payload(module.MIN_PARALLEL_BYTES + 5000)
    monkeypatch.setattr(module, "urlopen", _RangeServer(payload))
    wrong = ZenodoFile(
        key="big.7z",
        size=len(payload),
        checksum="md5:" + "0" * 32,
        link="https://example.invalid/big.7z",
    )

    with pytest.raises(module.ZenodoError, match="checksum"):
        module.download_file_parallel(wrong, tmp_path / "big.7z", connections=4)

    assert not (tmp_path / "big.7z").exists()


def test_an_existing_serial_part_is_kept_as_a_prefix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Switching to the parallel path mid-transfer must not discard 23 GB."""

    from backend.ingest.datasets import zenodo as module

    payload = _payload(module.MIN_PARALLEL_BYTES * 2)
    server = _RangeServer(payload)
    monkeypatch.setattr(module, "urlopen", server)

    target = tmp_path / "big.7z"
    prefix = len(payload) // 3
    target.with_name("big.7z.part").write_bytes(payload[:prefix])

    module.download_file_parallel(_bytes_entry(payload), target, connections=4)

    assert target.read_bytes() == payload
    # Nothing re-fetched below the prefix.
    assert min(int(r.split("=")[1].split("-")[0]) for r in server.requests) == prefix


def test_a_small_file_falls_back_to_the_serial_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Splitting a 30 MB mask archive costs more than it returns."""

    from backend.ingest.datasets import zenodo as module

    payload = _payload(1024)
    server = _RangeServer(payload)
    monkeypatch.setattr(module, "urlopen", server)

    module.download_file_parallel(_bytes_entry(payload), tmp_path / "big.7z", connections=4)

    assert len(server.requests) == 1


def test_segments_are_cleaned_up_on_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.ingest.datasets import zenodo as module

    payload = _payload(module.MIN_PARALLEL_BYTES + 5000)
    monkeypatch.setattr(module, "urlopen", _RangeServer(payload))

    module.download_file_parallel(_bytes_entry(payload), tmp_path / "big.7z", connections=4)

    assert list(tmp_path.glob("*.seg*")) == []
    assert list(tmp_path.glob("*.part")) == []
