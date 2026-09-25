"""A hosted pipeline admits the deployed console and nobody else (FUTURE_WORK §4.3)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import create_app

SITE = "https://satellite-oil-spill-detection.vercel.app"


def _allowed(client: TestClient, origin: str) -> str | None:
    response = client.options("/api/v1/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
    return response.headers.get("access-control-allow-origin")


def test_the_configured_site_and_local_dev_are_admitted_a_stranger_is_not(monkeypatch) -> None:
    monkeypatch.setenv("API_CORS_ORIGINS", f"{SITE}/, https://another.example")
    with TestClient(create_app(probe_database=False, warm=False)) as client:
        assert _allowed(client, SITE) == SITE
        assert _allowed(client, "http://localhost:5180") == "http://localhost:5180"
        assert _allowed(client, "https://evil.example") is None


def test_with_nothing_configured_only_local_dev_is_admitted(monkeypatch) -> None:
    monkeypatch.setenv("API_CORS_ORIGINS", "")
    with TestClient(create_app(probe_database=False, warm=False)) as client:
        assert _allowed(client, SITE) is None
        assert _allowed(client, "http://127.0.0.1:5190") == "http://127.0.0.1:5190"
