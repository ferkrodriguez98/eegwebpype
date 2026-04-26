"""Auto-detected montage on load + setup suggestions endpoint."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
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
        setup,
        workspace,
    )
    from pype.routers import config as config_router
    from pype.services import (
        bad_detector,
        event_log,
        mne_engine,
        montage_detect,
        snapshots,
    )
    from pype.services import epochs as epochs_svc
    from pype.services import export as export_svc
    from pype.services import ica as ica_svc
    from pype.services import sessions as sess_svc
    from pype.services import workspace as ws_svc

    for mod in (
        config,
        bad_detector,
        mne_engine,
        montage_detect,
        snapshots,
        event_log,
        epochs_svc,
        export_svc,
        ica_svc,
        ws_svc,
        sess_svc,
        compare,
        sessions,
        setup,
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


def test_load_auto_applies_montage_when_channels_match(synthetic_bdf: Path) -> None:
    """Channel names matching standard_1020 should auto-add a set_montage event."""
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.get("/api/sessions/TEST01_D1")
    assert r.status_code == 200, r.text
    body = r.json()
    ops = [ev["op"] for ev in body["events"]]
    assert ops[0] == "load"
    assert "set_montage" in ops, f"expected auto set_montage, got {ops}"


def test_setup_endpoint_reports_detected_montage(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.get("/api/sessions/TEST01_D1/setup")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["detected_montage"] is not None
    assert body["montage_already_applied"] is True
    # 256 Hz fixture is below the resample threshold.
    assert body["suggested_sfreq"] is None
    assert body["sfreq_already_resampled"] is False


def test_montage_detector_unit() -> None:
    from pype.services.montage_detect import detect_montage, suggest_resample

    # 1020-style names should be detected.
    assert detect_montage(["Fp1", "Fp2", "F3", "F4", "C3", "C4", "P3", "P4"]) is not None

    # Generic "E1..E8" names should not match any standard montage.
    assert detect_montage([f"E{i}" for i in range(1, 9)]) is None

    # Resample suggestions only kick in for >1024 Hz.
    assert suggest_resample(2048.0) == 512.0
    assert suggest_resample(512.0) is None
