"""Smoke test del endpoint /health."""

from fastapi.testclient import TestClient

from pype.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service"] == "pype"
    assert isinstance(body["version"], str)
