"""Compare endpoint: D1 vs D2 diff."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
import shutil
from pathlib import Path

from fastapi.testclient import TestClient


def make_client() -> TestClient:
    from pype import config, main
    from pype.routers import (
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
        compare,
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


def test_compare_d1_only(synthetic_bdf: Path) -> None:
    """Subject without D2 → d1 populated, d2 None."""
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.get("/api/compare/TEST01")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subject"] == "TEST01"
    assert body["d1"] is not None
    assert body["d2"] is None
    assert body["diff_only_d1"] == []


def test_compare_diff(synthetic_bdf: Path) -> None:
    """Add a D2 session and mark different bads in each → diff fields populated."""
    sources = synthetic_bdf.parent
    d2_path = sources / "TEST01_MEV_D2_REST.fif"
    shutil.copy(synthetic_bdf, d2_path)

    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["Fp1", "F3"]}},
    )
    client.post(
        "/api/sessions/TEST01_D2/events",
        json={"op": "mark_bad", "params": {"channels": ["F3", "C3"]}},
    )

    r = client.get("/api/compare/TEST01")
    assert r.status_code == 200
    body = r.json()
    assert body["diff_only_d1"] == ["Fp1"]
    assert body["diff_only_d2"] == ["C3"]
    assert body["diff_in_both"] == ["F3"]


def test_compare_unknown_subject(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.get("/api/compare/NOPE")
    assert r.status_code == 404
