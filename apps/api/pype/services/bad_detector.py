"""Bad-channel detector with three combined metrics.

1. Total power vs the median across channels (z-MAD threshold).
2. Shape of the log-PSD vs the median curve of the group (RMS difference).
3. Spatial correlation against nearest neighbors.

A channel is flagged if it triggers any of the metrics. Each detection
carries the list of reasons so the UI can render them as badges.
"""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false

from __future__ import annotations

from typing import Any, Literal

import mne  # pyright: ignore[reportMissingTypeStubs]
import numpy as np
from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]
from numpy.typing import NDArray
from pydantic import BaseModel
from scipy.spatial.distance import cdist  # pyright: ignore[reportMissingTypeStubs]

# Default knobs — empirically tuned on TFG dataset.
DEFAULT_MAD_K: float = 4.0
DEFAULT_POT_Z_EXTREME: float = 8.0
DEFAULT_SHAPE_FMIN: float = 1.0
DEFAULT_SHAPE_FMAX: float = 45.0
DEFAULT_NEIGHBORS: int = 6
DEFAULT_NEIGHBOR_CORR_THR: float = 0.4

DetectorReason = Literal[
    "auto_power",
    "auto_shape",
    "auto_neighbors",
]


class ChannelDetection(BaseModel):
    channel: str
    reasons: list[DetectorReason]
    pot_z: float
    shape_dev_db: float
    neighbor_corr: float


class DetectBadResult(BaseModel):
    detections: list[ChannelDetection]
    threshold_pot_z: float
    threshold_shape_db: float
    threshold_neighbor_corr: float


def _compute_psd(
    raw: BaseRaw,
    fmin: float,
    fmax: float,
) -> tuple[NDArray[np.float32], NDArray[np.float32], list[str]]:
    compute: Any = raw.compute_psd
    psd_obj: Any = compute(fmin=fmin, fmax=fmax, picks="eeg", verbose="ERROR")
    data = np.asarray(psd_obj.get_data(), dtype=np.float32)
    freqs = np.asarray(psd_obj.freqs, dtype=np.float32)
    names: list[str] = list(psd_obj.ch_names)
    return data, freqs, names


