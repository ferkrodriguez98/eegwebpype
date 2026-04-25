# eegwebpype — Plan

Plataforma web para preprocesamiento de EEG resting-state, optimizada para el workflow del TFG "Conectividad cerebral y bilingüismo" pero diseñada para ser reusable.

## Norte de producto

**Una sola frase**: procesar test-retest EEG con marcado interactivo, comparación D1/D2 sincrónica, y trazabilidad completa de decisiones, en una UI que no se traba con 128 canales.

Cada feature responde a esa frase. Si una feature no la sirve, no entra en V1.

## Principios de diseño

1. **Performance es feature, no optimización tardía.** 60fps siempre en interacción, < 500ms en operaciones de cálculo, < 2s en carga inicial.
2. **Defaults inteligentes con override visible.** Cada decisión automática es inspeccionable: qué la tomó, con qué métrica, con qué valor.
3. **Reproducibilidad nativa.** Cada operación es un evento en un append-only log. El estado de una sesión se reconstruye replicando eventos. Exportable como un único JSON.
4. **Cero modales innecesarios, undo infinito.** Toda acción es reversible. No hay confirmaciones, hay Cmd+Z.
5. **Operable por teclado.** El power user procesa archivos sin tocar el mouse después de la primera hora.
6. **MNE como motor, no como UI.** Toda la matemática y procesamiento real es MNE-Python. Lo nuestro es la experiencia.

## Stack técnico

### Frontend (`apps/web`)
- **Next.js 15** (App Router, React Server Components donde aplica)
- **React 19** + **TypeScript** estricto
- **Tailwind CSS** + **shadcn/ui** (componentes UI no-visualización)
- **uPlot** (vía `uplot-react`) — scroll temporal, PSD, series ICA. Canvas-based, 60fps con 128+ trazas.
- **D3** + **d3-contour** — topomaps, heatmaps de conectividad. SVG con interactividad.
- **Zustand** (estado global) + **persist middleware → IndexedDB** (undo stack y estado inter-sesión)
- **TanStack Query** (server state, caching, invalidación)
- **`@apache-arrow/ts`** (decode de señales del backend)

### Backend (`apps/api`)
- **FastAPI** (async, OpenAPI auto, Pydantic)
- **MNE-Python** (motor de procesamiento)
- **NumPy + SciPy** (operaciones rápidas)
- **PyArrow** (serialización binaria de señales)
- **WebSockets** nativos de FastAPI (progreso de operaciones largas)
- **Pydantic v2** (validación de schemas)
- **uv** (package manager)

### Shared (`packages/shared`)
- Tipos TypeScript generados desde los Pydantic schemas vía `datamodel-code-generator` (run en CI).

### Tooling
- **pnpm workspaces** (monorepo frontend)
- **Turbo** (build orchestration, caching)
- **Biome** (linter + formatter, reemplaza ESLint+Prettier)
- **Playwright** (E2E)
- **pytest** (backend tests)
- **ruff** (Python linter/formatter)

## Estructura de carpetas

