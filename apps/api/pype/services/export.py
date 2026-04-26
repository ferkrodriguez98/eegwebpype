"""Final export: clean-epo.fif + log.json with full provenance.

The raw is reconstructed via replay_log, the parameters of the `epoch`
event are applied (if present), and the epochs listed in `reject_epochs`
are dropped. The result is written to data/sessions/{id}/exports/.
"""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from pype.schemas.events import EpochEvent, RejectEpochsEvent
from pype.schemas.session import SessionState
from pype.services.epochs import make_epochs
from pype.services.event_log import replay_log
from pype.services.snapshots import snapshots_dir
from pype.services.workspace import session_dir


class ExportResult(BaseModel):
    fif_path: str
    log_path: str
    n_epochs: int
    n_channels: int


def export_clean_epochs(state: SessionState) -> ExportResult:
    """Materialize clean-epo.fif and log.json from the session state."""
    sd = session_dir(state.id)
    exports = sd / "exports"
    exports.mkdir(parents=True, exist_ok=True)

    raw = replay_log(state, snapshots_dir=snapshots_dir(sd))

    epoch_event: EpochEvent | None = None
    reject_event: RejectEpochsEvent | None = None
    for ev in state.events:
        if isinstance(ev, EpochEvent):
            epoch_event = ev
        elif isinstance(ev, RejectEpochsEvent):
            reject_event = ev

    if epoch_event is None:
        raise ValueError(
            "session has no `epoch` event — create epochs before exporting",
        )

    epochs = make_epochs(
        raw,
        length_seconds=epoch_event.params.length_seconds,
        overlap=epoch_event.params.overlap,
        detrend=epoch_event.params.detrend,
        rejected_indices=reject_event.params.indices if reject_event else None,
    )

    fif_path = exports / f"{state.id}_clean-epo.fif"
    epochs.save(str(fif_path), overwrite=True, verbose="ERROR")

    log_payload: dict[str, Any] = {
        "id": state.id,
        "subject": state.subject,
        "session": state.session,
        "exported_at": datetime.now(tz=UTC).isoformat(),
        "source_file": state.source_file,
        "n_epochs_kept": len(epochs),
        "n_channels": len(epochs.ch_names),  # type: ignore[arg-type]
        "events": [ev.model_dump(mode="json") for ev in state.events],
        "metadata": state.metadata.model_dump(mode="json"),
    }
    log_path = exports / f"{state.id}_log.json"
    log_path.write_text(json.dumps(log_payload, indent=2))

    return ExportResult(
        fif_path=str(fif_path),
        log_path=str(log_path),
        n_epochs=len(epochs),
        n_channels=len(epochs.ch_names),  # type: ignore[arg-type]
    )