def detect_bad_channels(
    raw: BaseRaw,
    *,
    mad_k: float = DEFAULT_MAD_K,
    pot_z_extreme: float = DEFAULT_POT_Z_EXTREME,
    shape_fmin: float = DEFAULT_SHAPE_FMIN,
    shape_fmax: float = DEFAULT_SHAPE_FMAX,
    n_neighbors: int = DEFAULT_NEIGHBORS,
    neighbor_corr_thr: float = DEFAULT_NEIGHBOR_CORR_THR,
) -> DetectBadResult:
    """Run the combined 3-metric detector.

    Returns the union of channels flagged by any metric, each annotated
    with the list of reasons that triggered.
    """
    psd_data, freqs, ch_names = _compute_psd(raw, fmin=0.5, fmax=47.0)

    # Metric 1: shape deviation in log-PSD space.
    band_mask = (freqs >= shape_fmin) & (freqs <= shape_fmax)
    log_psd = 10.0 * np.log10(psd_data[:, band_mask] + 1e-30)
    median_curve = np.median(log_psd, axis=0)
    shape_dev = np.mean(np.abs(log_psd - median_curve), axis=1)
    med_shp = np.median(shape_dev)
    mad_shp = np.median(np.abs(shape_dev - med_shp))
    thr_shp = float(med_shp + mad_k * 1.4826 * mad_shp)
    flag_shp = shape_dev > thr_shp

    # Metric 2: total power z-MAD.
    total_power = psd_data.sum(axis=1)
    med_p = np.median(total_power)
    mad_p = np.median(np.abs(total_power - med_p))
    pot_z = np.abs(total_power - med_p) / (1.4826 * mad_p + 1e-12)
    flag_pot = pot_z > pot_z_extreme

    # Metric 3: spatial neighbor correlation.
    info: Any = raw.info
    pick_types: Any = mne.pick_types
    picks = pick_types(info, eeg=True, exclude=[])
    pos = np.array([info["chs"][i]["loc"][:3] for i in picks], dtype=np.float64)
    has_real_positions = (
        pos.shape[0] >= n_neighbors + 1
        and bool(np.all(np.isfinite(pos)))
        and bool(np.any(pos != 0))
    )
    if has_real_positions:
        d = cdist(pos, pos)
        np.fill_diagonal(d, np.inf)
        neighbors = np.argsort(d, axis=1)[:, :n_neighbors]
        data: NDArray[np.float64] = np.asarray(raw.get_data(picks=picks), dtype=np.float64)
        std = data.std(axis=1, keepdims=True)
        std[std == 0] = 1.0
        z = (data - data.mean(axis=1, keepdims=True)) / std
        corr = (z @ z.T) / data.shape[1]
        nbr_corr = np.array(
            [float(np.mean(np.abs(corr[i, neighbors[i]]))) for i in range(len(ch_names))]
        )
    else:
        nbr_corr = np.full(len(ch_names), 1.0, dtype=np.float64)

    flag_nbr = (nbr_corr < neighbor_corr_thr) & (shape_dev > 0.5 * thr_shp)

    detections: list[ChannelDetection] = []
    for i, name in enumerate(ch_names):
        reasons: list[DetectorReason] = []
        if flag_pot[i]:
            reasons.append("auto_power")
        if flag_shp[i]:
            reasons.append("auto_shape")
        if flag_nbr[i]:
            reasons.append("auto_neighbors")
        if not reasons:
            continue
        detections.append(
            ChannelDetection(
                channel=name,
                reasons=reasons,
                pot_z=float(pot_z[i]),
                shape_dev_db=float(shape_dev[i]),
                neighbor_corr=float(nbr_corr[i]),
            )
        )

    return DetectBadResult(
        detections=detections,
        threshold_pot_z=pot_z_extreme,
        threshold_shape_db=thr_shp,
        threshold_neighbor_corr=neighbor_corr_thr,
    )


class TopomapPoint(BaseModel):
    channel: str
    x: float
    y: float
    value: float


class TopomapResponse(BaseModel):
    metric: str
    points: list[TopomapPoint]


def _project_azimuthal_equidistant(pos_3d: NDArray[np.float64]) -> NDArray[np.float64]:
    """Project 3D head-surface points onto a 2D disk using azimuthal-equidistant projection.

    The projection center is the top of the head (positive z axis). Points are mapped
    so that great-circle distances on the sphere become Euclidean distances on the disk.
    This is what MNE uses by default (`sphere='auto'`) and produces the canonical
    EEG topomap layout where Cz lands at the center, frontal channels at top, etc.
    """
    if pos_3d.shape[0] == 0:
        return pos_3d.reshape(0, 2)

    pos = pos_3d.astype(np.float64, copy=True)
    # Replace NaN positions with origin so they don't break the projection.
    nan_mask = np.isnan(pos).any(axis=1)
    pos[nan_mask] = 0.0

    # Center on the head sphere center (mean of valid points), then normalize.
    valid = pos[~nan_mask]
    if valid.size == 0:
        return np.zeros((pos.shape[0], 2), dtype=np.float64)
    center = valid.mean(axis=0)
    centered = pos - center

    # Use a unit sphere centered on `center`. Compute spherical coords (theta, phi).
    norms = np.linalg.norm(centered, axis=1)
    norms[norms == 0] = 1.0
    unit = centered / norms[:, None]

    # Azimuthal-equidistant projection from the north pole (0, 0, 1).
    # rho = arccos(z), then x_2d = rho * cos(phi), y_2d = rho * sin(phi)
    # where phi = atan2(y, x).
    z = np.clip(unit[:, 2], -1.0, 1.0)
    rho = np.arccos(z)  # angle from north pole, in [0, pi]
    phi = np.arctan2(unit[:, 1], unit[:, 0])

    x_2d = rho * np.cos(phi)
    y_2d = rho * np.sin(phi)

    # Zero-out NaN-positioned channels.
    out = np.column_stack([x_2d, y_2d])
    out[nan_mask] = 0.0
    return out


