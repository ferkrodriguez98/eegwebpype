"""Workspace endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from pype.schemas.session import Workspace
from pype.services.workspace import load_workspace, scan_sources

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


@router.get("", response_model=Workspace)
def get_workspace() -> Workspace:
    return load_workspace()


@router.post("/scan", response_model=Workspace)
def post_scan() -> Workspace:
    return scan_sources()
