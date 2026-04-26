"""Append-only event log: append, pop, deterministic replay, idempotency."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient


def reload_all() -> None:
    from pype import config, main
    from pype.routers import config as config_router
    from pype.routers import events, files, sessions, workspace
    from pype.schemas import events as events_schema
    from pype.schemas import session as session_schema
    from pype.services import event_log, mne_engine, snapshots
    from pype.services import sessions as sess_svc
    from pype.services import workspace as ws_svc

    for mod in (
        config,
        events_schema,
        session_schema,
        mne_engine,
        snapshots,
        event_log,
        ws_svc,
        sess_svc,
        workspace,
        sessions,
        events,
        files,
        config_router,
        main,
    ):
        importlib.reload(mod)


def make_client() -> TestClient:
    reload_all()
    from pype.main import app

    return TestClient(app)


def test_append_event(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")

    r = client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["Fp1"], "reason": "manual"}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # load + auto-applied set_montage + mark_bad
    assert body["events"][-1]["op"] == "mark_bad"
    assert body["events"][-1]["params"]["channels"] == ["Fp1"]


def test_undo_event(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["Fp1"]}},
    )
    r = client.delete("/api/sessions/TEST01_D1/events/last")
    assert r.status_code == 200
    body = r.json()
    # The mark_bad got popped; load + set_montage remain.
    assert all(ev["op"] != "mark_bad" for ev in body["events"])


def test_undo_cannot_remove_load(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    body: dict[str, list[dict[str, str]]] = {"events": []}
    # Pop until only the load event remains.
    for _ in range(10):
        r = client.delete("/api/sessions/TEST01_D1/events/last")
        body = r.json()
        if len(body["events"]) == 1:
            break
    assert len(body["events"]) == 1
    assert body["events"][0]["op"] == "load"


def test_replay_marks_bad_channel(synthetic_bdf: Path) -> None:
    """After mark_bad event, replaying must produce a raw with that bad."""
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["Fp2"]}},
    )

    from pype.services.sessions import get_raw_for

    raw = get_raw_for("TEST01_D1")
    assert "Fp2" in list(raw.info["bads"])


def test_replay_unmark_round_trip(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["F3"]}},
    )
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "unmark_bad", "params": {"channels": ["F3"]}},
    )

    from pype.services.sessions import get_raw_for

    raw = get_raw_for("TEST01_D1")
    assert "F3" not in list(raw.info["bads"])


def test_filter_event_changes_signal(synthetic_bdf: Path) -> None:
    """Applying a filter must reduce HF energy in the resulting raw."""
    client = make_client()
    client.post("/api/workspace/scan")

    from pype.services.sessions import get_raw_for

    raw_before = get_raw_for("TEST01_D1")
    data_before = raw_before.get_data()
    hf_before = float(np.var(np.diff(data_before, axis=1)))

    client.post(
        "/api/sessions/TEST01_D1/events",
        json={
            "op": "filter",
            "params": {"l_freq": 1.0, "h_freq": 30.0, "l_trans": 0.5, "h_trans": 5.0},
        },
    )

    raw_after = get_raw_for("TEST01_D1")
    data_after = raw_after.get_data()
    hf_after = float(np.var(np.diff(data_after, axis=1)))

    assert hf_after < hf_before, "filter should reduce high-frequency variance"


def test_replay_deterministic(synthetic_bdf: Path) -> None:
    """Replaying twice must produce identical signals (bit-exact)."""
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["Fp1"]}},
    )

    from pype.services.sessions import get_raw_for

    raw1 = get_raw_for("TEST01_D1").copy()
    raw2 = get_raw_for("TEST01_D1").copy()
    np.testing.assert_array_equal(raw1.get_data(), raw2.get_data())
    assert list(raw1.info["bads"]) == list(raw2.info["bads"])


def test_invalid_event_rejected(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    r = client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "totally_made_up", "params": {}},
    )
    assert r.status_code == 400


def test_state_persists_between_requests(synthetic_bdf: Path) -> None:
    client = make_client()
    client.post("/api/workspace/scan")
    client.post(
        "/api/sessions/TEST01_D1/events",
        json={"op": "mark_bad", "params": {"channels": ["Fp1"]}},
    )

    r = client.get("/api/sessions/TEST01_D1")
    assert r.status_code == 200
    body = r.json()
    # load (+ auto set_montage) + mark_bad — last event must be the manual one.
    assert body["events"][-1]["op"] == "mark_bad"
