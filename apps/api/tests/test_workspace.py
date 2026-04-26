"""Workspace scan + session state tests using a synthetic .fif fixture."""

from __future__ import annotations

import importlib
from pathlib import Path

from pype.services import workspace as ws_mod
from pype.services.workspace import scan_sources


def reload_modules() -> None:
    """The fixture sets PYPE_DATA_DIR mid-test; reload modules using it."""
    from pype import config
    from pype.services import sessions, workspace

    importlib.reload(config)
    importlib.reload(workspace)
    importlib.reload(sessions)


def test_scan_finds_session(synthetic_bdf: Path) -> None:
    reload_modules()
    from pype.services.workspace import scan_sources as scan

    ws = scan()
    assert len(ws.sessions) == 1
    s = ws.sessions[0]
    assert s.subject == "TEST01"
    assert s.session == "D1"
    assert s.id == "TEST01_D1"
    assert Path(s.source_file).exists()


def test_session_state_creates_with_load_event(synthetic_bdf: Path) -> None:
    reload_modules()
    from pype.services.sessions import get_or_create_state
    from pype.services.workspace import scan_sources as scan

    scan()
    state = get_or_create_state("TEST01_D1")
    assert state.id == "TEST01_D1"
    assert state.subject == "TEST01"
    assert len(state.events) == 1
    assert state.events[0].op == "load"
    assert state.metadata.n_channels_original == 8
    assert state.metadata.sfreq_original == 256.0


def test_unknown_session_raises(synthetic_bdf: Path) -> None:
    import pytest

    reload_modules()
    from pype.services.sessions import get_or_create_state

    # Even before scanning, requesting unknown id must error cleanly.
    with pytest.raises(KeyError):
        get_or_create_state("NONEXISTENT_D1")


def test_scan_idempotent(synthetic_bdf: Path) -> None:
    reload_modules()
    from pype.services.workspace import scan_sources as scan

    ws1 = scan()
    ws2 = scan()
    assert [s.id for s in ws1.sessions] == [s.id for s in ws2.sessions]


# Also touch ws_mod / scan_sources to keep imports used by typecheck.
_ = (ws_mod, scan_sources)
