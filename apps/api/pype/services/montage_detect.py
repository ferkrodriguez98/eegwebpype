"""Auto-detect a standard montage from the channel-name set."""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

from typing import Any

import mne  # pyright: ignore[reportMissingTypeStubs]

# Montages we know how to recognize. Order matters: the first one whose
# channels are mostly contained in the raw wins.
KNOWN_MONTAGES: tuple[str, ...] = (
    "biosemi128",
    "biosemi64",
    "biosemi32",
    "biosemi16",
    "standard_1020",
    "standard_1005",
)


def detect_montage(channel_names: list[str]) -> str | None:
    """Return a known-montage name where the raw's channels fit.

    Criterion: at least 80% of the raw's channels appear in the montage's
    channel set (case-insensitive). The montage may contain extra positions
    the raw does not use — that is fine.
    """
    upper_names = {c.upper() for c in channel_names}
    if not upper_names:
        return None
    for name in KNOWN_MONTAGES:
        try:
            montage: Any = mne.channels.make_standard_montage(name)
        except (ValueError, RuntimeError):
            continue
        montage_chs = {c.upper() for c in montage.ch_names}
        if not montage_chs:
            continue
        coverage = len(upper_names & montage_chs) / len(upper_names)
        if coverage >= 0.8:
            return name
    return None


def suggest_resample(sfreq: float) -> float | None:
    """If sfreq is high enough to slow down ICA / PSD, suggest 512 Hz."""
    if sfreq > 1024.0:
        return 512.0
    return None
