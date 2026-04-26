"""ICA fit + ICLabel (opcional). Cache resultado en disco para no recomputar.

Diseno:
- `fit_ica(raw, ...)` corre `mne.preprocessing.ICA().fit()` y devuelve el ICA.
- Persistimos el ICA como `data/sessions/{id}/ica.fif` para que el endpoint de
  componentes lo lea sin recomputar.
- ICLabel solo si `mne_icalabel` esta disponible (extra `iclabel`).
"""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportMissingImports=false

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import numpy as np
from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]
from mne.preprocessing import ICA  # pyright: ignore[reportMissingTypeStubs]
from numpy.typing import NDArray
from pydantic import BaseModel

ICAMethod = Literal["fastica", "infomax", "extended_infomax", "picard"]


def _has_iclabel() -> bool:
    try:
        import mne_icalabel  # noqa: F401  # pyright: ignore[reportUnusedImport]

        return True
    except ImportError:
        return False


class ICAComponent(BaseModel):
    index: int
    label: str
    prob: float
    topo: list[float]
    series: list[float]


class ICAFitResult(BaseModel):
    n_components: int
    method: str
    components: list[ICAComponent]


def _ica_path(session_dir: Path) -> Path:
    return session_dir / "ica.fif"


def fit_ica(
    raw: BaseRaw,
    session_dir: Path,
    n_components: int = 25,
    method: ICAMethod = "extended_infomax",
    random_state: int = 42,
    progress_cb: Any = None,
) -> ICA:
    """Fit ICA on a copy of `raw` filtered for ICA. Saves the result to disk.

    The progress_cb is invoked at high-level milestones (filtering, fitting).
    """
    if progress_cb:
        progress_cb({"phase": "filtering", "fraction": 0.05})

    raw_copy: Any = raw.copy()
    raw_copy.filter(
        l_freq=1.0,
        h_freq=None,
        picks="eeg",
        verbose="ERROR",
    )

    if progress_cb:
        progress_cb({"phase": "fitting", "fraction": 0.15})

    fit_params: dict[str, Any] = {}
    if method == "extended_infomax":
        fit_params = {"extended": True}
        ica_method: str = "infomax"
    else:
        ica_method = method

    ica: Any = ICA(
        n_components=n_components,
        method=ica_method,  # type: ignore[arg-type]
        fit_params=fit_params,
        random_state=random_state,
        max_iter="auto",
        verbose="ERROR",
    )
    ica.fit(raw_copy, picks="eeg", verbose="ERROR")

    if progress_cb:
        progress_cb({"phase": "saving", "fraction": 0.95})

    session_dir.mkdir(parents=True, exist_ok=True)
    ica.save(str(_ica_path(session_dir)), overwrite=True, verbose="ERROR")

    if progress_cb:
        progress_cb({"phase": "done", "fraction": 1.0})

    return ica


def load_ica(session_dir: Path) -> ICA | None:
    p = _ica_path(session_dir)
    if not p.exists():
        return None
    from mne.preprocessing import read_ica  # pyright: ignore[reportMissingTypeStubs]

    return read_ica(str(p), verbose="ERROR")  # type: ignore[no-any-return]


def label_components_iclabel(
    raw: BaseRaw, ica: ICA
) -> list[tuple[str, float]]:
    """Run ICLabel if available. Returns list of (label, max_prob) per component.

    Falls back to ('unknown', 0.0) for every component if ICLabel is not installed.
    """
    if not _has_iclabel():
        return [("unknown", 0.0) for _ in range(int(ica.n_components_))]

    from mne_icalabel import label_components  # pyright: ignore[reportMissingImports]

    raw_for_label: Any = raw.copy()
    raw_for_label.set_eeg_reference("average", projection=False, verbose="ERROR")
    try:
        raw_for_label.filter(l_freq=1.0, h_freq=100.0, verbose="ERROR")
    except (ValueError, RuntimeError):
        # If sfreq is too low for 100 Hz upper, try a tighter band.
        raw_for_label.filter(l_freq=1.0, h_freq=None, verbose="ERROR")

    result: Any = label_components(raw_for_label, ica, method="iclabel")
    labels: list[str] = list(result["labels"])
    probs: NDArray[np.float64] = np.asarray(result["y_pred_proba"], dtype=np.float64)
    out: list[tuple[str, float]] = []
    for i, lab in enumerate(labels):
        max_p = float(probs[i].max()) if probs.ndim > 1 else float(probs[i])
        out.append((str(lab), max_p))
    return out


def get_components_for_ui(
    raw: BaseRaw,
    ica: ICA,
    series_n_samples: int = 500,
) -> ICAFitResult:
    """Build a UI-friendly payload: per component, a topomap and a sample series."""
    info: Any = raw.info
    n_components = int(ica.n_components_)

    # Topographies: one value per channel per component.
    # ica.get_components() returns (n_channels, n_components).
    components_array: NDArray[np.float64] = np.asarray(
        ica.get_components(), dtype=np.float64
    )

    # Source time series for the first N samples — keep payload small.
    sources: Any = ica.get_sources(raw)
    src_data: NDArray[np.float64] = np.asarray(sources.get_data(), dtype=np.float64)
    n_keep = min(series_n_samples, src_data.shape[1])
    src_short = src_data[:, :n_keep]

    labels = label_components_iclabel(raw, ica)

    components: list[ICAComponent] = []
    for i in range(n_components):
        topo = components_array[:, i].tolist() if components_array.ndim == 2 else []
        series = src_short[i].tolist() if i < src_short.shape[0] else []
        label, prob = labels[i] if i < len(labels) else ("unknown", 0.0)
        components.append(
            ICAComponent(
                index=i,
                label=label,
                prob=prob,
                topo=topo,
                series=series,
            )
        )
    _ = info  # info reserved for future projection of topo to 2D positions
    return ICAFitResult(
        n_components=n_components,
        method="extended_infomax",
        components=components,
    )
