"""Filter preview endpoint: PSD post-filtro sin commitear evento."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient


def make_client() -> TestClient:
    from pype import config, main
    from pype.routers import config as config_router
    from pype.routers import detector, events, files, sessions, workspace
    from pype.services import bad_detector, event_log, mne_engine, snapshots
    from pype.services import sessions as sess_svc
    from pype.services import workspace as ws_svc

    for mod in (
        config,
        bad_detector,
        mne_engine,
        snapshots,
        event_log,
        ws_svc,
        sess_svc,
        workspace,
        sessions,
        events,
        detector,
        files,
        config_router,
        main,
    ):
        importlib.reload(mod)
    from pype.main import app

    return TestClient(app)


def test_psd_preview_with_low_pass_reduces_hf(synthetic_bdf: Path) -> None:
    from pype.services.signal_serde import decode_arrow

    client = make_client()
    client.post("/api/workspace/scan")

    # Baseline PSD without filter.
    r0 = client.get("/api/sessions/TEST01_D1/psd-with-filter", params={"fmin": 1, "fmax": 100})
    base = decode_arrow(r0.content)

    # PSD with low-pass at 30 Hz.
    r1 = client.get(
        "/api/sessions/TEST01_D1/psd-with-filter",
        params={"h_freq": 30.0, "fmin": 1, "fmax": 100},
    )
    filt = decode_arrow(r1.content)

    freqs_base = base["freqs"]
    e1_base = base["E1"]
    e1_filt = filt["E1"]

    # In the 50-90 Hz band, filtered PSD should be much lower.
    hf_mask = (freqs_base >= 50) & (freqs_base <= 90)
    if np.any(hf_mask):
        avg_base = np.mean(e1_base[hf_mask])
        avg_filt = np.mean(e1_filt[hf_mask])
        assert avg_filt < avg_base


def test_psd_preview_does_not_commit_event(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")

    r = client.get(
        "/api/sessions/TEST01_D1/psd-with-filter",
        params={"l_freq": 1.0, "h_freq": 40.0},
    )
    assert r.status_code == 200

    state = client.get("/api/sessions/TEST01_D1").json()
    # Only the seed `load` event should be present.
    assert len(state["events"]) == 1
    assert state["events"][0]["op"] == "load"
