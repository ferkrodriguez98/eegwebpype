"""Batch endpoint."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
import shutil
from pathlib import Path

from fastapi.testclient import TestClient


def make_client() -> TestClient:
    from pype import config, main
    from pype.routers import (
        batch,
        compare,
        detector,
        epochs,
        events,
        export,
        files,
        ica,
        sessions,
        workspace,
    )
    from pype.routers import config as config_router
    from pype.services import bad_detector, event_log, mne_engine, snapshots
    from pype.services import batch as batch_svc
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
        batch_svc,
        ws_svc,
        sess_svc,
        compare,
        sessions,
        events,
        detector,
        epochs,
        export,
        ica,
        files,
        config_router,
        workspace,
        batch,
        main,
    ):
        importlib.reload(mod)
    from pype.main import app

    return TestClient(app)


def test_batch_runs_recipe(synthetic_bdf: Path) -> None:
    """Two sessions, recipe with one filter step, auto detect → both get done."""
    sources = synthetic_bdf.parent
    d2 = sources / "TEST01_MEV_D2_REST.fif"
    shutil.copy(synthetic_bdf, d2)

    client = make_client()
    client.post("/api/workspace/scan")

    r = client.post(
        "/api/batch/run",
        json={
            "session_ids": ["TEST01_D1", "TEST01_D2"],
            "recipe": {
                "steps": [
                    {
                        "op": "filter",
                        "params": {"l_freq": 1.0, "h_freq": 30.0},
                    }
                ],
                "auto_detect_bads": True,
                "pause_threshold": 0.5,
            },
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["results"]) == 2
    for res in body["results"]:
        assert res["status"] in ("done", "needs_review")
        assert res["n_events_appended"] >= 1


def test_batch_unknown_session(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.post(
        "/api/batch/run",
        json={
            "session_ids": ["NONEXISTENT_D1"],
            "recipe": {"steps": [], "auto_detect_bads": False},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["results"][0]["status"] == "error"
