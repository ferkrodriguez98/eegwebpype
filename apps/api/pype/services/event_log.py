"""Append-only event log with deterministic replay.

Each `Event` describes one operation. Replaying the events in order,
starting from the source file, reproduces the exact state of the session.

Snapshots cache `.fif` files at heavy milestones (post-filter, post-ICA, etc.)
so replay can fast-forward without redoing every step.
"""

# pyright: reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import mne  # pyright: ignore[reportMissingTypeStubs]
import numpy as np
from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]

from pype.schemas.events import (
    DropChannelsEvent,
    Event,
    EventInput,
    FilterEvent,
    InterpolateBadsEvent,
    LoadEvent,
    MarkBadEvent,
    ResampleEvent,
    SetMontageEvent,
    SetReferenceEvent,
    UnmarkBadEvent,
)
from pype.schemas.session import SessionState
from pype.services.mne_engine import load_raw

# Events that change the underlying signal data and warrant a snapshot.
HEAVY_OPS: frozenset[str] = frozenset(
    {"resample", "filter", "apply_ica", "interpolate_bads", "set_reference"},
)


def new_event_id() -> str:
    return f"evt_{uuid.uuid4().hex[:12]}"


def now() -> datetime:
    return datetime.now(tz=UTC)


def build_event(payload: EventInput) -> Event:
    """Materialize an `EventInput` into a fully-typed `Event` (with id+ts)."""
    raw = {
        "id": new_event_id(),
        "ts": now().isoformat(),
        "op": payload.op,
        "params": payload.params,
    }
    # Pydantic discriminator picks the right concrete type based on `op`.
    from pydantic import TypeAdapter

    adapter: TypeAdapter[Event] = TypeAdapter(Event)
    return adapter.validate_python(raw)


def apply_event(raw: BaseRaw, ev: Event) -> BaseRaw:
    """Apply a single event to a raw, returning the new raw.

    The function mutates `raw` in place where MNE's API does, but returns
    the same object for ergonomic chaining.
    """
    if isinstance(ev, LoadEvent):
        # `load` is the seed event — replaying it on top of an existing raw
        # is a no-op. The initial raw must come from `replay_log`'s seed step.
        return raw
    if isinstance(ev, DropChannelsEvent):
        existing = [c for c in ev.params.channels if c in raw.ch_names]
        if existing:
            raw.drop_channels(existing)
        return raw
    if isinstance(ev, SetMontageEvent):
        montage = mne.channels.make_standard_montage(ev.params.montage)
        raw.set_montage(montage, on_missing="ignore")
        return raw
    if isinstance(ev, ResampleEvent):
        raw.resample(sfreq=ev.params.sfreq, npad="auto")
        return raw
    if isinstance(ev, FilterEvent):
        kwargs: dict[str, Any] = {}
        if ev.params.l_freq is not None:
            kwargs["l_freq"] = ev.params.l_freq
        if ev.params.h_freq is not None:
            kwargs["h_freq"] = ev.params.h_freq
        if ev.params.l_trans is not None:
            kwargs["l_trans_bandwidth"] = ev.params.l_trans
        if ev.params.h_trans is not None:
            kwargs["h_trans_bandwidth"] = ev.params.h_trans
        raw.filter(picks="eeg", verbose="ERROR", **kwargs)
        return raw
    if isinstance(ev, MarkBadEvent):
        bads: list[str] = list(raw.info["bads"])  # type: ignore[index]
        for ch in ev.params.channels:
            if ch in raw.ch_names and ch not in bads:
                bads.append(ch)
        raw.info["bads"] = bads  # type: ignore[index]
        return raw
    if isinstance(ev, UnmarkBadEvent):
        bads: list[str] = list(raw.info["bads"])  # type: ignore[index]
        new_bads = [c for c in bads if c not in ev.params.channels]
        raw.info["bads"] = new_bads  # type: ignore[index]
        return raw
    if isinstance(ev, InterpolateBadsEvent):
        # Spherical-spline interpolation needs valid 3D positions for
        # every EEG channel (good and bad), because MNE inverts the
        # full-EEG location matrix. EXG / EOG / accessory channels
        # tagged as "eeg" but missing from the standard montage end up
        # with NaN locations and break `scipy.linalg.pinv`.
        #
        # Two-step fix: temporarily reclassify any EEG channel without
        # a finite, non-zero location as `misc` so MNE excludes it from
        # the interpolation; restore the original types afterwards.
        # Bads without a position can't be interpolated regardless, so
        # we leave them on `info["bads"]` as a heads-up for downstream
        # consumers.
        info: Any = raw.info
        bads_in: list[str] = list(info["bads"])
        if not bads_in:
            return raw

        pick_types: Any = mne.pick_types
        eeg_picks: Any = pick_types(info, eeg=True, exclude=[])
        no_pos: list[str] = []
        for i in eeg_picks:
            loc = np.asarray(info["chs"][i]["loc"][:3], dtype=float)
            if not (np.all(np.isfinite(loc)) and not (loc == 0).all()):
                no_pos.append(info["chs"][i]["ch_name"])

        interpolatable_bads = [b for b in bads_in if b not in no_pos]
        carried_bads = [b for b in bads_in if b in no_pos]

        if interpolatable_bads:
            if no_pos:
                raw.set_channel_types(
                    {ch: "misc" for ch in no_pos},
                    on_unit_change="ignore",
                    verbose="ERROR",
                )
            info["bads"] = interpolatable_bads
            try:
                raw.interpolate_bads(reset_bads=True, verbose="ERROR")
            finally:
                if no_pos:
                    raw.set_channel_types(
                        {ch: "eeg" for ch in no_pos},
                        on_unit_change="ignore",
                        verbose="ERROR",
                    )
        info["bads"] = carried_bads
        return raw
    if isinstance(ev, SetReferenceEvent):
        ref_type = ev.params.type
        if ref_type in ("average", "REST", "rest"):
            raw.set_eeg_reference(
                ref_channels="average" if ref_type == "average" else ref_type.lower(),
                projection=False,
                verbose="ERROR",
            )
        return raw

    # Heavy ops (ICA fit, epochs, export) come in F5+/F7+.
    return raw


