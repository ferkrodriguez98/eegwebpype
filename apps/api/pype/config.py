"""Runtime config: paths, defaults, external read-only roots."""

from __future__ import annotations

import json
import os
from pathlib import Path

# Workspace root — where state.json files, snapshots and exports live.
DATA_DIR = Path(os.environ.get("PYPE_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
SOURCES_DIR = DATA_DIR / "sources"
SESSIONS_DIR = DATA_DIR / "sessions"
WORKSPACE_FILE = DATA_DIR / "workspace.json"
CONFIG_FILE = DATA_DIR / "config.json"


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def load_external_roots() -> list[Path]:
    """Read additional read-only data roots from data/config.json (if any).

    Also supports comma-separated env var PYPE_EXTERNAL_ROOTS for ad-hoc setups.
    """
    roots: list[Path] = []
    env_value = os.environ.get("PYPE_EXTERNAL_ROOTS", "").strip()
    if env_value:
        for chunk in env_value.split(","):
            p = Path(chunk.strip()).expanduser()
            if p.exists() and p.is_dir():
                roots.append(p.resolve())

    if CONFIG_FILE.exists():
        try:
            cfg = json.loads(CONFIG_FILE.read_text())
            for entry in cfg.get("external_roots", []):
                p = Path(str(entry)).expanduser()
                if p.exists() and p.is_dir():
                    roots.append(p.resolve())
        except (json.JSONDecodeError, OSError):
            # Bad config shouldn't crash the API.
            pass

    # Dedup preserving order.
    seen: set[str] = set()
    unique: list[Path] = []
    for r in roots:
        s = str(r)
        if s in seen:
            continue
        seen.add(s)
        unique.append(r)
    return unique


def is_under_external_root(path: Path) -> bool:
    """True if `path` lives inside any configured external root.

    Used to enforce read-only on those roots.
    """
    target = path.resolve()
    for root in load_external_roots():
        try:
            target.relative_to(root)
            return True
        except ValueError:
            continue
    return False