```
eegwebpype/
├── apps/
│   ├── web/                          # Next.js
│   │   ├── app/
│   │   │   ├── (workspace)/          # vista principal, lista de sujetos
│   │   │   ├── session/[id]/         # vista de procesamiento de una sesión
│   │   │   ├── compare/[subject]/    # vista D1/D2 lado a lado
│   │   │   └── api/                  # rutas Next solo para auth/upload simple
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn
│   │   │   ├── viz/                  # uPlot + D3 wrappers
│   │   │   │   ├── ScrollPlot.tsx
│   │   │   │   ├── PSDPlot.tsx
│   │   │   │   ├── Topomap.tsx
│   │   │   │   ├── ICAComponentCard.tsx
│   │   │   │   └── EpochsMatrix.tsx
│   │   │   └── pype/                 # componentes específicos de la app
│   │   ├── lib/
│   │   │   ├── api/                  # cliente HTTP + WebSocket
│   │   │   ├── arrow/                # decode de señales
│   │   │   └── state/                # Zustand stores
│   │   └── package.json
│   └── api/                          # FastAPI
│       ├── pype/
│       │   ├── main.py
│       │   ├── routers/
│       │   │   ├── files.py
│       │   │   ├── sessions.py
│       │   │   ├── operations.py     # filter, ica, interp, ref, epochs
│       │   │   └── batch.py
│       │   ├── services/
│       │   │   ├── mne_engine.py     # wrappers de MNE
│       │   │   ├── event_log.py      # append-only log
│       │   │   ├── snapshots.py      # cache de estados intermedios
│       │   │   └── signal_serde.py   # encode Arrow
│       │   ├── schemas/              # Pydantic
│       │   └── ws/                   # WebSocket handlers (ICA, batch)
│       ├── tests/
│       └── pyproject.toml
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── schemas.ts            # auto-generado desde Pydantic
│       │   └── events.ts             # tipos de eventos
│       └── package.json
├── data/                             # gitignored
│   ├── sessions/
│   │   └── {subject}_{session}/
│   │       ├── state.json
│   │       ├── snapshots/
│   │       │   ├── after_filter.fif
│   │       │   ├── after_ica.fif
│   │       │   └── after_interp.fif
│   │       └── exports/
│   │           ├── clean-epo.fif
│   │           └── log.json
│   └── workspace.json
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── PLAN.md
└── README.md
```

## Modelo de datos

### state.json (corazón del sistema)

Una sesión es un append-only log de eventos + snapshots opcionales para acelerar replay.

```typescript
type SessionState = {
  id: string;                       // "AB11_D1"
  subject: string;                  // "AB11"
  session: "D1" | "D2";
  source_file: string;              // ruta absoluta al .bdf
  created_at: string;               // ISO 8601
  updated_at: string;
  events: Event[];
  snapshots: Snapshot[];
  metadata: {
    sfreq_original: number;
    n_channels_original: number;
    duration_seconds: number;
  };
};

type Event =
  | { id: string; ts: string; op: "load"; params: { source_file: string } }
  | { id: string; ts: string; op: "drop_channels"; params: { channels: string[] } }
  | { id: string; ts: string; op: "set_montage"; params: { montage: string } }
  | { id: string; ts: string; op: "resample"; params: { sfreq: number } }
  | { id: string; ts: string; op: "filter"; params: { l_freq?: number; h_freq?: number; l_trans?: number; h_trans?: number } }
  | { id: string; ts: string; op: "mark_bad"; params: { channels: string[]; reason: "auto_power" | "auto_shape" | "auto_neighbors" | "manual" } }
  | { id: string; ts: string; op: "unmark_bad"; params: { channels: string[] } }
  | { id: string; ts: string; op: "fit_ica"; params: { n_components: number; method: string; random_state: number } }
  | { id: string; ts: string; op: "label_ica"; params: { method: "iclabel" | "manual"; labels: { component: number; label: string; prob: number }[] } }
  | { id: string; ts: string; op: "exclude_ica"; params: { components: number[]; reason: string } }
  | { id: string; ts: string; op: "apply_ica"; params: {} }
  | { id: string; ts: string; op: "interpolate_bads"; params: {} }
  | { id: string; ts: string; op: "set_reference"; params: { type: "average" | "REST" | "rest" } }
  | { id: string; ts: string; op: "epoch"; params: { length_seconds: number; overlap: number; detrend: 0 | 1 | 2 | null } }
  | { id: string; ts: string; op: "reject_epochs"; params: { indices: number[]; reason: "auto_ptp" | "manual" } }
  | { id: string; ts: string; op: "export"; params: { kind: "epochs" | "raw"; path: string } };

type Snapshot = {
  after_event: string;              // event id
  fif_path: string;                 // ruta relativa dentro de data/sessions/{id}/snapshots/
  created_at: string;
};
```

### Reglas del log

