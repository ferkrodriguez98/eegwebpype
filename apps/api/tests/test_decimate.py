"""M4 decimation tests."""

from __future__ import annotations

import numpy as np

from pype.services.decimate import decimate_m4


def test_decimate_preserves_extremes() -> None:
    """A spike at t=500 must survive decimation — that's the whole point."""
    n_samples = 10_000
    data = np.zeros((1, n_samples), dtype=np.float32)
    data[0, 500] = 1000.0  # huge spike
    data[0, 7000] = -800.0  # huge dip
    times = np.arange(n_samples, dtype=np.float32)

    decimated, _ = decimate_m4(data, times, target_points=200)

    assert decimated.max() == 1000.0
    assert decimated.min() == -800.0
    assert decimated.shape[1] <= 200


def test_decimate_skips_when_target_above_input() -> None:
    data = np.ones((2, 50), dtype=np.float32)
    times = np.arange(50, dtype=np.float32)
    out, t = decimate_m4(data, times, target_points=200)
    assert out.shape == data.shape
    assert t.shape == times.shape
