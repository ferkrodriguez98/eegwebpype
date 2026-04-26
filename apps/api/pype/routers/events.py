"""Append-only event log endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from pype.schemas.events import EventInput
from pype.schemas.session import SessionState
from pype.services.sessions import append_event_and_save, pop_last_event_and_save

router = APIRouter(prefix="/api/sessions", tags=["events"])


@router.post("/{sid}/events", response_model=SessionState)
def post_event(sid: str, payload: EventInput) -> SessionState:
    try:
        return append_event_and_save(sid, payload)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/{sid}/events/last", response_model=SessionState)
def undo_last_event(sid: str) -> SessionState:
    try:
        state, _ = pop_last_event_and_save(sid)
        return state
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
