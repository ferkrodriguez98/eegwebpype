"""Session state CRUD with append-only event log + replay caching."""

# pyright: reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]

from pype.schemas.events import (
    Event,
    EventInput,
    LoadEvent,
    LoadEventParams,
    SetMontageEvent,
    SetMontageParams,
)
from pype.schemas.session import SessionState
from pype.services.event_log import (
    append_event as _append,
)
from pype.services.event_log import (
    is_heavy,
    new_event_id,
    now,
    replay_log,
)
from pype.services.event_log import (
    pop_last_event as _pop,
)
from pype.services.mne_engine import load_raw, metadata_from_raw
from pype.services.montage_detect import detect_montage
from pype.services.snapshots import (
    invalidate_after,
    save_snapshot,
    snapshots_dir,
)
from pype.services.workspace import load_workspace, session_dir, state_file


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

    initial_events: list[Event] = [
        LoadEvent(
            id=new_event_id(),
            ts=now(),
            params=LoadEventParams(source_file=ref.source_file),
        ),
    ]
    detected = detect_montage(meta.channel_names)
    if detected:
        initial_events.append(
            SetMontageEvent(
                id=new_event_id(),
                ts=now(),
                params=SetMontageParams(montage=detected),
            )
        )

    state = SessionState(
        id=sid,
        subject=ref.subject,
        session=ref.session,
        source_file=ref.source_file,
        created_at=datetime.now(tz=UTC),
        updated_at=datetime.now(tz=UTC),
        events=initial_events,
        metadata=meta,
    )
    save_state(state)
    return state


def save_state(state: SessionState) -> None:
    sf = state_file(state.id)
    sf.parent.mkdir(parents=True, exist_ok=True)
    sf.write_text(state.model_dump_json(indent=2))


def append_event_and_save(sid: str, payload: EventInput) -> SessionState:
    state = get_or_create_state(sid)
    state = _append(state, payload)
    save_state(state)

    # Take a snapshot if this was a heavy op. Replay to get the up-to-date raw.
    if is_heavy(payload.op):
        sd = session_dir(sid)
        raw = replay_log(state, snapshots_dir=snapshots_dir(sd))
        last_id = state.events[-1].id
        save_snapshot(state, raw, last_id, sd)
        save_state(state)
    return state


def pop_last_event_and_save(sid: str) -> tuple[SessionState, Event | None]:
    state = get_or_create_state(sid)
    state, popped = _pop(state)
    if popped is not None:
        invalidate_after(state, popped.id, session_dir(sid))
    save_state(state)
    return state, popped


def get_raw_for(sid: str) -> BaseRaw:
    state = get_or_create_state(sid)
    sd = session_dir(sid)
    return replay_log(state, snapshots_dir=snapshots_dir(sd))


def state_path(sid: str) -> Path:
    return state_file(sid)
