# eegwebpype

Plataforma web para preprocesamiento de EEG resting-state. Frontend Next.js + backend FastAPI sobre MNE-Python.

Diseñado para el TFG "Conectividad cerebral y bilingüismo" (FIUBA, 2026), con foco en marcado interactivo de canales malos, comparación test-retest D1/D2, y trazabilidad completa de decisiones de procesamiento.

## Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind + shadcn/ui + uPlot + D3
- **Backend**: FastAPI + MNE-Python + Apache Arrow
- **Estado**: Zustand + IndexedDB
- **Monorepo**: pnpm workspaces (frontend) + uv (backend) + Turbo

## Estructura

```
eegwebpype/
├── apps/
│   ├── web/              # Next.js
│   └── api/              # FastAPI (uv)
├── packages/
│   └── shared/           # tipos TS compartidos
├── data/                 # workspace local (gitignored)
└── PLAN.md               # diseño y roadmap
```

## Setup

### Requirements
- Node ≥ 22
- pnpm ≥ 10
- Python ≥ 3.13
- [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

### Install

```bash
pnpm install
cd apps/api && uv sync --extra dev && cd ../..
```

### Dev

En dos terminales:

```bash
# terminal 1 — frontend
pnpm --filter @eegwebpype/web dev

# terminal 2 — backend
pnpm api:dev
```

Frontend en http://localhost:3000, API en http://localhost:8000.
La home muestra el estado del backend vía `/health`.

### Lint, typecheck, test

```bash
pnpm lint
pnpm typecheck
pnpm test

pnpm api:lint
pnpm api:typecheck
pnpm api:test
```

## Roadmap

Ver [PLAN.md](./PLAN.md). Issues por fase en [GitHub Issues](https://github.com/ferkrodriguez98/eegwebpype/issues).
