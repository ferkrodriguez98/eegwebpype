"""Generate a synthetic EEG fixture for README screenshots.

Produces a 60-second, 128-channel BioSemi-layout .fif file that looks like
realistic resting-state EEG: 1/f background, occipital alpha peak with
correct posterior topography, planted eye blinks with frontal propagation,
temporal muscle bursts with high-frequency content, and a few obviously
bad channels for the bad-channel detector to surface.

All data is synthetic; no real recordings are used.

Run manually when the fixture needs to change:

    python scripts/generate_fixture.py

Output: docs/fixtures/DEMO01_synthetic_D1_REST.fif
"""

from __future__ import annotations

from pathlib import Path

import mne
import numpy as np

SEED = 42
SFREQ = 512.0
DURATION_S = 60.0
N_SAMPLES = int(SFREQ * DURATION_S)

# BioSemi 128 layout. The biosemi128 montage in MNE places A on the front-left
# scalp moving back, with D ending up posterior. We exploit that here for
# rough but visually-correct topography.
EEG_CHS = [f"{b}{i}" for b in "ABCD" for i in range(1, 33)]
EXG_CHS = [f"EXG{i}" for i in range(1, 9)]
ALL_CHS = EEG_CHS + EXG_CHS + ["Status"]

OUT = Path(__file__).resolve().parent.parent / "docs" / "fixtures" / "DEMO01_synthetic_D1_REST.fif"


def pink_noise(rng: np.random.Generator, n_samples: int) -> np.ndarray:
    """1/f noise via FFT shaping. Matches the spectral shape of real EEG."""
    white = rng.standard_normal(n_samples)
    spectrum = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n_samples, d=1.0 / SFREQ)
    freqs[0] = 1.0
    spectrum = spectrum / np.sqrt(freqs)
    out = np.fft.irfft(spectrum, n=n_samples)
    return out / out.std()


def get_positions() -> dict[str, np.ndarray]:
    """Real biosemi128 channel positions in 3D (x, y, z) meters."""
    montage = mne.channels.make_standard_montage("biosemi128")
    pos = montage.get_positions()["ch_pos"]
    return {ch: pos[ch] for ch in EEG_CHS if ch in pos}


def alpha_topomap_weights(positions: dict[str, np.ndarray]) -> np.ndarray:
    """Strong over occipital pole, decaying anteriorly. Real alpha topography."""
    weights = np.zeros(len(EEG_CHS))
    # Occipital reference point: most posterior, midline-ish, slightly inferior.
    ref = np.array([0.0, -0.09, 0.02])
    for i, ch in enumerate(EEG_CHS):
        if ch not in positions:
            weights[i] = 0.2
            continue
        d = np.linalg.norm(positions[ch] - ref)
        weights[i] = np.exp(-(d**2) / (2 * 0.04**2))
    return weights


def blink_topomap_weights(positions: dict[str, np.ndarray]) -> np.ndarray:
    """Frontal-pole topography for eye blinks. Symmetric across the midline."""
    weights = np.zeros(len(EEG_CHS))
    ref = np.array([0.0, 0.085, 0.02])  # Fp midline, slightly above.
    for i, ch in enumerate(EEG_CHS):
        if ch not in positions:
            continue
        d = np.linalg.norm(positions[ch] - ref)
        weights[i] = np.exp(-(d**2) / (2 * 0.035**2))
    return weights


def muscle_topomap_weights(positions: dict[str, np.ndarray]) -> np.ndarray:
    """Right-lateral temporal focus, like jaw clench picked up on T8 area."""
    weights = np.zeros(len(EEG_CHS))
    ref = np.array([0.075, 0.0, 0.0])
    for i, ch in enumerate(EEG_CHS):
        if ch not in positions:
            continue
        d = np.linalg.norm(positions[ch] - ref)
        weights[i] = np.exp(-(d**2) / (2 * 0.04**2))
    return weights


def blink_template(sfreq: float) -> np.ndarray:
    width_s = 0.3
    n = int(width_s * sfreq)
    t = np.linspace(-1.5, 1.5, n)
    return np.exp(-(t**2))


