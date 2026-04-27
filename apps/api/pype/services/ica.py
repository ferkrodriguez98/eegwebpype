"""ICA fit + ICLabel (optional). The fitted model is cached to disk so the
components endpoint does not have to re-fit on every request.

Design:
- `fit_ica(raw, ...)` runs `mne.preprocessing.ICA().fit()` and returns the ICA.
- The ICA is persisted as `data/sessions/{id}/ica.fif`.
- ICLabel only if `mne_icalabel` is installed (`iclabel` extra).
"""

# pyright: reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownVariableType=false, reportMissingImports=false

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Literal

import numpy as np
from mne.io import BaseRaw  # pyright: ignore[reportMissingTypeStubs]
from mne.preprocessing import ICA  # pyright: ignore[reportMissingTypeStubs]
from mne.utils import logger as mne_logger  # pyright: ignore[reportMissingTypeStubs]
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


def _ica_labels_path(session_dir: Path) -> Path:
    return session_dir / "ica_labels.json"


def _load_cached_labels(session_dir: Path) -> list[tuple[str, float]] | None:
    """Read previously-computed ICLabel results. Returns None if the
    cache file is missing, malformed, or out-of-sync (different number
    of components than expected). Callers should fall back to running
    ICLabel and then writing the cache."""
    p = _ica_labels_path(session_dir)
    if not p.exists():
        return None
    try:
        with p.open("r") as f:
            payload: Any = json.load(f)
        items: list[Any] = payload["labels"]
        return [(str(item[0]), float(item[1])) for item in items]
    except (OSError, json.JSONDecodeError, KeyError, IndexError, ValueError, TypeError):
        return None


def _save_cached_labels(session_dir: Path, labels: list[tuple[str, float]]) -> None:
    p = _ica_labels_path(session_dir)
    try:
        session_dir.mkdir(parents=True, exist_ok=True)
        with p.open("w") as f:
            json.dump({"labels": labels}, f)
    except OSError:
        # Caching is best-effort; if disk is full or read-only we still
        # return the freshly-computed labels.
        pass


def _picks_with_positions(raw: BaseRaw) -> list[str]:
    """Return the names of EEG channels that have a finite, non-zero
    electrode position. Used both at fit time and at ICLabel time so
    they always agree on which channels are scalp-EEG.
    """
    info: Any = raw.info
    chs: Any = info["chs"]
    names: list[str] = []
    for ch in chs:
        kind = ch.get("kind") if isinstance(ch, dict) else getattr(ch, "kind", None)
        if kind != 2:  # FIFFV_EEG_CH
            continue
        loc: Any = ch.get("loc") if isinstance(ch, dict) else getattr(ch, "loc", None)
        if loc is None or len(loc) < 3:
            continue
        try:
            pos = (float(loc[0]), float(loc[1]), float(loc[2]))
        except (TypeError, ValueError):
            continue
        if not all(np.isfinite(p) for p in pos):
            continue
        if not any(p != 0.0 for p in pos):
            continue
        ch_name = ch.get("ch_name") if isinstance(ch, dict) else getattr(ch, "ch_name", None)
        if ch_name:
            names.append(str(ch_name))
    return names


# MNE's infomax loop emits one log line per iteration of the form:
#   "step 42 - lrate 0.000981, wchange ...  angledelta ..."
# We sniff those to estimate progress without modifying MNE itself.
_STEP_RE = re.compile(r"^\s*step\s+(\d+)\b")


