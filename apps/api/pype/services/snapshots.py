"""Snapshot helpers: persist `.fif` files at hitos pesados."""

# pyright: reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]

from pype.schemas.session import SessionState, Snapshot


def snapshots_dir(session_dir: Path) -> Path:
    p = session_dir / "snapshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_snapshot(
    state: SessionState,
    raw: BaseRaw,
    after_event_id: str,
    session_dir: Path,
) -> Snapshot:
    sd = snapshots_dir(session_dir)
    fname = f"after_{after_event_id}.fif"
    fpath = sd / fname
    raw.save(str(fpath), overwrite=True, verbose="ERROR")
    snap = Snapshot(
        after_event=after_event_id,
        fif_path=str(fpath),
        created_at=datetime.now(tz=UTC),
    )
    state.snapshots = [*state.snapshots, snap]
    return snap


def invalidate_after(state: SessionState, event_id: str, session_dir: Path) -> None:
    """Drop snapshots referring to events that no longer exist after a pop.

    Files on disk are also removed to avoid orphan .fif files.
    """
    valid_ids = {e.id for e in state.events}
    keep: list[Snapshot] = []
    for s in state.snapshots:
        if s.after_event in valid_ids:
            keep.append(s)
            continue
        f = Path(s.fif_path)
        if f.exists():
            f.unlink(missing_ok=True)
    state.snapshots = keep
    _ = event_id
    _ = session_dir
