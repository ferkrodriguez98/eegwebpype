"""M4 decimation: largest-triangle-three-buckets-style downsampling per channel.

Used to render long signals on screen without sending every sample. We pick
representative points per visible bucket so the rendered shape is faithful.

Algorithm (M4 variant):
- Split the time range into N buckets.
- For each bucket, emit (t_min, v_min) and (t_max, v_max) — the two extremes.
- Result is 2*N points per channel — preserves min/max envelope at zoom level.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def decimate_m4(
    data: NDArray[np.float32],
    times: NDArray[np.float32],
    target_points: int,
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """Decimate per-channel to ~target_points (rounded to even, 2 per bucket).

    Args:
        data: (n_channels, n_samples)
        times: (n_samples,)
        target_points: approximate number of points per channel after decimation.

    Returns:
        (decimated_data, decimated_times) where decimated_data is (n_channels, n_out)
        and decimated_times is (n_out,). n_out <= target_points.
    """
    n_channels, n_samples = data.shape
    if target_points >= n_samples or target_points < 4:
        return data, times

    n_buckets = max(2, target_points // 2)
    edges = np.linspace(0, n_samples, n_buckets + 1, dtype=np.int64)

    out_per_channel: list[NDArray[np.float32]] = []
    out_times_set: list[NDArray[np.float32]] | None = None

    for ch in range(n_channels):
        mins_idx = np.empty(n_buckets, dtype=np.int64)
        maxs_idx = np.empty(n_buckets, dtype=np.int64)
        for b in range(n_buckets):
            lo, hi = int(edges[b]), int(edges[b + 1])
            if hi <= lo:
                mins_idx[b] = lo
                maxs_idx[b] = lo
                continue
            seg = data[ch, lo:hi]
            mins_idx[b] = lo + int(np.argmin(seg))
            maxs_idx[b] = lo + int(np.argmax(seg))

        # Interleave min/max per bucket in temporal order.
        sorted_indices = np.empty(n_buckets * 2, dtype=np.int64)
        for b in range(n_buckets):
            i_min = mins_idx[b]
            i_max = maxs_idx[b]
            if i_min <= i_max:
                sorted_indices[2 * b] = i_min
                sorted_indices[2 * b + 1] = i_max
            else:
                sorted_indices[2 * b] = i_max
                sorted_indices[2 * b + 1] = i_min

        out_per_channel.append(data[ch, sorted_indices])
        if out_times_set is None:
            out_times_set = [times[sorted_indices]]

    assert out_times_set is not None
    return np.stack(out_per_channel), out_times_set[0]
