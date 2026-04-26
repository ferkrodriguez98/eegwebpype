"""Session schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Session = Literal["D1", "D2"]
SessionStatus = Literal["raw", "in_progress", "done", "exported", "needs_review"]


class SessionMetadata(BaseModel):
    sfreq_original: float
    sfreq_current: float
    n_channels_original: int
    n_channels_current: int
    duration_seconds: float
    channel_names: list[str]


class LoadEventParams(BaseModel):
    source_file: str


class LoadEvent(BaseModel):
    id: str
    ts: datetime
    op: Literal["load"] = "load"
    params: LoadEventParams


# F2 will introduce the full Event union. For F1, only LoadEvent exists.
Event = LoadEvent


class SessionState(BaseModel):
    id: str
    subject: str
    session: Session
    source_file: str
    created_at: datetime
    updated_at: datetime
    events: list[Event]
    snapshots: list[dict[str, str]] = Field(default_factory=lambda: [])
    metadata: SessionMetadata


class SessionRef(BaseModel):
    id: str
    subject: str
    session: Session
    status: SessionStatus
    last_opened: datetime | None
    source_file: str


class Workspace(BaseModel):
    version: Literal[1] = 1
    data_root: str
    sessions: list[SessionRef]
