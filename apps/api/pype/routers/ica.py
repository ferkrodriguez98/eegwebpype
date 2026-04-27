"""ICA fit + components + WebSocket de progreso."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import asyncio
import contextlib
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
    return get_components_for_ui(raw, ica, session_dir=sd)


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
    print(f"[ws_fit_ica] sid={sid} accept", flush=True)
    await websocket.accept()
    print(f"[ws_fit_ica] sid={sid} accepted, waiting for params", flush=True)
    try:
        params_raw = await websocket.receive_text()
        print(f"[ws_fit_ica] sid={sid} got params: {params_raw!r}", flush=True)
        params: dict[str, Any] = json.loads(params_raw)
        n_components = int(params.get("n_components", 25))
        method = str(params.get("method", "extended_infomax"))
        random_state = int(params.get("random_state", 42))

        try:
            raw = get_raw_for(sid)
        except KeyError as e:
            print(f"[ws_fit_ica] sid={sid} session error: {e}", flush=True)
            await websocket.send_json({"error": str(e)})
            await websocket.close()
            return

        sd = session_dir(sid)
        loop = asyncio.get_running_loop()

        def progress_cb(event: dict[str, Any]) -> None:
            asyncio.run_coroutine_threadsafe(websocket.send_json(event), loop)

        print(f"[ws_fit_ica] sid={sid} starting fit_ica n={n_components}", flush=True)
        try:
            await asyncio.to_thread(
                fit_ica,
                raw,
                sd,
                n_components,
                method,  # type: ignore[arg-type]
                random_state,
                progress_cb,
            )
        except Exception as e:
            print(f"[ws_fit_ica] sid={sid} fit_ica raised: {type(e).__name__}: {e}", flush=True)
            await websocket.send_json({"error": f"{type(e).__name__}: {e}"})
            await websocket.close()
            return

        print(f"[ws_fit_ica] sid={sid} fit done", flush=True)
        # The client may already have closed the connection if it
        # received the final "done" progress event and decided to
        # close — that's fine, the fit succeeded and the components
        # are persisted. Suppress the resulting RuntimeError.
        with contextlib.suppress(RuntimeError):
            await websocket.send_json({"phase": "ready", "n_components": n_components})
    except WebSocketDisconnect:
        print(f"[ws_fit_ica] sid={sid} client disconnected", flush=True)
        return
    finally:
        print(f"[ws_fit_ica] sid={sid} finally (closing)", flush=True)
        with contextlib.suppress(RuntimeError):
            await websocket.close()
