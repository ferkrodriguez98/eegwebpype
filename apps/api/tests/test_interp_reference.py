"""Interpolation + average reference apply via event log."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
from pathlib import Path

import numpy as np
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


def test_interpolate_clears_bads(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "set_montage", "params": {"montage": "standard_1020"}},
    )
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["Fp1", "Fp2"]}},
    )
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "interpolate_bads", "params": {}},
    )

    from pype.services.sessions import get_raw_for

    raw = get_raw_for("TEST01_D1")
    # interpolate_bads + reset_bads should clear info['bads']
    assert list(raw.info["bads"]) == []


def test_average_reference_zero_sum(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "set_reference", "params": {"type": "average"}},
    )

    from pype.services.sessions import get_raw_for

    raw = get_raw_for("TEST01_D1")
    data = np.asarray(raw.get_data(), dtype=np.float64)
    # After CAR, the sum across channels at each timepoint should be ~0.
    sum_per_t = data.sum(axis=0)
    assert float(np.max(np.abs(sum_per_t))) < 1e-9
