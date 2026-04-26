"""Epochs endpoint."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
from pathlib import Path

from fastapi.testclient import TestClient


def make_client() -> TestClient:
    from pype import config, main
    from pype.routers import config as config_router
    from pype.routers import detector, epochs, events, files, ica, sessions, workspace
    from pype.services import bad_detector, event_log, mne_engine, snapshots
    from pype.services import epochs as epochs_svc
    from pype.services import ica as ica_svc
    from pype.services import sessions as sess_svc
    from pype.services import workspace as ws_svc

    for mod in (
        config,
        bad_detector,
        mne_engine,
        snapshots,
        event_log,
        epochs_svc,
        ica_svc,
        ws_svc,
        sess_svc,
        workspace,
        sessions,
        events,
        detector,
        epochs,
        ica,
        files,
        config_router,
        main,
    ):
        importlib.reload(mod)
    from pype.main import app

    return TestClient(app)


def test_epochs_2s_on_4s_signal(synthetic_bdf: Path) -> None:
    """4 s of data + 2 s epochs => 2 epochs."""
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.get("/api/sessions/TEST01_D1/epochs", params={"length": 2.0})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_epochs"] == 2
    assert body["n_channels"] == 8
    assert len(body["ptp_matrix"]) == 2
    assert len(body["ptp_matrix"][0]) == 8


def test_epochs_threshold_present(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.get("/api/sessions/TEST01_D1/epochs", params={"length": 1.0})
    assert r.status_code == 200
    body = r.json()
    assert body["threshold_uv"] >= 0
    assert isinstance(body["rejected_indices"], list)
