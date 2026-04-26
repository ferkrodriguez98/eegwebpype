# eegwebpype

Web-based preprocessing pipeline for resting-state EEG. Runs locally on top of MNE-Python.

Interactive bad-channel marking, in-browser ICA with live progress, filter previews, epoching with peak-to-peak rejection, test-retest comparison, and a fully reproducible event log per session.

## Features

- **In-place data scan**: point at a folder of `.bdf` / `.fif` files and process them without copying or moving the originals.
- **Interactive bad-channel detector** with three combined metrics (total power, PSD shape deviation, spatial neighbor correlation).
- **Filter preview**: tweak bandpass parameters and see the resulting PSD live before committing.
- **ICA**: fit, classify with ICLabel (optional), pick components to exclude. Progress streamed over WebSocket.
- **Spherical interpolation** of bad channels and **average reference**.
- **Fixed-length epoching** with auto-rejection by MAD-based peak-to-peak threshold and manual override.
- **Export**: produce `clean-epo.fif` plus a JSON provenance log with every event applied.
- **Compare D1 vs D2** of the same subject side by side, with a diff of marked channels.
- **Append-only event log** with undo (`Cmd+Z`). Replay reproduces any session bit-exact from its source file.

## Stack

- **Frontend**: Next.js 15, React 19, TypeScript (strict), Tailwind, uPlot, D3, Lucide.
- **Backend**: FastAPI, MNE-Python, Apache Arrow for signal streaming.
- **Tooling**: pnpm workspaces, Turbo, Biome, Vitest, Ruff, Pyright, Pytest.

## Requirements

- Node ≥ 22
- pnpm ≥ 10
- Python ≥ 3.13
- [uv](https://docs.astral.sh/uv/)

## Install

```bash
pnpm install
cd apps/api && uv sync --extra dev && cd ../..
```

Optional automatic ICA classification (ICLabel + PyTorch):

```bash
cd apps/api && uv sync --extra iclabel
```

## Dev

Two terminals:

```bash
# backend
pnpm api:dev          # http://localhost:8000

# frontend
pnpm --filter @eegwebpype/web dev   # http://localhost:3000
```

Open the frontend, add a folder containing `.bdf` files as an external root, scan, and pick a session.

## Project structure

```
eegwebpype/
├── apps/
│   ├── web/           # Next.js frontend
│   └── api/           # FastAPI backend (MNE)
├── packages/
│   └── shared/        # TypeScript types shared between web and api
└── data/              # local workspace state (gitignored)
```

## Scripts

```bash
pnpm lint              # biome on web + shared
pnpm typecheck         # tsc on web + shared
pnpm test              # vitest
pnpm build             # next build

pnpm api:lint          # ruff
pnpm api:typecheck     # pyright (strict)
pnpm api:test          # pytest
```

## Data layout

Sessions are referenced in place from one or more configured roots. The backend writes only to `data/sessions/{id}/`:

- `state.json` — append-only event log + metadata.
- `snapshots/*.fif` — cached intermediate raw states.
- `exports/{id}_clean-epo.fif` and `{id}_log.json` — output of the export step.

External read-only roots are configured at runtime through the workspace UI or `data/config.json`. Files inside those roots are never modified.
