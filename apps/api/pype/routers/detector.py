"""Bad-channel detector + topomap endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query

from pype.services.bad_detector import (
    DetectBadResult,
    TopomapResponse,
    detect_bad_channels,
    topomap_for_metric,
)
from pype.services.sessions import get_raw_for

router = APIRouter(prefix="/api/sessions", tags=["detector"])


@router.post("/{sid}/detect-bad-channels", response_model=DetectBadResult)
def post_detect_bad(sid: str) -> DetectBadResult:
    try:
        raw = get_raw_for(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return detect_bad_channels(raw)


@router.get("/{sid}/topomap", response_model=TopomapResponse)
def get_topomap(
    sid: str,
    metric: Annotated[
        Literal["shape_dev", "power_50hz", "power_alpha", "power_gamma"],
        Query(),
    ] = "shape_dev",
) -> TopomapResponse:
    try:
        raw = get_raw_for(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return topomap_for_metric(raw, metric)
