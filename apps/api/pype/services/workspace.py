"""Workspace management: scan source files, list sessions."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from pype.config import (
    SESSIONS_DIR,
    SOURCES_DIR,
    WORKSPACE_FILE,
    ensure_dirs,
    load_external_roots,
)
from pype.schemas.session import SessionRef, Workspace
from pype.services.mne_engine import parse_filename


def session_id(subject: str, session: str) -> str:
    return f"{subject}_{session}"


def load_workspace() -> Workspace:
    ensure_dirs()
    if not WORKSPACE_FILE.exists():
        return Workspace(data_root=str(SOURCES_DIR), sessions=[])
    raw = json.loads(WORKSPACE_FILE.read_text())
    return Workspace.model_validate(raw)


def save_workspace(ws: Workspace) -> None:
    ensure_dirs()
    WORKSPACE_FILE.write_text(ws.model_dump_json(indent=2))


def scan_sources(extra_root: Path | None = None) -> Workspace:
    """Scan SOURCES_DIR + configured external roots for .bdf/.fif files.

    Registers a SessionRef for each `{SUBJ}_..._{D1|D2}_*.bdf` file found.
    External roots are read-only — files there are referenced in place,
    never copied or modified.
    Preserves status of existing entries.
    """
    ensure_dirs()
    existing = {s.id: s for s in load_workspace().sessions}

    discovered: dict[str, SessionRef] = {}
    roots: list[Path] = [SOURCES_DIR, *load_external_roots()]
    if extra_root:
        roots.append(extra_root)

    for root in roots:
        if not root.exists():
            continue
        for fp in sorted(root.rglob("*")):
            if not fp.is_file():
                continue
            if fp.suffix.lower() not in (".bdf", ".fif"):
                continue
            parsed = parse_filename(fp.name)
            if parsed is None:
                continue
            subject, session = parsed
            sid = session_id(subject, session)
            prev = existing.get(sid)
            discovered[sid] = SessionRef(
                id=sid,
                subject=subject,
                session=session,  # type: ignore[arg-type]
                status=prev.status if prev else "raw",
                last_opened=prev.last_opened if prev else None,
                source_file=str(fp),
            )

    sessions = sorted(discovered.values(), key=lambda s: s.id)
    ws = Workspace(data_root=str(SOURCES_DIR), sessions=sessions)
    save_workspace(ws)
    return ws


def session_dir(sid: str) -> Path:
    p = SESSIONS_DIR / sid
    p.mkdir(parents=True, exist_ok=True)
    return p


def state_file(sid: str) -> Path:
    return session_dir(sid) / "state.json"


def now_iso() -> datetime:
    return datetime.now(tz=UTC)
