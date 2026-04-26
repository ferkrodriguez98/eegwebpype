"""ICA fit + components + WebSocket de progreso."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from pype.services.ica import (
    ICAFitResult,
    fit_ica,
    get_components_for_ui,
    load_ica,
)
from pype.services.sessions import get_raw_for
from pype.services.workspace import session_dir

router = APIRouter(prefix="/api/sessions", tags=["ica"])


class FitICARequest(BaseModel):
    n_components: int = 25
    method: str = "extended_infomax"
    random_state: int = 42


class FitICAResponse(BaseModel):
    n_components: int
    method: str


@router.post("/{sid}/ica/fit", response_model=FitICAResponse)
def post_fit_ica(sid: str, payload: FitICARequest) -> FitICAResponse:
    try:
        raw = get_raw_for(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    sd = session_dir(sid)
    ica = fit_ica(
        raw,
        session_dir=sd,
        n_components=payload.n_components,
        method=payload.method,  # type: ignore[arg-type]
        random_state=payload.random_state,
    )
    return FitICAResponse(n_components=int(ica.n_components_), method=payload.method)


@router.get("/{sid}/ica/components", response_model=ICAFitResult)
def get_ica_components(sid: str) -> ICAFitResult:
    try:
        raw = get_raw_for(sid)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    sd = session_dir(sid)
    ica = load_ica(sd)
    if ica is None:
        raise HTTPException(
            status_code=404,
            detail="ICA not fitted yet. POST /ica/fit first.",
        )
    return get_components_for_ui(raw, ica)


# ---------------- WebSocket ----------------

ws_router = APIRouter(tags=["ws"])


@ws_router.websocket("/ws/sessions/{sid}/ica")
async def ws_fit_ica(websocket: WebSocket, sid: str) -> None:
    """WebSocket: receive fit params, stream progress events, return final result.

    Protocol:
        client to server (text JSON): {"n_components": 25, "method": "extended_infomax"}
        server to client (text JSON, repeated): {"phase": str, "fraction": 0.0..1.0}
        server to client (final): {"phase": "ready", "n_components": int}
    """
    await websocket.accept()
    try:
        params_raw = await websocket.receive_text()
        params: dict[str, Any] = json.loads(params_raw)
        n_components = int(params.get("n_components", 25))
        method = str(params.get("method", "extended_infomax"))
        random_state = int(params.get("random_state", 42))

        try:
            raw = get_raw_for(sid)
        except KeyError as e:
            await websocket.send_json({"error": str(e)})
            await websocket.close()
            return

        sd = session_dir(sid)
        loop = asyncio.get_running_loop()

        def progress_cb(event: dict[str, Any]) -> None:
            asyncio.run_coroutine_threadsafe(websocket.send_json(event), loop)

        await asyncio.to_thread(
            fit_ica,
            raw,
            sd,
            n_components,
            method,  # type: ignore[arg-type]
            random_state,
            progress_cb,
        )

        await websocket.send_json({"phase": "ready", "n_components": n_components})
    except WebSocketDisconnect:
        return
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass
