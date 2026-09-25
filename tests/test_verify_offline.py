"""The offline guard fires on a real reach and lets loopback through (PHASE-09).

A check that reports "nothing reached out" is worthless until it has been shown
to catch something that does.
"""

from __future__ import annotations

import socket

import pytest

from scripts.verify_offline import OfflineViolationError, install_guard


@pytest.fixture
def guard(monkeypatch):
    # Registered with monkeypatch first, so its undo puts the real ones back after the guard replaces them.
    for name in ("connect", "connect_ex"):
        monkeypatch.setattr(socket.socket, name, getattr(socket.socket, name))
    monkeypatch.setattr(socket, "getaddrinfo", socket.getaddrinfo)
    violations: list[str] = []
    install_guard(violations)
    return violations


def test_a_public_address_is_refused_and_recorded(guard) -> None:
    with socket.socket() as s, pytest.raises(OfflineViolationError):
        s.connect(("1.1.1.1", 443))
    with pytest.raises(OfflineViolationError):
        socket.getaddrinfo("data.marine.copernicus.eu", 443)
    assert guard == ["connect 1.1.1.1:443", "resolve 'data.marine.copernicus.eu'"]


def test_loopback_is_allowed(guard) -> None:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    with server, socket.socket() as client:
        client.connect(server.getsockname())
    socket.getaddrinfo("localhost", 80)
    assert guard == []