- **Append-only**: nunca se modifican eventos pasados. Undo = `pop()` del último evento + invalidar snapshots posteriores.
- **Determinístico**: replay del log produce siempre el mismo resultado para los mismos datos de entrada.
- **Idempotente por evento**: aplicar el mismo evento dos veces es safe (lo detectamos y skip).
- **Snapshots automáticos** en hitos pesados: post-filter, post-ICA, post-interp, post-epochs. Cargar una sesión carga el snapshot más reciente y replica solo los eventos posteriores.

### workspace.json

```typescript
type Workspace = {
  version: 1;
  data_root: string;                // "/Users/fermin/Desktop/REST/Rest/Rest"
  sessions: SessionRef[];
};

type SessionRef = {
  id: string;
  subject: string;
  session: "D1" | "D2";
  status: "raw" | "in_progress" | "done" | "exported";
  last_opened: string;
  source_file: string;
};
```

## API contract

### REST endpoints

```
GET    /api/workspace                            # lista de sujetos
POST   /api/workspace/scan                       # escanea data_root y registra archivos nuevos

GET    /api/sessions/{id}                        # state.json completo
POST   /api/sessions/{id}/events                 # append evento (filter, mark_bad, etc.)
DELETE /api/sessions/{id}/events/last            # undo
POST   /api/sessions/{id}/snapshots              # forzar snapshot

GET    /api/sessions/{id}/signal                 # señal (Arrow IPC stream)
       ?from=0&to=10&channels=A1,A2&decimate=auto
GET    /api/sessions/{id}/psd                    # PSD computado (Arrow)
       ?fmin=0.5&fmax=47&picks=eeg
GET    /api/sessions/{id}/topomap                # valores por canal para topomap
       ?metric=shape_dev|power_50hz|power_alpha|power_gamma
GET    /api/sessions/{id}/ica/components         # serie temporal de cada IC + topographies
GET    /api/sessions/{id}/epochs                 # ptp por época por canal

POST   /api/sessions/{id}/export                 # genera _clean-epo.fif + log.json

POST   /api/batch/run                            # corre batch sobre N sesiones
```

### WebSocket

```
WS /ws/sessions/{id}/operations
  → server → client: progress events durante operaciones largas (ICA fit, batch)
  ← client → server: cancel signal
```

### Serialización de señales

- **JSON**: solo metadata, listas chicas, configs. Nunca señales.
- **Arrow IPC stream**: matrices de señal (n_channels × n_samples). El cliente decodifica con `apache-arrow` y pasa directo a uPlot sin transformaciones.
- **Decimación adaptativa**: el endpoint de señal acepta `decimate=auto` y, según el rango de tiempo solicitado, devuelve min/max por bucket en vez de raw. Implementación tipo "M4" (largest triangle three buckets).

## Vistas (frontend)

### 1. Workspace view (`/`)
- Sidebar izquierdo: árbol de sujetos, expandible a sesiones D1/D2.
- Main: grid de cards, una por sesión. Cada card muestra:
  - Badge de estado (raw / in_progress / done).
  - Mini PSD pre-procesado.
  - "Last opened" timestamp.
- Drag & drop de carpeta o archivos individuales.
- Botón "Scan data root" para sincronizar con `Rest/Rest/`.

### 2. Session view (`/session/[id]`)
- Top bar: subject_id, session, status, breadcrumb del paso actual.
- Tabs (vertical sidebar): Load → Filter → Bad Channels → ICA → Interpolate → Reference → Epochs → Export.
- Main panel cambia según el paso. Cada paso es un componente independiente.
- Bottom: timeline de eventos con scroll horizontal. Click en un evento te lleva al estado en ese punto.
- Right panel: provenance log textual + métricas del estado actual.

### 3. Bad Channels view (la feature core)
- **Top half**: scroll temporal con uPlot. 32 canales visibles, scroll vertical para cambiar de tanda. Eje X tiempo, eje Y canales apilados.
  - Click en nombre del canal (eje Y) → toggle bad. Visual: gris cuando malo.
  - Hover → tooltip con nombre del canal y amplitud en ese punto.
  - Botón "Auto-detect" corre el detector de potencia + forma + vecinos en el backend y precarga marcas con badges de motivo.
