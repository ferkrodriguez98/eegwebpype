"""File upload endpoints."""

from __future__ import annotations

import shutil

from fastapi import APIRouter, HTTPException, UploadFile

from pype.config import SOURCES_DIR, ensure_dirs
from pype.services.mne_engine import parse_filename

router = APIRouter(prefix="/api/files", tags=["files"])


@router.post("/upload")
async def upload(file: UploadFile) -> dict[str, str]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing filename")
    suffix = file.filename.lower()
    if not (suffix.endswith(".bdf") or suffix.endswith(".fif")):
        raise HTTPException(status_code=400, detail="only .bdf or .fif accepted")
    if parse_filename(file.filename) is None:
        raise HTTPException(
            status_code=400,
            detail="filename must contain D1 or D2 marker (e.g. AB11_..._D1_REST.bdf)",
        )

    ensure_dirs()
    dest = SOURCES_DIR / file.filename
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"filename": file.filename, "path": str(dest)}
