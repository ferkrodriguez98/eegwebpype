"""Epoching: extract fixed-length epochs from a raw with auto-rejection support."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

from typing import Any

import mne  # pyright: ignore[reportMissingTypeStubs]
import numpy as np
from mne import Epochs  # pyright: ignore[reportMissingTypeStubs]
from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]
from numpy.typing import NDArray
from pydantic import BaseModel


class EpochsMatrix(BaseModel):
    n_epochs: int
    n_channels: int
    channel_names: list[str]
    ptp_matrix: list[list[float]]
    ptp_max_per_epoch: list[float]
    rejected_indices: list[int]
    threshold_uv: float


def make_epochs(
    raw: BaseRaw,
    length_seconds: float = 8.0,
    overlap: float = 0.0,
    detrend: int | None = 1,
    rejected_indices: list[int] | None = None,
) -> Epochs:
    """Create fixed-length epochs from a raw signal."""
    sfreq = float(raw.info["sfreq"])  # type: ignore[index]
    events: NDArray[np.int64] = mne.make_fixed_length_events(
        raw, duration=length_seconds, overlap=overlap
    )
    epochs: Epochs = mne.Epochs(
        raw,
        events=events,
        tmin=0.0,
        tmax=length_seconds - 1.0 / sfreq,
        baseline=None,
        preload=True,
        detrend=detrend,
        verbose="ERROR",
    )
    if rejected_indices:
        valid = [i for i in rejected_indices if 0 <= i < len(epochs)]
        if valid:
            epochs.drop(valid, reason="manual")
    return epochs


def epochs_matrix(
    raw: BaseRaw,
    length_seconds: float = 8.0,
    overlap: float = 0.0,
    detrend: int | None = 1,
    rejected_indices: list[int] | None = None,
    auto_threshold_mad: float = 4.0,
) -> EpochsMatrix:
    """Compute peak-to-peak by (epoch, channel) and tag rejected epochs."""
    epochs = make_epochs(raw, length_seconds, overlap, detrend)
    data: NDArray[np.float64] = np.asarray(
        epochs.get_data(picks="eeg"), dtype=np.float64
    )
    # data shape: (n_epochs, n_channels, n_times)
    ptp = np.ptp(data, axis=2)  # (n_epochs, n_channels), in volts
    ptp_uv = ptp * 1e6
    max_per_epoch = ptp_uv.max(axis=1)

    median = float(np.median(max_per_epoch))
    mad = float(np.median(np.abs(max_per_epoch - median)))
    threshold = median + auto_threshold_mad * 1.4826 * mad
    auto_rejected = [i for i, v in enumerate(max_per_epoch) if v > threshold]

    explicit = set(rejected_indices or [])
    all_rejected = sorted(set(auto_rejected) | explicit)

    info: Any = epochs.info
    pick_types: Any = mne.pick_types
    picks = pick_types(info, eeg=True, exclude=[])
    ch_names = [epochs.ch_names[i] for i in picks]  # type: ignore[index]

    return EpochsMatrix(
        n_epochs=int(data.shape[0]),
        n_channels=int(data.shape[1]),
        channel_names=ch_names,
        ptp_matrix=ptp_uv.tolist(),
        ptp_max_per_epoch=max_per_epoch.tolist(),
        rejected_indices=all_rejected,
        threshold_uv=float(threshold),
    )