- **Bottom left**: PSD del canal seleccionado (uPlot) superpuesto con mediana del grupo + banda 5-95%.
- **Bottom right**: topomap (D3) con todos los canales. Coloreado por la métrica de "desviación de forma" del PSD. Los marcados como malos tienen un anillo rojo. Click en electrodo → selecciona ese canal en el scroll.

### 4. ICA view
- Grid de N tarjetas, una por componente. Cada tarjeta muestra:
  - Topomap (D3, chico).
  - Serie temporal del IC (uPlot, mini).
  - Label de ICLabel + probabilidad.
  - Toggle excluir / mantener.
- Filtros rápidos: "mostrar solo no-brain", "mostrar solo dudosos (prob < 70%)".
- Botón "Apply" comitea los excluidos.

### 5. Compare view (`/compare/[subject]`)
- Split vertical: D1 izquierda, D2 derecha.
- Eje de tiempo y eje de frecuencia sincronizados (zoom y scroll comparten estado).
- Diff panel arriba: canales marcados solo en D1, solo en D2, en ambos.
- Toggle "highlight differences" que pinta en color las trazas que difieren.

### 6. Batch view (`/batch`)
- Lista de sesiones con su estado.
- Botón "Run all with defaults" → procesa secuencialmente con parámetros default.
- Pausa automática cuando una sesión tiene > 25% canales marcados (el caso "FC20_D2"). Te abre la sesión para revisión manual.
- Resumen al final tipo `preprocessing_summary.md`.

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `j` / `k` | Canal siguiente / anterior |
| `b` | Toggle bad sobre canal seleccionado |
| `[` / `]` | Sesión anterior / siguiente del workspace |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / redo |
| `Cmd+K` | Command palette |
| `Cmd+→` / `Cmd+←` | Tab siguiente / anterior del session view |
| `Space` | Play/pause auto-scroll |
| `?` | Overlay de atajos |
| `1`-`8` | Saltar a tab N |
| `g w` | Volver a workspace |
| `g c` | Compare view del sujeto actual |

## Performance budget

| Operación | Target |
|---|---|
| Carga inicial de .bdf 7min/128ch | < 2s hasta primer paint útil |
| Scroll temporal | 60fps con 128 canales × 10s visibles |
| Toggle bad channel | < 16ms (1 frame) |
| Recalcular PSD post-filtro | < 500ms |
| Aplicar filtro a raw completo | < 3s |
| Fit ICA | 30-60s (con progress real, no spinner ciego) |
| Cargar sesión guardada (con snapshot) | < 1s |
| Replay completo del log (sin snapshots) | < 10s |

Cada PR tiene que mostrar bench de la operación que tocó. Si rompe el budget, no merge.

## Fases

| Fase | Entregable | Definition of done |
|---|---|---|
| **F0** | Scaffolding | Monorepo creado, Next + FastAPI corren, "hello world" cross-origin con CORS, lint y format pasan, README con setup. |
| **F1** | Carga + viz pasiva | Subo .bdf, veo scroll temporal con 128 canales a 60fps + PSD inicial. Sin marcado todavía. Arrow streaming funciona. |
| **F2** | Modelo de datos | state.json con append-only log, snapshots, undo/redo funcional con una sola operación (mark_bad). Tests de replay determinístico. |
| **F3** | Marcado de canales malos | Vista completa: scroll interactivo + PSD comparada + topomap. Auto-detect con badges de motivo. Click toggle. Persistencia en state.json. |
| **F4** | Filtros | Bandpass + transition bands editables. Preview en vivo del PSD post-filtro antes de comitear. |
| **F5** | ICA | Fit ICA en backend con WebSocket de progreso. Render de componentes con topomap + serie. Click excluir. ICLabel automático. Apply. |
| **F6** | Interpolación + referencia | Botones simples. Validación de "no se puede aplicar referencia con bads pendientes". |
| **F7** | Épocas | Crear épocas de largo fijo. Matriz épocas × canales con peak-to-peak. Click excluir épocas. |
| **F8** | Export | Genera `_clean-epo.fif` + `log.json` completo del provenance. |
| **F9** | Compare D1/D2 | Vista split sincronizada. Diff de canales marcados. |
| **F10** | Batch | Procesar todos con defaults, pausa automática en sesiones problemáticas. |
| **F11** | Polish | Command palette, atajos de teclado, dark mode default, animaciones, empty states, onboarding tooltip primera vez. |

