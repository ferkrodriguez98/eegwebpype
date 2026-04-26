"""Export endpoint: clean-epo.fif + log.json."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
import json
from pathlib import Path

from fastapi.testclient import TestClient


def make_client() -> TestClient:
    from pype import config, main
    from pype.routers import config as config_router
    from pype.routers import detector, epochs, events, export, files, ica, sessions, workspace
    from pype.services import bad_detector, event_log, mne_engine, snapshots
    from pype.services import epochs as epochs_svc
    from pype.services import export as export_svc
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
        export_svc,
        ica_svc,
        ws_svc,
        sess_svc,
        workspace,
        sessions,
        events,
        detector,
        epochs,
        export,
        ica,
        files,
        config_router,
        main,
    ):
        importlib.reload(mod)
    from pype.main import app

    return TestClient(app)


def test_export_requires_epoch_event(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.post("/api/sessions/TEST01_D1/export")
    # No epoch event yet → 400.
    assert r.status_code == 400


def test_export_writes_fif_and_log(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={
            "op": "epoch",
            "params": {"length_seconds": 2.0, "overlap": 0.0, "detrend": 1},
        },
    )
    r = client.post("/api/sessions/TEST01_D1/export")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_epochs"] >= 1
    assert Path(body["fif_path"]).exists()
    assert Path(body["log_path"]).exists()
    log = json.loads(Path(body["log_path"]).read_text())
    assert log["id"] == "TEST01_D1"
    assert log["events"][0]["op"] == "load"
    assert any(ev["op"] == "epoch" for ev in log["events"])


def test_export_respects_reject_epochs(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "epoch", "params": {"length_seconds": 1.0, "overlap": 0.0, "detrend": 1}},
    )
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "reject_epochs", "params": {"indices": [0], "reason": "manual"}},
    )
    r = client.post("/api/sessions/TEST01_D1/export")
    assert r.status_code == 200
    body = r.json()
    # 4 s of data → 4 epochs of 1 s. After rejecting 1, expect 3.
    assert body["n_epochs"] == 3
