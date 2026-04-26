"""Session endpoints: state, signal, psd."""

from __future__ import annotations

from typing import Annotated

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from pype.schemas.session import SessionState
from pype.services.decimate import decimate_m4
from pype.services.mne_engine import compute_psd, get_signal_window
from pype.services.sessions import get_or_create_state, get_raw_for
from pype.services.signal_serde import encode_psd_arrow, encode_signal_arrow

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

ARROW_MEDIA_TYPE = "application/vnd.apache.arrow.stream"


@router.get("/{sid}", response_model=SessionState)
def get_session(sid: str) -> SessionState:
    try:
        return get_or_create_state(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/{sid}/signal")
def get_signal(
    sid: str,
    t_start: Annotated[float, Query(ge=0)] = 0.0,
    t_end: Annotated[float, Query(gt=0)] = 10.0,
    channels: Annotated[str | None, Query()] = None,
    decimate: Annotated[str, Query()] = "auto",
    target_points: Annotated[int, Query(ge=100, le=20000)] = 4000,
) -> Response:
    try:
        raw = get_raw_for(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    ch_list = [c.strip() for c in channels.split(",")] if channels else None

    try:
        data, times, names = get_signal_window(raw, t_start, t_end, ch_list)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if decimate == "auto" and data.shape[1] > target_points:
        data, times = decimate_m4(data, times, target_points)
    elif decimate == "off":
        pass

    payload = encode_signal_arrow(data.astype(np.float32), times.astype(np.float32), names)
    return Response(content=payload, media_type=ARROW_MEDIA_TYPE)


@router.get("/{sid}/psd")
def get_psd(
    sid: str,
    fmin: Annotated[float, Query(ge=0)] = 0.5,
    fmax: Annotated[float, Query(gt=0)] = 47.0,
    picks: Annotated[str, Query()] = "eeg",
) -> Response:
    try:
        raw = get_raw_for(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    psd, freqs, names = compute_psd(raw, fmin=fmin, fmax=fmax, picks=picks)
    payload = encode_psd_arrow(psd, freqs, names)
    return Response(content=payload, media_type=ARROW_MEDIA_TYPE)
