"""Config endpoints: external read-only roots."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pype.config import CONFIG_FILE, ensure_dirs, load_external_roots

router = APIRouter(prefix="/api/config", tags=["config"])


class RootsPayload(BaseModel):
    external_roots: list[str]


class RootsResponse(BaseModel):
    external_roots: list[str]


@router.get("/external-roots", response_model=RootsResponse)
def get_external_roots() -> RootsResponse:
    return RootsResponse(external_roots=[str(r) for r in load_external_roots()])


@router.put("/external-roots", response_model=RootsResponse)
def put_external_roots(payload: RootsPayload) -> RootsResponse:
    """Persist a list of external read-only roots in data/config.json."""
    ensure_dirs()
    cleaned: list[str] = []
    for entry in payload.external_roots:
        p = Path(entry).expanduser()
        if not p.exists():
            raise HTTPException(status_code=400, detail=f"path does not exist: {entry}")
        if not p.is_dir():
            raise HTTPException(status_code=400, detail=f"path is not a directory: {entry}")
        cleaned.append(str(p.resolve()))

    existing: dict[str, object] = {}
    if CONFIG_FILE.exists():
        try:
            existing = json.loads(CONFIG_FILE.read_text())
        except json.JSONDecodeError:
            existing = {}
    existing["external_roots"] = cleaned
    CONFIG_FILE.write_text(json.dumps(existing, indent=2))
    return RootsResponse(external_roots=cleaned)
