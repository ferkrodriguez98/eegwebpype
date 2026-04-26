"""Shared pytest fixtures."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Generator
from pathlib import Path

import numpy as np
import pytest


@pytest.fixture(autouse=True)
def isolated_data_dir(monkeypatch: pytest.MonkeyPatch) -> Generator[Path]:
    """Force PYPE_DATA_DIR to a tmp dir per test, reset config + cache."""
    with tempfile.TemporaryDirectory() as td:
        monkeypatch.setenv("PYPE_DATA_DIR", td)
        # Reload config so module-level paths pick up the new env.
        import importlib

        from pype import config

        importlib.reload(config)
        # Also clear MNE engine LRU cache so each test starts fresh.
        from pype.services import mne_engine

        mne_engine.load_raw.cache_clear()
        yield Path(td)


@pytest.fixture
def synthetic_bdf(isolated_data_dir: Path) -> Path:
    """Build a tiny synthetic .fif (.bdf write requires a non-trivial setup) and
    save it under SOURCES_DIR with the `D1` marker so the parser picks it up.

    For F1 we use .fif (MNE writes them natively) — the loader handles both.
    """
    import mne  # pyright: ignore[reportMissingTypeStubs]

    sfreq = 256.0
    # Use names from the standard_1020 montage so tests can apply set_montage
    # and run interpolation/topomap operations that need real positions.
    ch_names = ["Fp1", "Fp2", "F3", "F4", "C3", "C4", "P3", "P4"]
    n_channels = len(ch_names)
    n_samples = int(sfreq * 4)  # 4 s of data
    rng = np.random.default_rng(42)
    data = rng.standard_normal((n_channels, n_samples)).astype(np.float64) * 1e-6

    info = mne.create_info(ch_names=ch_names, sfreq=sfreq, ch_types="eeg")  # pyright: ignore[reportUnknownMemberType]
    raw = mne.io.RawArray(data, info, verbose="ERROR")  # pyright: ignore[reportUnknownMemberType]

    sources = isolated_data_dir / "sources"
    sources.mkdir(parents=True, exist_ok=True)
    fp = sources / "TEST01_MEV_D1_REST.fif"
    raw.save(str(fp), overwrite=True, verbose="ERROR")  # pyright: ignore[reportUnknownMemberType]
    # Make sure tests resolve the new env-driven config.
    assert os.environ["PYPE_DATA_DIR"] == str(isolated_data_dir)
    return fp
