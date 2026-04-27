"""MNE-Python wrappers. The only place MNE is imported.

MNE has no type stubs, so this module uses runtime-typed boundaries with
explicit `cast`s. Inside, we treat MNE objects as `Any` and validate at the
edges.
"""

# pyright: reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportArgumentType=false

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, cast

import mne  # pyright: ignore[reportMissingTypeStubs]
import numpy as np
from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]
from numpy.typing import NDArray

from pype.schemas.session import SessionMetadata


@lru_cache(maxsize=8)
def load_raw(path: str) -> BaseRaw:
    """Load a .bdf or .fif file. Cached by path."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"file not found: {path}")
    suffix = p.suffix.lower()
    if suffix == ".bdf":
        raw = mne.io.read_raw_bdf(str(p), preload=True, verbose="ERROR")
    elif suffix == ".fif":
        raw = mne.io.read_raw_fif(str(p), preload=True, verbose="ERROR")
    else:
        raise ValueError(f"unsupported extension: {suffix}")
    return cast(BaseRaw, raw)


def metadata_from_raw(raw: BaseRaw) -> SessionMetadata:
    info: Any = raw.info
    ch_names: list[str] = list(raw.ch_names)  # type: ignore[arg-type]
    sfreq = float(info["sfreq"])
    n_channels = len(ch_names)
    duration = float(raw.n_times) / sfreq
    return SessionMetadata(
        sfreq_original=sfreq,
        sfreq_current=sfreq,
        n_channels_original=n_channels,
        n_channels_current=n_channels,
        duration_seconds=duration,
        channel_names=ch_names,
    )


def get_signal_window(
    raw: BaseRaw,
    t_start: float,
    t_end: float,
    channels: list[str] | None = None,
) -> tuple[NDArray[np.float32], NDArray[np.float32], list[str]]:
    """Return (data, times, channel_names) for [t_start, t_end] in seconds."""
    info: Any = raw.info
    ch_names: list[str] = list(raw.ch_names)  # type: ignore[arg-type]
    sfreq = float(info["sfreq"])
    s_start = max(0, int(t_start * sfreq))
    s_end = min(int(raw.n_times), int(t_end * sfreq))
    if s_end <= s_start:
        raise ValueError("invalid time window")

    if channels:
        picks = mne.pick_channels(ch_names, include=channels, ordered=True)
        names = list(channels)
    else:
        picks = mne.pick_types(info, eeg=True, exclude=())
        names = [ch_names[i] for i in picks]

    data, times = raw[picks, s_start:s_end]
    return (
        np.asarray(data, dtype=np.float32),
        np.asarray(times, dtype=np.float32),
        names,
    )


def compute_psd(
    raw: BaseRaw,
    fmin: float,
    fmax: float,
    picks: str | list[str] = "eeg",
) -> tuple[NDArray[np.float32], NDArray[np.float32], list[str]]:
    """Return (psd, freqs, channel_names) using MNE's default PSD method.

    Across MNE versions and pick spellings the contract on what
    `psd_obj.ch_names` returns is inconsistent: sometimes it tracks the
    actual data rows, sometimes it returns the full unfiltered list
    while the data array has bads dropped. We detect the mismatch and
    drop the bads from `ch_names` only when needed. If the lengths still
    don't agree afterwards, raise — the alternative is silently sending
    misaligned arrays to the client.
    """
    psd_obj: Any = raw.compute_psd(fmin=fmin, fmax=fmax, picks=picks, verbose="ERROR")
    data = np.asarray(psd_obj.get_data(), dtype=np.float32)
    freqs = np.asarray(psd_obj.freqs, dtype=np.float32)
    all_names: list[str] = list(psd_obj.ch_names)
    n_data = int(data.shape[0])
    if len(all_names) == n_data:
        names = all_names
    else:
        info: Any = raw.info
        bads: set[str] = set(info["bads"] or [])
        filtered = [n for n in all_names if n not in bads]
        if len(filtered) != n_data:
            raise RuntimeError(
                f"compute_psd alignment failed: ch_names={len(all_names)}, "
                f"after_bads_filter={len(filtered)}, data_rows={n_data}",
            )
        names = filtered
    return data, freqs, names


def parse_filename(name: str) -> tuple[str, str] | None:
    """Parse `{SUBJ}_..._D1_REST.bdf` or similar → (subject, session)."""
    stem = Path(name).stem
    parts = stem.split("_")
    if not parts:
        return None
    subject = parts[0]
    if "_D1_" in name or stem.endswith("_D1") or "D1" in parts:
        return subject, "D1"
    if "_D2_" in name or stem.endswith("_D2") or "D2" in parts:
        return subject, "D2"
    return None