Cada fase termina con demo funcional y un commit que cierra esa fase.

## Testing

### Unit (backend, pytest)
- Cada función de `mne_engine` con fixture de archivo .bdf de prueba (uno chico que generamos sintético).
- Replay de event log: dado un log, validar que el `raw` reconstruido es bit-exact al esperado.
- Encode/decode Arrow round-trip.

### Integration (backend, pytest)
- POST evento → state.json se actualiza correctamente.
- Undo: state.json - último evento, snapshots posteriores invalidados.
- WebSocket de ICA emite progress events.

### E2E (frontend + backend, Playwright)
- Flujo completo: subir archivo → marcar canal → filtrar → ICA → exportar. Validar que el `.fif` exportado tiene los canales correctos.
- **Regresión contra notebook**: para 1-2 sujetos del TFG, procesar con eegwebpype con los mismos parámetros del notebook y validar que `_clean-epo.fif` resultante es equivalente (correlación > 0.99 canal a canal).

### Performance (Playwright traces)
- Scroll temporal: trace de 5 segundos, validar 60fps sostenidos.
- Toggle bad: validar < 16ms response time.

## Lo que NO hacemos en V1

- Auth, multi-usuario.
- Base de datos (Postgres/SQLite). Todo en JSON files.
- Source localization, beamforming.
- Cálculo de conectividad funcional (PLI, AECc, JPE) — eso es fase 3 del TFG, va en V2.
- MST y análisis de redes — V2.
- ICC y análisis test-retest estadístico — V2.
- Versionado tipo Git de pype.
- Cloud deployment.
- Soporte para EEG no-resting (eventos, épocas asociadas a tareas).

## Lo que SÍ hacemos en V1 aunque parezca over-engineered

- Apache Arrow para señales — JSON con 27M floats es lento, 2-3s overhead inútil por request.
- WebSocket para ICA — no podemos tener spinner ciego 30s.
- Compare D1/D2 desde el principio — es el diferenciador del proyecto.
- Provenance log completo — es lo que defendés en la memoria del TFG.
- Decimación adaptativa — sin esto el scroll a 7 min × 128 canales es inviable.

## Decisiones explícitas para evitar duda futura

- **No usar Recharts**: SVG no escala con 128 trazas. Decisión tomada.
- **No usar Plotly**: pesado, lento. Decisión tomada.
- **uPlot para todo lo temporal y PSD**: consistencia + performance. Decisión tomada.
- **D3 solo para topomaps y heatmaps**: SVG con interactividad y matemática 2D. Decisión tomada.
- **No hacer la web V0 con scroll Qt embebido**: si vamos a hacer una web, la hacemos web, no un wrapper de MNE. Decisión tomada.
- **Backend stateless por endpoint, estado vive en archivos**: simplifica deploy y debugging. Decisión tomada.
- **Snapshots .fif binarios, no JSON**: JSON con un raw filtrado es 500MB+. .fif es el formato de MNE y comprime bien. Decisión tomada.
- **TypeScript estricto, no `any`**: regla del repo. Schema generation desde Pydantic.

## Roadmap inmediato

1. Commitear este plan + scaffolding inicial.
2. F0: scaffolding completo (Next + FastAPI + CORS + dummy endpoints).
3. F1: carga de .bdf y scroll temporal funcional.

Cada fase cierra con un commit `feat(fX): <feature>` y una demo grabable.
