"""Runtime config: paths, defaults."""

from __future__ import annotations

import os
from pathlib import Path

# Workspace root — where state.json files, snapshots and exports live.
DATA_DIR = Path(os.environ.get("PYPE_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
SOURCES_DIR = DATA_DIR / "sources"
SESSIONS_DIR = DATA_DIR / "sessions"
WORKSPACE_FILE = DATA_DIR / "workspace.json"


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
