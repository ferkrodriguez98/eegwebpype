# eegwebpype

Plataforma web para preprocesamiento de EEG resting-state. Frontend Next.js + backend FastAPI sobre MNE-Python.

Diseñado para el TFG "Conectividad cerebral y bilingüismo" (FIUBA, 2026), con foco en marcado interactivo de canales malos, comparación test-retest D1/D2, y trazabilidad completa de decisiones de procesamiento.

## Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind + shadcn/ui + uPlot + D3
- **Backend**: FastAPI + MNE-Python + Apache Arrow
- **Estado**: Zustand + IndexedDB
- **Monorepo**: pnpm workspaces (frontend) + uv (backend)

## Estructura

```
eegwebpype/
├── apps/
│   ├── web/      # Next.js
│   └── api/      # FastAPI
├── packages/
│   └── shared/   # tipos TS compartidos
├── data/         # workspace local (gitignored)
└── PLAN.md       # diseño y roadmap
```

## Setup

Ver [PLAN.md](./PLAN.md) para detalles. Setup completo cuando F0 esté listo.
