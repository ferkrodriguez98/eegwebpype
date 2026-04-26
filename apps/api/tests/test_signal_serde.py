"""Arrow encoding round-trips."""

from __future__ import annotations

import numpy as np

from pype.services.signal_serde import decode_arrow, encode_signal_arrow


def test_signal_arrow_roundtrip_preserves_values() -> None:
    n_channels, n_samples = 4, 100
    rng = np.random.default_rng(0)
    data = rng.standard_normal((n_channels, n_samples)).astype(np.float32)
    times = np.linspace(0, 1, n_samples, dtype=np.float32)
    names = [f"E{i}" for i in range(n_channels)]

    buf = encode_signal_arrow(data, times, names)
    decoded = decode_arrow(buf)

    np.testing.assert_array_equal(decoded["times"], times)
    for i, name in enumerate(names):
        np.testing.assert_array_equal(decoded[name], data[i])


def test_signal_arrow_rejects_size_mismatch() -> None:
    import pytest

    data = np.zeros((2, 10), dtype=np.float32)
    times = np.zeros(5, dtype=np.float32)
    with pytest.raises(ValueError, match="times length"):
        encode_signal_arrow(data, times, ["a", "b"])
