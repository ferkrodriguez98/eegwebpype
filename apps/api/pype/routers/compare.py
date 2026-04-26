"""Compare endpoint: D1 vs D2 of the same subject."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pype.schemas.session import SessionState
from pype.services.sessions import get_or_create_state
from pype.services.workspace import load_workspace


class CompareResponse(BaseModel):
    subject: str
    d1: SessionState | None
    d2: SessionState | None
    diff_only_d1: list[str]
    diff_only_d2: list[str]
    diff_in_both: list[str]


def _bads_from_state(state: SessionState | None) -> list[str]:
    if state is None:
        return []
    bads: set[str] = set()
    for ev in state.events:
        if ev.op == "mark_bad":
            for c in ev.params.channels:
                bads.add(c)
        elif ev.op == "unmark_bad":
            for c in ev.params.channels:
                bads.discard(c)
        elif ev.op == "interpolate_bads":
            bads.clear()
    return sorted(bads)


router = APIRouter(prefix="/api/compare", tags=["compare"])


@router.get("/{subject}", response_model=CompareResponse)
def get_compare(subject: str) -> CompareResponse:
    ws = load_workspace()
    refs = [s for s in ws.sessions if s.subject == subject]
    if not refs:
        raise HTTPException(status_code=404, detail=f"unknown subject: {subject}")

    d1: SessionState | None = None
    d2: SessionState | None = None
    for r in refs:
        try:
            state = get_or_create_state(r.id)
        except KeyError:
            continue
        if r.session == "D1":
            d1 = state
        elif r.session == "D2":
            d2 = state

    bads_d1 = set(_bads_from_state(d1))
    bads_d2 = set(_bads_from_state(d2))

    return CompareResponse(
        subject=subject,
        d1=d1,
        d2=d2,
        diff_only_d1=sorted(bads_d1 - bads_d2),
        diff_only_d2=sorted(bads_d2 - bads_d1),
        diff_in_both=sorted(bads_d1 & bads_d2),
    )
