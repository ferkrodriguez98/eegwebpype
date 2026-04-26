"""Encode signal matrices as Apache Arrow IPC streams."""

from __future__ import annotations

import io

import numpy as np
import pyarrow as pa  # pyright: ignore[reportMissingTypeStubs]
from numpy.typing import NDArray


def encode_signal_arrow(
    data: NDArray[np.float32],
    times: NDArray[np.float32],
    channel_names: list[str],
) -> bytes:
    """Encode (channels x samples) signal + times as a single Arrow record batch.

    Schema:
        - times: float32[]      (length = n_samples)
        - {channel_name}: float32[]   (length = n_samples) per channel
    """
    n_channels, n_samples = data.shape
    if len(times) != n_samples:
        raise ValueError(f"times length {len(times)} != n_samples {n_samples}")
    if len(channel_names) != n_channels:
        raise ValueError(f"channel_names length {len(channel_names)} != n_channels {n_channels}")

    arrays: list[pa.Array] = [pa.array(times, type=pa.float32())]
    fields: list[pa.Field] = [pa.field("times", pa.float32())]
    for i, name in enumerate(channel_names):
        arrays.append(pa.array(data[i], type=pa.float32()))
        fields.append(pa.field(name, pa.float32()))

    schema = pa.schema(fields)
    batch = pa.RecordBatch.from_arrays(arrays, schema=schema)

    sink = io.BytesIO()
    with pa.ipc.new_stream(sink, schema) as writer:
        writer.write_batch(batch)
    return sink.getvalue()


def encode_psd_arrow(
    psd: NDArray[np.float32],
    freqs: NDArray[np.float32],
    channel_names: list[str],
) -> bytes:
    """Same shape as encode_signal_arrow but the leading column is `freqs`."""
    n_channels, n_freqs = psd.shape
    if len(freqs) != n_freqs:
        raise ValueError(f"freqs length {len(freqs)} != n_freqs {n_freqs}")
    if len(channel_names) != n_channels:
        raise ValueError(f"channel_names length {len(channel_names)} != n_channels {n_channels}")

    arrays: list[pa.Array] = [pa.array(freqs, type=pa.float32())]
    fields: list[pa.Field] = [pa.field("freqs", pa.float32())]
    for i, name in enumerate(channel_names):
        arrays.append(pa.array(psd[i], type=pa.float32()))
        fields.append(pa.field(name, pa.float32()))

    schema = pa.schema(fields)
    batch = pa.RecordBatch.from_arrays(arrays, schema=schema)

    sink = io.BytesIO()
    with pa.ipc.new_stream(sink, schema) as writer:
        writer.write_batch(batch)
    return sink.getvalue()


def decode_arrow(buf: bytes) -> dict[str, NDArray[np.float32]]:
    """Helper for tests: decode an Arrow IPC stream into {column: ndarray}."""
    reader = pa.ipc.open_stream(io.BytesIO(buf))
    table = reader.read_all()
    out: dict[str, NDArray[np.float32]] = {}
    for col_name in table.schema.names:
        col = table.column(col_name).to_numpy(zero_copy_only=False).astype(np.float32)
        out[col_name] = col
    return out
