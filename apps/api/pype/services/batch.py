"""Batch processing: apply an event recipe to multiple sessions."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from pype.schemas.events import EventInput
from pype.services.bad_detector import detect_bad_channels
from pype.services.sessions import (
    append_event_and_save,
    get_or_create_state,
    get_raw_for,
)


class BatchStep(BaseModel):
    op: str
    params: dict[str, Any]


class BatchRecipe(BaseModel):
    steps: list[BatchStep]
    auto_detect_bads: bool = True
    pause_threshold: float = 0.25


class BatchSessionResult(BaseModel):
    session_id: str
    status: Literal["done", "needs_review", "error"]
    n_events_appended: int
    n_bads_marked: int
    bads_fraction: float
    error: str | None = None


class BatchRunResult(BaseModel):
    results: list[BatchSessionResult]


def run_batch(session_ids: list[str], recipe: BatchRecipe) -> BatchRunResult:
    results: list[BatchSessionResult] = []
    for sid in session_ids:
        try:
            state = get_or_create_state(sid)
        except KeyError as e:
            results.append(
                BatchSessionResult(
                    session_id=sid,
                    status="error",
                    n_events_appended=0,
                    n_bads_marked=0,
                    bads_fraction=0.0,
                    error=str(e),
                )
            )
            continue

        n_total_channels = state.metadata.n_channels_current

        appended = 0
        bads_marked = 0
        try:
            for step in recipe.steps:
                payload = EventInput(op=step.op, params=step.params)
                append_event_and_save(sid, payload)
                appended += 1

            if recipe.auto_detect_bads:
                raw = get_raw_for(sid)
                detection = detect_bad_channels(raw)
                channels = [d.channel for d in detection.detections]
                if channels:
                    append_event_and_save(
                        sid,
                        EventInput(
                            op="mark_bad",
                            params={"channels": channels, "reason": "auto_shape"},
                        ),
                    )
                    appended += 1
                    bads_marked = len(channels)

            fraction = bads_marked / n_total_channels if n_total_channels > 0 else 0.0
            status: Literal["done", "needs_review"] = (
                "needs_review" if fraction > recipe.pause_threshold else "done"
            )
            results.append(
                BatchSessionResult(
                    session_id=sid,
                    status=status,
                    n_events_appended=appended,
                    n_bads_marked=bads_marked,
                    bads_fraction=fraction,
                )
            )
        except (ValueError, RuntimeError, KeyError) as e:
            results.append(
                BatchSessionResult(
                    session_id=sid,
                    status="error",
                    n_events_appended=appended,
                    n_bads_marked=bads_marked,
                    bads_fraction=0.0,
                    error=str(e),
                )
            )

    return BatchRunResult(results=results)