def _ensure_montage_positions(raw: BaseRaw, channel_names: list[str]) -> NDArray[np.float64]:
    """Return 3D positions for `channel_names`. If raw has none, fall back to the
    detected standard montage by name lookup."""
    info: Any = raw.info
    name_to_idx = {n: i for i, n in enumerate(info["ch_names"])}
    pos = np.full((len(channel_names), 3), np.nan, dtype=np.float64)
    for i, name in enumerate(channel_names):
        idx = name_to_idx.get(name)
        if idx is None:
            continue
        loc = np.asarray(info["chs"][idx]["loc"][:3], dtype=np.float64)
        if not np.all(np.isnan(loc)) and not (loc == 0).all():
            pos[i] = loc

    # If everything is NaN, try to fetch positions from a standard montage that
    # contains these channel names.
    if np.isnan(pos).all():
        from pype.services.montage_detect import KNOWN_MONTAGES

        upper_names = [c.upper() for c in channel_names]
        for montage_name in KNOWN_MONTAGES:
            try:
                montage: Any = mne.channels.make_standard_montage(montage_name)
            except (ValueError, RuntimeError):
                continue
            digs = montage.get_positions()
            ch_pos: dict[str, Any] = digs["ch_pos"]
            ch_pos_upper = {k.upper(): np.asarray(v, dtype=np.float64) for k, v in ch_pos.items()}
            hits = sum(1 for n in upper_names if n in ch_pos_upper)
            if hits / max(1, len(upper_names)) >= 0.5:
                for i, n in enumerate(upper_names):
                    p = ch_pos_upper.get(n)
                    if p is not None:
                        pos[i] = p
                break
    return pos


def topomap_for_metric(
    raw: BaseRaw,
    metric: Literal["shape_dev", "power_50hz", "power_alpha", "power_gamma"],
) -> TopomapResponse:
    """Compute one scalar per EEG channel and return projected 2D positions."""
    psd_data, freqs, ch_names = _compute_psd(raw, fmin=0.5, fmax=55.0)

    if metric == "shape_dev":
        band = (freqs >= 1.0) & (freqs <= 45.0)
        log_psd = 10.0 * np.log10(psd_data[:, band] + 1e-30)
        median_curve = np.median(log_psd, axis=0)
        values = np.mean(np.abs(log_psd - median_curve), axis=1).astype(np.float64)
    elif metric == "power_50hz":
        band = (freqs >= 48.0) & (freqs <= 52.0)
        values = 10.0 * np.log10(psd_data[:, band].mean(axis=1) + 1e-30)
    elif metric == "power_alpha":
        band = (freqs >= 8.0) & (freqs <= 12.0)
        values = 10.0 * np.log10(psd_data[:, band].mean(axis=1) + 1e-30)
    elif metric == "power_gamma":
        band = (freqs >= 30.0) & (freqs <= 45.0)
        values = 10.0 * np.log10(psd_data[:, band].mean(axis=1) + 1e-30)
    else:  # pragma: no cover — guarded by Literal
        raise ValueError(f"unknown metric: {metric}")

    pos_3d = _ensure_montage_positions(raw, ch_names)
    pos_2d = _project_azimuthal_equidistant(pos_3d)

    points: list[TopomapPoint] = []
    for i, name in enumerate(ch_names):
        x = float(pos_2d[i, 0]) if i < len(pos_2d) else 0.0
        y = float(pos_2d[i, 1]) if i < len(pos_2d) else 0.0
        points.append(
            TopomapPoint(channel=name, x=x, y=y, value=float(values[i])),
        )

    return TopomapResponse(metric=metric, points=points)
