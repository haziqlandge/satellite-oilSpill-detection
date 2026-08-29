"""CDSE client logic that must not break silently: token reuse, expiry, sizing."""

from __future__ import annotations

import io
import json
from typing import Any

import pytest

from backend.ingest.sar.cdse import (
    TOKEN_SAFETY_MARGIN_S,
    CdseClient,
    CdseError,
    _content_length,
)


class _FakeHeaders:
    def __init__(self, mapping: dict[str, str]) -> None:
        self._mapping = mapping

    def get(self, key: str) -> str | None:
        return self._mapping.get(key)


class _FakeResponse:
    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = _FakeHeaders(headers)


def _token_payload(token: str, expires_in: int | None = 600) -> io.BytesIO:
    body: dict[str, Any] = {"access_token": token}
    if expires_in is not None:
        body["expires_in"] = expires_in
    return io.BytesIO(json.dumps(body).encode())


class _Ctx:
    def __init__(self, payload: io.BytesIO) -> None:
        self._payload = payload

    def __enter__(self) -> io.BytesIO:
        return self._payload

    def __exit__(self, *_: object) -> None:
        return None


def test_token_is_cached_and_not_refetched(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def fake_urlopen(*_a: object, **_k: object) -> _Ctx:
        calls["n"] += 1
        return _Ctx(_token_payload(f"tok{calls['n']}"))

    monkeypatch.setattr("backend.ingest.sar.cdse.urlopen", fake_urlopen)
    client = CdseClient(username="u", password="p")

    assert client.token() == "tok1"
    assert client.token() == "tok1", "a live token must be reused, not refetched"
    assert calls["n"] == 1


def test_force_refresh_gets_a_new_token(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def fake_urlopen(*_a: object, **_k: object) -> _Ctx:
        calls["n"] += 1
        return _Ctx(_token_payload(f"tok{calls['n']}"))

    monkeypatch.setattr("backend.ingest.sar.cdse.urlopen", fake_urlopen)
    client = CdseClient(username="u", password="p")

    assert client.token() == "tok1"
    assert client.token(force_refresh=True) == "tok2"
    assert calls["n"] == 2


def test_token_expiry_applies_a_safety_margin(monkeypatch: pytest.MonkeyPatch) -> None:
    """A token must be treated as stale before the server's stated expiry.

    Without the margin a token can expire while the request is in flight,
    which is the PHASE-01 'OAuth token expiry mid-download' failure.
    """

    monkeypatch.setattr(
        "backend.ingest.sar.cdse.urlopen",
        lambda *_a, **_k: _Ctx(_token_payload("tok", expires_in=600)),
    )
    monkeypatch.setattr("backend.ingest.sar.cdse.time.monotonic", lambda: 1000.0)

    client = CdseClient(username="u", password="p")
    client.token()

    assert client._expires_at == pytest.approx(1000.0 + 600 - TOKEN_SAFETY_MARGIN_S)


def test_missing_access_token_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.ingest.sar.cdse.urlopen",
        lambda *_a, **_k: _Ctx(io.BytesIO(json.dumps({"nope": 1}).encode())),
    )
    client = CdseClient(username="u", password="p")

    with pytest.raises(CdseError, match="no access_token"):
        client.token()


def test_content_length_prefers_content_range_total() -> None:
    response = _FakeResponse({"Content-Range": "bytes 100-999/5000", "Content-Length": "900"})
    assert _content_length(response, offset=100) == 5000


def test_content_length_adds_offset_when_only_content_length_is_given() -> None:
    """A resumed transfer reports only the remaining bytes, not the total."""

    response = _FakeResponse({"Content-Length": "900"})
    assert _content_length(response, offset=100) == 1000


def test_content_length_is_none_when_unstated() -> None:
    assert _content_length(_FakeResponse({}), offset=0) is None
