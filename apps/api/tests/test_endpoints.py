"""HTTP endpoint integration tests."""

from __future__ import annotations

import importlib
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient


def make_client() -> TestClient:
    """Reload main so app sees the test PYPE_DATA_DIR."""
    from pype import config, main
    from pype.services import sessions, workspace

    for mod in (config, workspace, sessions, main):
        importlib.reload(mod)
    return TestClient(main.app)


def test_health(synthetic_bdf: Path) -> None:
    client = make_client()
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True


def test_workspace_scan_and_get(synthetic_bdf: Path) -> None:
    client = make_client()
    r = client.post("/api/workspace/scan")
    assert r.status_code == 200
    ws = r.json()
    ids = [s["id"] for s in ws["sessions"]]
    assert "TEST01_D1" in ids

    r = client.get("/api/workspace")
    assert r.status_code == 200
    assert any(s["id"] == "TEST01_D1" for s in r.json()["sessions"])


def test_session_get(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")

    r = client.get("/api/sessions/TEST01_D1")
    assert r.status_code == 200
    body = r.json()
    assert body["subject"] == "TEST01"
    assert body["session"] == "D1"
    assert body["events"][0]["op"] == "load"


def test_session_signal_returns_arrow(synthetic_bdf: Path) -> None:
    from pype.services.signal_serde import decode_arrow

    client = make_client()
    client.post("/api/workspace/scan")

    r = client.get("/api/sessions/TEST01_D1/signal", params={"t_start": 0, "t_end": 2})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.apache.arrow")
    decoded = decode_arrow(r.content)
    assert "times" in decoded
    assert "E1" in decoded
    assert decoded["times"].shape[0] > 0
    # times array monotonically increasing
    times = decoded["times"]
    assert np.all(np.diff(times) >= 0)


def test_session_psd_returns_arrow(synthetic_bdf: Path) -> None:
    from pype.services.signal_serde import decode_arrow

    client = make_client()
    client.post("/api/workspace/scan")

    r = client.get(
        "/api/sessions/TEST01_D1/psd",
        params={"fmin": 1.0, "fmax": 50.0},
    )
    assert r.status_code == 200
    decoded = decode_arrow(r.content)
    assert "freqs" in decoded
    assert "E1" in decoded
    assert decoded["freqs"].shape[0] > 5


def test_session_404(synthetic_bdf: Path) -> None:
    client = make_client()
    r = client.get("/api/sessions/UNKNOWN_D1")
    assert r.status_code == 404
