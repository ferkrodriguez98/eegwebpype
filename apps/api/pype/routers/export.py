"""Export endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from pype.services.export import ExportResult, export_clean_epochs
from pype.services.sessions import get_or_create_state

router = APIRouter(prefix="/api/sessions", tags=["export"])


@router.post("/{sid}/export", response_model=ExportResult)
def post_export(sid: str) -> ExportResult:
    try:
        state = get_or_create_state(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    try:
        return export_clean_epochs(state)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
