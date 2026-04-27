# e2e

Playwright-based end-to-end smoke tests for flows that involve real
backend services (WebSocket handshakes, MNE pipelines, etc). Not part of
unit/CI suites — they require both servers running and a real recording
in the configured workspace.

## Setup

```bash
pnpm --filter @eegwebpype/web e2e:install
```

Installs the chromium binary into the Playwright cache.

## Run

```bash
# in one shell
pnpm api:dev

# in another
pnpm --filter @eegwebpype/web dev

# in a third
pnpm --filter @eegwebpype/web e2e
```

## Tests

- `ica-fit.spec.mjs` — opens a session, clicks "fit ICA", waits for the
  fit to complete via WebSocket. Defaults to `AK15_D1`; override with
  `E2E_SESSION=<id>`. Exit 0 on success, 1 on either a visible error
  toast or a 120s timeout. Was originally written to bisect the
  `connection dropped before fit completed` bug — turns out uvicorn's
  default `websockets` library rejects the browser handshake in some
  Chromium versions; pinning to `wsproto` (in `pnpm api:dev`) fixes it.
