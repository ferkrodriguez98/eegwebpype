"""Batch endpoint."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from pype.services.batch import BatchRecipe, BatchRunResult, run_batch

router = APIRouter(prefix="/api/batch", tags=["batch"])


class BatchRunRequest(BaseModel):
    session_ids: list[str]
    recipe: BatchRecipe


@router.post("/run", response_model=BatchRunResult)
def post_run(payload: BatchRunRequest) -> BatchRunResult:
    return run_batch(payload.session_ids, payload.recipe)
