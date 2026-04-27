# eegwebpype

Web-based preprocessing pipeline for resting-state EEG. Runs locally on top of MNE-Python.

Interactive bad-channel marking, in-browser ICA with live progress, filter previews, epoching with peak-to-peak rejection, test-retest comparison, and a fully reproducible event log per session.

> **v1 scope**: optimized for resting-state recordings with two sessions per subject named `D1` and `D2` (test-retest). Generalization to other paradigms, longitudinal studies with N sessions, and arbitrary naming conventions is tracked in the `v2` label on GitHub Issues.

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

- **Node.js** ≥ 22
- **pnpm** ≥ 10
- **Python** 3.12 (pinned — `torch` / `onnxruntime`, used by the optional ICLabel classifier, do not yet ship 3.13 wheels for macOS x86_64)
- **[uv](https://docs.astral.sh/uv/)** (Python package manager used to manage the backend venv)

## First-time setup (no prior web experience needed)

If you have never run a Node or Python project before, follow this section step by step. It assumes macOS or Linux with a working terminal. On Windows, use WSL2.

### 1. Install the toolchain

The project needs four command-line tools: `node`, `pnpm`, `python3.12`, and `uv`.

**macOS (recommended path, via [Homebrew](https://brew.sh)):**

```bash
brew install node@22 pnpm python@3.12 uv
```

After installing, make sure `node` resolves to v22:

```bash
node --version    # should print v22.x
pnpm --version    # should print 10.x or higher
python3.12 --version
uv --version
```

If `node` prints an older version, run `brew link --overwrite node@22`.

**Linux:** install Node ≥ 22 from [nodejs.org](https://nodejs.org/) or via your distro, then:

```bash
npm install -g pnpm
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Make sure `python3.12` is available (`apt install python3.12` / `dnf install python3.12` / etc.).

### 2. Clone the repo

```bash
git clone https://github.com/<your-fork-or-org>/eegwebpype.git
cd eegwebpype
```

### 3. Install dependencies

The repo is split into a frontend (`apps/web`) and a backend (`apps/api`). Each has its own dependency manager.

```bash
# frontend + shared TypeScript packages
pnpm install

# backend Python venv (created automatically inside apps/api/.venv)
cd apps/api
uv sync --extra dev
cd ../..
```

If you also want automatic ICA component classification (via ICLabel + onnxruntime), add the optional extra:

```bash
cd apps/api
uv sync --extra dev --extra iclabel
cd ../..
```

This is heavier (downloads onnxruntime) but lets the app guess which ICA components are eye blinks, muscle, heartbeats, etc., instead of you labeling them by hand.

### 4. Run the app

You need **two terminals open at the same time**, one for the backend and one for the frontend. Both have to stay running while you use the app.

**Terminal 1 — backend (FastAPI server on port 8000):**

```bash
pnpm api:dev
```

You should see something like `Uvicorn running on http://127.0.0.1:8000`.

**Terminal 2 — frontend (Next.js dev server on port 3000):**

```bash
pnpm --filter @eegwebpype/web dev
```

You should see `Local: http://localhost:3000`.

Now open [http://localhost:3000](http://localhost:3000) in your browser. The first load can take 10–20 seconds while Next.js compiles.

### 5. Point the app at your data

The app does **not** copy your EEG files. It reads them in place from a folder you configure as an "external root".

1. In the UI, open the workspace settings (gear icon).
2. Add the absolute path to the folder containing your `.bdf` / `.fif` recordings.
3. Click "Scan". Sessions detected from filenames (e.g. `SUBJ01_REST_D1.bdf`) appear in the sidebar.
4. Pick a session and start preprocessing.

Anything the app writes (event log, intermediate snapshots, exports) goes under `data/sessions/{id}/` inside the repo. The original files are never modified.

### 6. Stop the app

In each terminal, press `Ctrl+C`. The dev servers shut down cleanly.

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

## Privacy

Nothing under `data/` is tracked by git, and EEG file extensions (`.bdf`, `.fif`, `.cnt`, `.edf`, `.set`, …) are gitignored repository-wide. Recordings, subject identifiers, and the absolute paths to your dataset never leave your machine through this repo.

The frontend talks to the backend at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`) and the backend serves `localhost:3000` only — no telemetry, no analytics, no outbound calls beyond `pip` / `pnpm` resolving dependencies at install time.

## Troubleshooting

**`pnpm api:dev` fails with `sh: uv: command not found`**

The `api:dev` script invokes `uv` through `pnpm`'s shell, which does not always inherit `~/.local/bin` from your interactive rc. Either install `uv` to a location already on `PATH` (e.g. via `brew install uv`), or run uvicorn directly:

```bash
cd apps/api && uv run uvicorn pype.main:app --reload --port 8000 --ws wsproto
```

**Backend imports fail after pulling changes that touch `pyproject.toml`**

Re-sync the venv:

```bash
cd apps/api && uv sync --extra dev
```

Add `--extra iclabel` if you want automatic ICA component classification.

**`uv sync` fails with a Python version error**

`uv` needs to find a Python 3.12 interpreter. Install it (`brew install python@3.12` on macOS) and re-run. You can verify uv sees it with `uv python list`.

**Port 3000 or 8000 is already in use**

Find and kill the stale process:

```bash
lsof -i :3000 -t | xargs kill
lsof -i :8000 -t | xargs kill
```

**ICA fit fails with `connection dropped before fit completed`**

The uvicorn backend has to serve WebSockets through `wsproto`, not the default `websockets` library bundled with `uvicorn[standard]`: the latter rejects some Chromium handshakes with `400 Bad Request`. The `pnpm api:dev` script already passes `--ws wsproto`; if you start uvicorn by hand, include the flag too.

## End-to-end smoke

`apps/web/e2e/` ships a Playwright script that drives the full ICA fit flow against a running backend + frontend. Run it locally with:

```bash
pnpm --filter @eegwebpype/web e2e:install   # one-time
pnpm --filter @eegwebpype/web e2e
```

It opens the configured session (default `AK15_D1`, override with `E2E_SESSION=<id>`), clicks **fit ICA**, and waits up to five minutes for the WebSocket fit to complete. Originally written to bisect the `wsproto` handshake bug; useful as a regression sentinel for any change that touches the busy bus, mutation lifecycle, or WS plumbing.

**The frontend loads but says "failed to fetch" / shows no sessions**

The backend is not running, or it crashed. Check Terminal 1 for errors and re-run `pnpm api:dev`. Confirm the API is up by visiting [http://localhost:8000/health](http://localhost:8000/health) — it should return a JSON object with `"ok": true`.

**`pnpm install` is very slow or fails behind a corporate proxy**

Configure pnpm to use your proxy: `pnpm config set proxy http://...` and `pnpm config set https-proxy http://...`. Same for `npm config` if needed.