class _IterationProgressHandler(logging.Handler):
    """Catches MNE's per-iteration log lines and forwards a fraction
    estimate to a callback. Suppresses the log output (we don't want
    MNE chatter on stderr) by setting `propagate = False` on the
    logger and adding only this handler.
    """

    def __init__(self, max_iter: int, callback: Any) -> None:
        super().__init__()
        self._max_iter = max(1, int(max_iter))
        self._callback = callback
        self._last_step = 0

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = record.getMessage()
        except (TypeError, ValueError):
            return
        m = _STEP_RE.match(msg)
        if not m:
            return
        step = int(m.group(1))
        # Don't report regressions (rare lrate-decrease restarts).
        if step <= self._last_step:
            return
        self._last_step = step
        # Reserve [0.15, 0.90] for fitting; clamp to keep the bar moving
        # without ever reaching 100% during fit (saving/done finish it).
        frac = 0.15 + min(1.0, step / self._max_iter) * 0.75
        try:
            self._callback({"phase": "fitting", "fraction": frac})
        except Exception:
            # Never let progress reporting break the fit.
            pass


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

    # Initial fitting event — the per-iteration handler will replace
    # the fraction once MNE emits its first "step N" log.
    if progress_cb:
        progress_cb({"phase": "fitting", "fraction": 0.15})

    fit_params: dict[str, Any] = {}
    if method == "extended_infomax":
        fit_params = {"extended": True}
        ica_method: str = "infomax"
    else:
        ica_method = method

    # Default `max_iter` for the auto-extended-infomax path is 500.
    # MNE's `max_iter="auto"` resolves to 500 internally for infomax.
    # If we guess wrong, the bar will plateau near 90% rather than
    # mislead — never reaches 100% during fit anyway.
    fit_max_iter = 500

    ica: Any = ICA(
        n_components=n_components,
        method=ica_method,  # type: ignore[arg-type]
        fit_params=fit_params,
        random_state=random_state,
        max_iter="auto",
        verbose="ERROR",
    )

    # Build picks for the fit: prefer only EEG channels that have a
    # real scalp position (so ICLabel later works). If the user hasn't
    # set a montage yet, fall back to MNE's default "eeg" picks so the
    # fit still runs — they just won't get neural-network labels.
    fit_picks: str | list[str] = _picks_with_positions(raw_copy) or "eeg"

    # Attach the iteration-sniffing handler ONLY for the duration of
    # the fit, then remove it. We also need MNE's logger to actually
    # emit those lines, which requires verbose=True on .fit() — but we
    # silence propagation so nothing reaches stderr / the root logger.
    progress_handler: logging.Handler | None = None
    prev_propagate: bool = mne_logger.propagate
    if progress_cb is not None:
        progress_handler = _IterationProgressHandler(fit_max_iter, progress_cb)
        progress_handler.setLevel(logging.INFO)
        mne_logger.addHandler(progress_handler)
        mne_logger.propagate = False
    try:
        # verbose=True on fit() turns on the per-iteration `logger.info`
        # calls in mne.preprocessing.infomax_ that we sniff.
        ica.fit(raw_copy, picks=fit_picks, verbose=True if progress_cb else "ERROR")
    finally:
        if progress_handler is not None:
            mne_logger.removeHandler(progress_handler)
            mne_logger.propagate = prev_propagate

    if progress_cb:
        progress_cb({"phase": "saving", "fraction": 0.95})

    session_dir.mkdir(parents=True, exist_ok=True)
    ica.save(str(_ica_path(session_dir)), overwrite=True, verbose="ERROR")

    # Invalidate any previous label cache: the new ICA model has
    # different components so old labels are meaningless.
    labels_path = _ica_labels_path(session_dir)
    if labels_path.exists():
        try:
            labels_path.unlink()
        except OSError:
            pass

    if progress_cb:
        progress_cb({"phase": "done", "fraction": 1.0})

    return ica


def load_ica(session_dir: Path) -> ICA | None:
    p = _ica_path(session_dir)
    if not p.exists():
        return None
    from mne.preprocessing import read_ica  # pyright: ignore[reportMissingTypeStubs]

    return read_ica(str(p), verbose="ERROR")  # type: ignore[no-any-return]


def label_components_iclabel(raw: BaseRaw, ica: ICA) -> list[tuple[str, float]]:
    """Run ICLabel if available. Returns list of (label, max_prob) per component.

    Falls back to ('unknown', 0.0) for every component if ICLabel is not installed.
    """
    has = _has_iclabel()
    print(f"[iclabel] _has_iclabel={has}", flush=True)
    if not has:
        return [("unknown", 0.0) for _ in range(int(ica.n_components_))]

    try:
        from mne_icalabel import label_components  # pyright: ignore[reportMissingImports]

        print("[iclabel] imported label_components", flush=True)
    except Exception as e:
        print(f"[iclabel] import failed: {type(e).__name__}: {e}", flush=True)
        return [("unknown", 0.0) for _ in range(int(ica.n_components_))]

    try:
        raw_for_label: Any = raw.copy()
        # Restrict the raw to exactly the channels the ICA was fitted on.
        # `ica.ch_names` is the source of truth; if any of those are
        # missing here (e.g. someone dropped channels post-fit) ICLabel
        # would error, so we intersect.
        ica_chs: list[str] = list(ica.ch_names)
        present = set(raw_for_label.ch_names)
        keep_names = [n for n in ica_chs if n in present]
        if len(keep_names) != len(ica_chs):
            print(
                f"[iclabel] missing {len(ica_chs) - len(keep_names)} channels",
                flush=True,
            )
        if not keep_names:
            return [("unknown", 0.0) for _ in range(int(ica.n_components_))]
        raw_for_label.pick(keep_names)
        raw_for_label.set_eeg_reference("average", projection=False, verbose="ERROR")
        try:
            raw_for_label.filter(l_freq=1.0, h_freq=100.0, verbose="ERROR")
        except (ValueError, RuntimeError) as e:
            print(f"[iclabel] filter 100Hz failed: {e}; falling back", flush=True)
            raw_for_label.filter(l_freq=1.0, h_freq=None, verbose="ERROR")

        print("[iclabel] running label_components(method=iclabel)", flush=True)
        result: Any = label_components(raw_for_label, ica, method="iclabel")
        print(
            f"[iclabel] result keys: {list(result.keys()) if hasattr(result, 'keys') else result}",
            flush=True,
        )
    except Exception as e:
        print(f"[iclabel] failed: {type(e).__name__}: {e}", flush=True)
        import traceback

        traceback.print_exc()
        return [("unknown", 0.0) for _ in range(int(ica.n_components_))]

    labels: list[str] = list(result["labels"])
    probs: NDArray[np.float64] = np.asarray(result["y_pred_proba"], dtype=np.float64)
    print(f"[iclabel] got {len(labels)} labels, probs shape={probs.shape}", flush=True)
    out: list[tuple[str, float]] = []
    for i, lab in enumerate(labels):
        max_p = float(probs[i].max()) if probs.ndim > 1 else float(probs[i])
        out.append((str(lab), max_p))
    return out


