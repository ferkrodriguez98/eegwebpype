"""ICA fit + components endpoints."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
from pathlib import Path

from fastapi.testclient import TestClient


def make_client() -> TestClient:
    from pype import config, main
    from pype.routers import config as config_router
    from pype.routers import detector, events, files, ica, sessions, workspace
    from pype.services import bad_detector, event_log, mne_engine, snapshots
    from pype.services import ica as ica_svc
    from pype.services import sessions as sess_svc
    from pype.services import workspace as ws_svc

    for mod in (
        config,
        bad_detector,
        mne_engine,
        snapshots,
        event_log,
        ica_svc,
        ws_svc,
        sess_svc,
        workspace,
        sessions,
        events,
        detector,
        ica,
        files,
        config_router,
        main,
    ):
        importlib.reload(mod)
    from pype.main import app

    return TestClient(app)


def test_ica_fit_and_components(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")

    r = client.post(
        "/api/sessions/TEST01_D1/ica/fit",
        json={"n_components": 4, "method": "infomax", "random_state": 0},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_components"] == 4

    r2 = client.get("/api/sessions/TEST01_D1/ica/components")
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert data["n_components"] == 4
    assert len(data["components"]) == 4
    comp = data["components"][0]
    assert "topo" in comp
    assert "series" in comp
    assert "label" in comp
    assert "prob" in comp


def test_components_404_before_fit(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.get("/api/sessions/TEST01_D1/ica/components")
    assert r.status_code == 404
