"""Session state CRUD. F1: only the initial `load` event."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

from pype.schemas.session import LoadEvent, LoadEventParams, SessionState
from pype.services.mne_engine import load_raw, metadata_from_raw
from pype.services.workspace import load_workspace, state_file


def get_or_create_state(sid: str) -> SessionState:
    sf = state_file(sid)
    if sf.exists():
        return SessionState.model_validate_json(sf.read_text())

    ws = load_workspace()
    ref = next((s for s in ws.sessions if s.id == sid), None)
    if ref is None:
        raise KeyError(f"session not found in workspace: {sid}")

    raw = load_raw(ref.source_file)
    meta = metadata_from_raw(raw)

    now = datetime.now(tz=UTC)
    state = SessionState(
        id=sid,
        subject=ref.subject,
        session=ref.session,
        source_file=ref.source_file,
        created_at=now,
        updated_at=now,
        events=[
            LoadEvent(
                id=f"evt_{uuid.uuid4().hex[:12]}",
                ts=now,
                params=LoadEventParams(source_file=ref.source_file),
            ),
        ],
        metadata=meta,
    )
    save_state(state)
    return state


def save_state(state: SessionState) -> None:
    sf = state_file(state.id)
    sf.parent.mkdir(parents=True, exist_ok=True)
    sf.write_text(state.model_dump_json(indent=2))


def get_raw_for(sid: str):  # pyright: ignore[reportUnknownReturnType,reportMissingReturnType]
    state = get_or_create_state(sid)
    return load_raw(state.source_file)


def state_path(sid: str) -> Path:
    return state_file(sid)