def replay_log(state: SessionState, snapshots_dir: Path | None = None) -> BaseRaw:
    """Reconstruct the raw at the latest event of a session.

    If snapshots are present and the latest covers a prefix of the events,
    it's loaded as the starting point and only later events are applied.
    """
    raw: BaseRaw | None = None
    start_index = 0

    # Try to use the most recent snapshot we can.
    if snapshots_dir and state.snapshots:
        for snap in reversed(state.snapshots):
            fif = snapshots_dir / Path(snap.fif_path).name
            if not fif.exists():
                continue
            event_ids = [e.id for e in state.events]
            if snap.after_event not in event_ids:
                continue
            raw = load_raw(str(fif))
            start_index = event_ids.index(snap.after_event) + 1
            break

    # Fresh start from source file.
    if raw is None:
        raw = load_raw(state.source_file)
        start_index = 0
        # Skip the seed `load` event itself if present.
        if state.events and state.events[0].op == "load":
            start_index = max(start_index, 1)

    for ev in state.events[start_index:]:
        raw = apply_event(raw, ev)

    return raw


def append_event(state: SessionState, payload: EventInput) -> SessionState:
    ev = build_event(payload)
    state.events = [*state.events, ev]
    state.updated_at = now()
    return state


def pop_last_event(state: SessionState) -> tuple[SessionState, Event | None]:
    if not state.events:
        return state, None
    # Never remove the seed `load` event.
    if len(state.events) == 1 and state.events[0].op == "load":
        return state, None
    last = state.events[-1]
    state.events = list(state.events[:-1])
    state.snapshots = [s for s in state.snapshots if _snapshot_still_valid(s, state)]
    state.updated_at = now()
    return state, last


def _snapshot_still_valid(snapshot: object, state: SessionState) -> bool:
    after = getattr(snapshot, "after_event", None)
    if not isinstance(after, str):
        return False
    return any(e.id == after for e in state.events)


def is_heavy(op: str) -> bool:
    return op in HEAVY_OPS
