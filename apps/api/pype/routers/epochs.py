"""Epoching endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from pype.services.epochs import EpochsMatrix, epochs_matrix
from pype.services.sessions import get_raw_for

router = APIRouter(prefix="/api/sessions", tags=["epochs"])


@router.get("/{sid}/epochs", response_model=EpochsMatrix)
def get_epochs(
    sid: str,
    length: Annotated[float, Query(gt=0, le=60)] = 8.0,
    overlap: Annotated[float, Query(ge=0)] = 0.0,
) -> EpochsMatrix:
    try:
        raw = get_raw_for(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return epochs_matrix(raw, length_seconds=length, overlap=overlap)
