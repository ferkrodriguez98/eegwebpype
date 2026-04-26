"""Bad-channel detector tests on controlled synthetic signals."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import importlib
from pathlib import Path

import mne  # pyright: ignore[reportMissingTypeStubs]
import numpy as np
from fastapi.testclient import TestClient


def reload_all() -> None:
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


def make_raw_with_outliers() -> mne.io.RawArray:
    """Build a 16-ch raw where channel index 7 is a clear outlier (huge HF noise)."""
    sfreq = 256.0
    n_samples = int(sfreq * 30)  # 30s
    rng = np.random.default_rng(0)
    n_channels = 16

    # Base: pink-ish noise.
    data = rng.standard_normal((n_channels, n_samples)) * 1e-6

    # Outlier: channel 7 has 50x more variance, dominated by HF.
    t = np.arange(n_samples) / sfreq
    hf = np.sin(2 * np.pi * 80 * t) + 0.5 * np.sin(2 * np.pi * 90 * t)
    data[7] = (rng.standard_normal(n_samples) * 5e-5) + (hf * 5e-5)

    ch_names = [f"E{i + 1}" for i in range(n_channels)]
    info = mne.create_info(ch_names=ch_names, sfreq=sfreq, ch_types="eeg")
    raw = mne.io.RawArray(data, info, verbose="ERROR")

    # Set a montage so spatial-neighbor metric has positions.
    montage = mne.channels.make_standard_montage("standard_1020")
    available = [n for n in ch_names if n in montage.ch_names]
    if available:
        raw.set_montage("standard_1020", on_missing="ignore")
    return raw


def test_detector_flags_outlier_channel() -> None:
    from pype.services.bad_detector import detect_bad_channels

    raw = make_raw_with_outliers()
    result = detect_bad_channels(raw)
    flagged = {d.channel for d in result.detections}
    assert "E8" in flagged, f"expected E8 to be flagged, got {flagged}"


def test_detector_does_not_flag_clean_channels_excessively() -> None:
    """A pristine random raw should flag at most a small fraction."""
    from pype.services.bad_detector import detect_bad_channels

    sfreq = 256.0
    n_samples = int(sfreq * 30)
    rng = np.random.default_rng(0)
    n_channels = 32
    data = rng.standard_normal((n_channels, n_samples)) * 1e-6
    info = mne.create_info(
        ch_names=[f"E{i + 1}" for i in range(n_channels)], sfreq=sfreq, ch_types="eeg"
    )
    raw = mne.io.RawArray(data, info, verbose="ERROR")

    result = detect_bad_channels(raw)
    # With pure noise + MAD thresholds the detector can still flag a few
    # channels by chance — but should never claim *most* are bad.
    assert len(result.detections) <= n_channels // 2


def test_detector_endpoint_with_real_session(synthetic_bdf: Path) -> None:
    reload_all()
    from pype.main import app

    client = TestClient(app)
    client.post("/api/workspace/scan")
    r = client.post("/api/sessions/TEST01_D1/detect-bad-channels")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "detections" in body
    assert "threshold_pot_z" in body


def test_topomap_endpoint(synthetic_bdf: Path) -> None:
    reload_all()
    from pype.main import app

    client = TestClient(app)
    client.post("/api/workspace/scan")
    r = client.get("/api/sessions/TEST01_D1/topomap", params={"metric": "shape_dev"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["metric"] == "shape_dev"
    assert isinstance(body["points"], list)
    assert len(body["points"]) > 0
    p = body["points"][0]
    assert "channel" in p and "x" in p and "y" in p and "value" in p
