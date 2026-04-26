"""Event types: discriminated union of all operations applied to a session.

Each event is append-only. The state of a session is reconstructed by
replaying its events in order. Snapshots are checkpoints that let replay
skip ahead.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class _BaseEvent(BaseModel):
    id: str
    ts: datetime


class LoadEventParams(BaseModel):
    source_file: str


class LoadEvent(_BaseEvent):
    op: Literal["load"] = "load"
    params: LoadEventParams


class DropChannelsParams(BaseModel):
    channels: list[str]


class DropChannelsEvent(_BaseEvent):
    op: Literal["drop_channels"] = "drop_channels"
    params: DropChannelsParams


class SetMontageParams(BaseModel):
    montage: str


class SetMontageEvent(_BaseEvent):
    op: Literal["set_montage"] = "set_montage"
    params: SetMontageParams


class ResampleParams(BaseModel):
    sfreq: float = Field(gt=0)


class ResampleEvent(_BaseEvent):
    op: Literal["resample"] = "resample"
    params: ResampleParams


class FilterParams(BaseModel):
    l_freq: float | None = None
    h_freq: float | None = None
    l_trans: float | None = None
    h_trans: float | None = None


class FilterEvent(_BaseEvent):
    op: Literal["filter"] = "filter"
    params: FilterParams


BadReason = Literal[
    "auto_power",
    "auto_shape",
    "auto_neighbors",
    "manual",
]


class MarkBadParams(BaseModel):
    channels: list[str]
    reason: BadReason = "manual"


class MarkBadEvent(_BaseEvent):
    op: Literal["mark_bad"] = "mark_bad"
    params: MarkBadParams


class UnmarkBadParams(BaseModel):
    channels: list[str]


class UnmarkBadEvent(_BaseEvent):
    op: Literal["unmark_bad"] = "unmark_bad"
    params: UnmarkBadParams


# F5+ events. Modeled now so the union is stable across phases.
class FitICAParams(BaseModel):
    n_components: int = Field(gt=0, le=128)
    method: Literal["fastica", "infomax", "extended_infomax", "picard"] = "extended_infomax"
    random_state: int = 42


class FitICAEvent(_BaseEvent):
    op: Literal["fit_ica"] = "fit_ica"
    params: FitICAParams


class ICAComponentLabel(BaseModel):
    component: int
    label: str
    prob: float


class LabelICAParams(BaseModel):
    method: Literal["iclabel", "manual"]
    labels: list[ICAComponentLabel]


class LabelICAEvent(_BaseEvent):
    op: Literal["label_ica"] = "label_ica"
    params: LabelICAParams


class ExcludeICAParams(BaseModel):
    components: list[int]
    reason: str


class ExcludeICAEvent(_BaseEvent):
    op: Literal["exclude_ica"] = "exclude_ica"
    params: ExcludeICAParams


class ApplyICAEvent(_BaseEvent):
    op: Literal["apply_ica"] = "apply_ica"
    params: dict[str, str] = Field(default_factory=lambda: {})


class InterpolateBadsEvent(_BaseEvent):
    op: Literal["interpolate_bads"] = "interpolate_bads"
    params: dict[str, str] = Field(default_factory=lambda: {})


class SetReferenceParams(BaseModel):
    type: Literal["average", "REST", "rest"] = "average"


class SetReferenceEvent(_BaseEvent):
    op: Literal["set_reference"] = "set_reference"
    params: SetReferenceParams


class EpochParams(BaseModel):
    length_seconds: float = Field(gt=0)
    overlap: float = Field(ge=0)
    detrend: int | None = 1


class EpochEvent(_BaseEvent):
    op: Literal["epoch"] = "epoch"
    params: EpochParams


class RejectEpochsParams(BaseModel):
    indices: list[int]
    reason: Literal["auto_ptp", "manual"] = "manual"


class RejectEpochsEvent(_BaseEvent):
    op: Literal["reject_epochs"] = "reject_epochs"
    params: RejectEpochsParams


class ExportParams(BaseModel):
    kind: Literal["epochs", "raw"] = "epochs"
    path: str


class ExportEvent(_BaseEvent):
    op: Literal["export"] = "export"
    params: ExportParams


Event = Annotated[
    LoadEvent
    | DropChannelsEvent
    | SetMontageEvent
    | ResampleEvent
    | FilterEvent
    | MarkBadEvent
    | UnmarkBadEvent
    | FitICAEvent
    | LabelICAEvent
    | ExcludeICAEvent
    | ApplyICAEvent
    | InterpolateBadsEvent
    | SetReferenceEvent
    | EpochEvent
    | RejectEpochsEvent
    | ExportEvent,
    Field(discriminator="op"),
]


class EventInput(BaseModel):
    """Body for POST /events. The server fills in id and ts."""

    op: str
    params: dict[str, object]