def get_components_for_ui(
    raw: BaseRaw,
    ica: ICA,
    # Sparkline preview: ~100 buckets × 2 values (min, max per bucket)
    # = 200 points spanning the whole recording. Min/max bucketing
    # preserves the real envelope of the source signal at every time
    # scale (same trick used in the main scroll plot) — a contiguous
    # slice could land in a quiet region and look flat; evenly-spaced
    # samples alias and also look flat. This is the right answer.
    series_n_samples: int = 200,
    session_dir: Path | None = None,
) -> ICAFitResult:
    """Build a UI-friendly payload: per component, a topomap and a sample series.

    If `session_dir` is provided, ICLabel results are read from a JSON
    cache (`ica_labels.json`) instead of being recomputed every call.
    The cache is refreshed transparently if it's missing or stale.
    """
    info: Any = raw.info
    n_components = int(ica.n_components_)

    # Topographies: one value per channel per component.
    # ica.get_components() returns (n_channels, n_components).
    components_array: NDArray[np.float64] = np.asarray(ica.get_components(), dtype=np.float64)

    # Source time series. We bucket the full recording into N//2 equal
    # bins and emit (min, max) per bin → 2 points per bucket → exactly
    # `series_n_samples` total. This preserves the envelope at every
    # zoom level, so even a component with most of its activity in
    # only part of the recording renders with non-zero amplitude
    # somewhere along the sparkline. Same trick as the main scroll
    # plot's M4 decimation.
    sources: Any = ica.get_sources(raw)
    src_data: NDArray[np.float64] = np.asarray(sources.get_data(), dtype=np.float64)
    n_total = src_data.shape[1]
    if n_total <= series_n_samples:
        src_short = src_data
    else:
        n_buckets = max(2, series_n_samples // 2)
        # Edges of each bucket along the time axis.
        edges = np.linspace(0, n_total, n_buckets + 1, dtype=np.int64)
        n_comp = src_data.shape[0]
        out = np.empty((n_comp, n_buckets * 2), dtype=np.float64)
        for b in range(n_buckets):
            lo = int(edges[b])
            hi = int(edges[b + 1])
            if hi <= lo:
                # Degenerate bucket: emit the boundary sample twice.
                out[:, 2 * b] = src_data[:, lo]
                out[:, 2 * b + 1] = src_data[:, lo]
                continue
            seg = src_data[:, lo:hi]
            mins = seg.min(axis=1)
            maxs = seg.max(axis=1)
            # Interleave min then max in temporal order so the polyline
            # traces a faithful envelope across the whole recording.
            out[:, 2 * b] = mins
            out[:, 2 * b + 1] = maxs
        src_short = out

    # Try the on-disk cache first. ICLabel inference is the expensive
    # part of building this payload (~1–2s for 20 components); skipping
    # it on cache hit makes the components endpoint instant.
    labels: list[tuple[str, float]] | None = None
    if session_dir is not None:
        cached = _load_cached_labels(session_dir)
        if cached is not None and len(cached) == n_components:
            labels = cached
    if labels is None:
        print(
            f"[get_components_for_ui] running iclabel for {n_components} components",
            flush=True,
        )
        labels = label_components_iclabel(raw, ica)
        if session_dir is not None and labels:
            _save_cached_labels(session_dir, labels)
    else:
        print("[get_components_for_ui] iclabel cache hit", flush=True)

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
