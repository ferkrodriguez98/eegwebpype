"""Setup helpers: detected montage and suggested resample."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pype.services.montage_detect import detect_montage, suggest_resample
from pype.services.sessions import get_or_create_state

router = APIRouter(prefix="/api/sessions", tags=["setup"])


class SetupSuggestions(BaseModel):
    detected_montage: str | None
    montage_already_applied: bool
    suggested_sfreq: float | None
    sfreq_already_resampled: bool


@router.get("/{sid}/setup", response_model=SetupSuggestions)
def get_setup(sid: str) -> SetupSuggestions:
    try:
        state = get_or_create_state(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    detected = detect_montage(state.metadata.channel_names)
    montage_done = any(ev.op == "set_montage" for ev in state.events)
    suggested = suggest_resample(state.metadata.sfreq_current)
    resampled = any(ev.op == "resample" for ev in state.events)

    return SetupSuggestions(
        detected_montage=detected,
        montage_already_applied=montage_done,
        suggested_sfreq=suggested,
        sfreq_already_resampled=resampled,
    )