def build_signal(rng: np.random.Generator) -> np.ndarray:
    n_eeg = len(EEG_CHS)
    times = np.arange(N_SAMPLES) / SFREQ
    positions = get_positions()

    # Per-channel pink noise base.
    base = np.stack([pink_noise(rng, N_SAMPLES) for _ in range(n_eeg)])

    # Volume-conduction proxy: each channel = 0.4 × own noise + 0.6 × mean of
    # its 5 nearest neighbors. This guarantees neighbor correlation > 0.5
    # across the cap (so the auto_neighbors metric only flags the channels
    # we explicitly plant as bad below).
    pos_arr = np.array([positions.get(ch, np.zeros(3)) for ch in EEG_CHS])
    smoothed = np.zeros_like(base)
    for i in range(n_eeg):
        d = np.linalg.norm(pos_arr - pos_arr[i], axis=1)
        nn = np.argsort(d)[:6]  # self + 5 neighbors
        smoothed[i] = base[nn].mean(axis=0)
    base = 0.4 * base + 0.6 * smoothed

    # Project shared "brain" sources through their respective topographies.
    alpha_w = alpha_topomap_weights(positions)
    alpha_src = rng.standard_normal(N_SAMPLES)
    alpha_spec = np.fft.rfft(alpha_src)
    fr = np.fft.rfftfreq(N_SAMPLES, d=1.0 / SFREQ)
    alpha_band = ((fr >= 8) & (fr <= 12)).astype(float)
    alpha_spec *= alpha_band
    alpha_signal = np.fft.irfft(alpha_spec, n=N_SAMPLES)
    alpha_signal = alpha_signal / (alpha_signal.std() + 1e-9)

    # Shared theta source over a midline-frontal topography.
    theta_w = np.zeros(n_eeg)
    ref_theta = np.array([0.0, 0.04, 0.08])
    for i, ch in enumerate(EEG_CHS):
        if ch in positions:
            d = np.linalg.norm(positions[ch] - ref_theta)
            theta_w[i] = np.exp(-(d**2) / (2 * 0.05**2))
    theta_src = np.sin(2 * np.pi * 6.0 * times + rng.uniform(0, 2 * np.pi))

    base = base + np.outer(alpha_w * 1.5, alpha_signal)
    base = base + np.outer(theta_w * 0.6, theta_src)

    # Per-channel renormalization to ~30 µV RMS, so all channels start out
    # with comparable amplitude. This is what keeps the detector quiet on
    # everything except the channels we plant as bad.
    target_rms = 30e-6
    rms = base.std(axis=1, keepdims=True)
    base = base / np.maximum(rms, 1e-12) * target_rms

    # ---- Eye blink component, projected through frontal topography. ----
    blink_w = blink_topomap_weights(positions)
    blink_src = np.zeros(N_SAMPLES)
    bt = blink_template(SFREQ)
    for t_center in np.arange(2.0, DURATION_S, 4.2):
        start = int(t_center * SFREQ) - len(bt) // 2
        end = start + len(bt)
        if start < 0 or end > N_SAMPLES:
            continue
        amp = 1.0 + 0.15 * rng.standard_normal()
        blink_src[start:end] += bt * amp
    base = base + np.outer(blink_w, blink_src) * 250e-6

    # ---- Muscle component: high-frequency bursts on right-temporal focus. ----
    muscle_w = muscle_topomap_weights(positions)
    muscle_src = np.zeros(N_SAMPLES)
    for t_center in np.arange(8.0, DURATION_S, 11.0):
        burst_n = int(1.0 * SFREQ)
        start = int(t_center * SFREQ)
        end = min(start + burst_n, N_SAMPLES)
        envelope = np.hanning(end - start)
        # Bandpass-shaped high-frequency noise (>30 Hz dominant).
        hf = rng.standard_normal(end - start)
        hf_spec = np.fft.rfft(hf)
        hf_freqs = np.fft.rfftfreq(end - start, d=1.0 / SFREQ)
        # Emphasize 30-80 Hz, the muscle band ICLabel keys on.
        boost = (hf_freqs > 25) & (hf_freqs < 90)
        hf_spec[~boost] *= 0.1
        hf = np.fft.irfft(hf_spec, n=end - start)
        muscle_src[start:end] += envelope * hf
    base = base + np.outer(muscle_w, muscle_src) * 90e-6

    # ---- Plant a few obviously bad channels for the detector to find. ----
    # Map: which channel name -> which kind of badness.
    name_to_idx = {ch: i for i, ch in enumerate(EEG_CHS)}

    # Dead channel: tiny variance, near-flat line.
    dead = name_to_idx["B30"]
    base[dead] = rng.standard_normal(N_SAMPLES) * 0.5e-6

    # Hyperactive channel: 8x normal variance.
    hyper = name_to_idx["C5"]
    base[hyper] = base[hyper] * 8.0

    # Line-noise channel: very strong 50 Hz contamination.
    line = name_to_idx["D14"]
    base[line] = base[line] + np.sin(2 * np.pi * 50.0 * times) * 150e-6

    return base


def main() -> None:
    rng = np.random.default_rng(SEED)

    eeg = build_signal(rng)
    exg = rng.standard_normal((len(EXG_CHS), N_SAMPLES)) * 5e-6
    status = np.zeros((1, N_SAMPLES))
    data = np.vstack([eeg, exg, status])

    ch_types = ["eeg"] * len(EEG_CHS) + ["misc"] * len(EXG_CHS) + ["stim"]
    info = mne.create_info(ch_names=ALL_CHS, sfreq=SFREQ, ch_types=ch_types)

    raw = mne.io.RawArray(data, info, verbose="ERROR")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    raw.save(str(OUT), overwrite=True, verbose="ERROR")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
