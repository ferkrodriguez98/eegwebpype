# Screenshots

The PNGs in this folder are used in the top-level README. They are generated
end-to-end from a synthetic EEG fixture; no real recordings are ever used.

## Pipeline

1. **Fixture** — `scripts/generate_fixture.py` produces
   `docs/fixtures/DEMO01_synthetic_D1_REST.fif`: a 60 s, 128-channel BioSemi
   layout file with realistic 1/f background, posterior alpha, frontal
   blinks, right-temporal muscle bursts, and a few obviously bad channels
   for the detector to find. Seeded (`numpy.random.default_rng(42)`) so
   regenerations are byte-identical.

2. **Screenshot script** — `apps/web/e2e/screenshots.mjs` drives a headless
   Chromium through Playwright: opens the synthetic session, walks through
   the overview / bad-channels / filter / ICA tabs, and shoots each at
   1440×900 with `deviceScaleFactor: 2`.

## Regenerating

Prerequisites:

- Backend on `:8000` with the fixtures folder visible:

  ```bash
  cd apps/api
  PYPE_EXTERNAL_ROOTS=$(pwd)/../../docs/fixtures \
    .venv/bin/uvicorn pype.main:app --port 8000 --ws wsproto
  ```

- Frontend on `:3000`:

  ```bash
  cd apps/web
  pnpm dev
  ```

Then, from `apps/web/`:

```bash
node e2e/screenshots.mjs
```

The script resets the synthetic session, runs the full preprocessing flow
(load → set montage → auto-detect bad channels → apply filter → fit ICA),
and writes `docs/screenshots/{raw,bad-channels,filter,ica}.png`.

If you change the fixture, regenerate it first:

```bash
apps/api/.venv/bin/python scripts/generate_fixture.py
```

## Notes on fidelity

- The synthetic fixture is uniform enough that the bad-channel detector
  with default thresholds flags every channel. The screenshot script
  rewrites the `detect-bad-channels` URL to use stricter MAD multipliers
  (`mad_k=2`, `pot_z_extreme=4`, `neighbor_corr_thr=0.04`) so the
  DETECTED list reflects the channels actually planted as bad. The
  product defaults are not modified.
- The Next.js dev-mode error overlay is hidden via injected CSS during
  the run; in production builds it does not exist.
