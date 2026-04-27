import type {
  BatchRecipe,
  BatchRunResult,
  CompareResponse,
  DetectBadResult,
  EpochsMatrix,
  EventInput,
  ExportResult,
  ICAFitResult,
  SessionState,
  SetupSuggestions,
  TopomapMetric,
  TopomapResponse,
  Workspace,
} from "@eegwebpype/shared";
import { tableFromIPC } from "apache-arrow";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return (await r.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return (await r.json()) as T;
}

async function getArrow(path: string): Promise<DecodedArrow> {
  const r = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  const buf = await r.arrayBuffer();
  const table = tableFromIPC(new Uint8Array(buf));
  const columns: Record<string, Float32Array> = {};
  for (const name of table.schema.names as string[]) {
    const col = table.getChild(name);
    if (!col) continue;
    columns[name] = col.toArray() as Float32Array;
  }
  return columns;
}

export type DecodedArrow = Record<string, Float32Array>;

export const api = {
  health: () => get<{ ok: boolean; service: string; version: string }>("/health"),
  workspace: () => get<Workspace>("/api/workspace"),
  scanWorkspace: () => post<Workspace>("/api/workspace/scan"),
  session: (id: string) => get<SessionState>(`/api/sessions/${id}`),
  resetSession: (id: string) => post<SessionState>(`/api/sessions/${id}/reset`),
  signal: (id: string, params: { tStart: number; tEnd: number; targetPoints?: number }) => {
    const q = new URLSearchParams({
      t_start: String(params.tStart),
      t_end: String(params.tEnd),
      decimate: "auto",
      target_points: String(params.targetPoints ?? 4000),
    });
    return getArrow(`/api/sessions/${id}/signal?${q}`);
  },
  psd: (id: string, params: { fmin?: number; fmax?: number } = {}) => {
    const q = new URLSearchParams({
      fmin: String(params.fmin ?? 0.5),
      fmax: String(params.fmax ?? 47.0),
    });
    return getArrow(`/api/sessions/${id}/psd?${q}`);
  },
  appendEvent: (id: string, payload: EventInput) =>
    post<SessionState>(`/api/sessions/${id}/events`, payload),
  undoLast: (id: string) =>
    fetch(`${API_URL}/api/sessions/${id}/events/last`, {
      method: "DELETE",
      cache: "no-store",
    }).then(async (r) => {
      if (!r.ok) throw new Error(`DELETE /events/last → ${r.status}`);
      return (await r.json()) as SessionState;
    }),
  psdWithFilter: (
    id: string,
    params: {
      l_freq?: number | null;
      h_freq?: number | null;
      l_trans?: number | null;
      h_trans?: number | null;
      fmin?: number;
      fmax?: number;
    },
  ) => {
    const q = new URLSearchParams();
    if (params.l_freq !== null && params.l_freq !== undefined)
      q.set("l_freq", String(params.l_freq));
    if (params.h_freq !== null && params.h_freq !== undefined)
      q.set("h_freq", String(params.h_freq));
    if (params.l_trans !== null && params.l_trans !== undefined)
      q.set("l_trans", String(params.l_trans));
    if (params.h_trans !== null && params.h_trans !== undefined)
      q.set("h_trans", String(params.h_trans));
    if (params.fmin !== undefined) q.set("fmin", String(params.fmin));
    if (params.fmax !== undefined) q.set("fmax", String(params.fmax));
    return getArrow(`/api/sessions/${id}/psd-with-filter?${q}`);
  },
  detectBadChannels: (
    id: string,
    params?: { mad_k?: number; pot_z_extreme?: number; neighbor_corr_thr?: number },
  ) => {
    const q = new URLSearchParams();
    if (params?.mad_k !== undefined) q.set("mad_k", String(params.mad_k));
    if (params?.pot_z_extreme !== undefined) q.set("pot_z_extreme", String(params.pot_z_extreme));
    if (params?.neighbor_corr_thr !== undefined)
      q.set("neighbor_corr_thr", String(params.neighbor_corr_thr));
    const qs = q.toString();
    return post<DetectBadResult>(`/api/sessions/${id}/detect-bad-channels${qs ? `?${qs}` : ""}`);
  },
  topomap: (id: string, metric: TopomapMetric) =>
    get<TopomapResponse>(`/api/sessions/${id}/topomap?metric=${metric}`),
  epochs: (id: string, length: number) =>
    get<EpochsMatrix>(`/api/sessions/${id}/epochs?length=${length}`),
  exportSession: (id: string) => post<ExportResult>(`/api/sessions/${id}/export`),
  compare: (subject: string) => get<CompareResponse>(`/api/compare/${subject}`),
  runBatch: (session_ids: string[], recipe: BatchRecipe) =>
    post<BatchRunResult>("/api/batch/run", { session_ids, recipe }),
  setupSuggestions: (id: string) => get<SetupSuggestions>(`/api/sessions/${id}/setup`),
  icaComponents: (id: string) => get<ICAFitResult>(`/api/sessions/${id}/ica/components`),
  fitIcaWS: (
    id: string,
    n: number,
    onProgress: (e: { phase: string; fraction?: number }) => void,
  ): Promise<void> => {
    // Dedupe concurrent fits per-session. Without this, React StrictMode
    // (and HMR re-runs) trigger two parallel WebSockets — the second
    // gets rejected by the backend with 400 because a fit is in flight,
    // surfacing a confusing error to the user.
    const inflightKey = `__fit_ica_${id}`;
    const g = globalThis as unknown as Record<string, Promise<void> | undefined>;
    if (g[inflightKey]) return g[inflightKey];

    const wsUrl = `${API_URL.replace(/^http/, "ws")}/ws/sessions/${id}/ica`;
    const params = JSON.stringify({
      n_components: n,
      method: "extended_infomax",
      random_state: 42,
    });

    const promise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      // Buffer the params and only send on `open`. Sending before open
      // throws InvalidStateError; sending after a stale onopen event is
      // also possible if React HMR replaces the handler.
      ws.addEventListener("open", () => {
        try {
          ws.send(params);
        } catch (err) {
          settle(() => reject(err instanceof Error ? err : new Error("failed to send ICA params")));
        }
      });

      ws.addEventListener("message", (ev) => {
        try {
          const data = JSON.parse(ev.data) as {
            phase?: string;
            error?: string;
            fraction?: number;
          };
          if (data.error) {
            settle(() => reject(new Error(data.error ?? "ica error")));
            ws.close(1000, "client received error");
            return;
          }
          if (data.phase) onProgress({ phase: data.phase, fraction: data.fraction });
          // Resolve on either of the terminal phases. The backend
          // emits `done` from the service layer (real completion),
          // then the WS handler emits `ready` as the final
          // handshake message — but if either gets dropped, we
          // still want the client to settle and React Query to
          // mark the mutation as successful.
          if (data.phase === "ready" || data.phase === "done") {
            settle(() => resolve());
            ws.close(1000, "client received terminal phase");
          }
        } catch (e) {
          settle(() => reject(e instanceof Error ? e : new Error("ws parse error")));
        }
      });

      ws.addEventListener("error", () => {
        // No detail available; rely on the close event.
      });

      ws.addEventListener("close", (ev) => {
        if (ev.code === 1000) {
          settle(() => resolve());
          return;
        }
        const reason =
          ev.reason ||
          (ev.code === 1006
            ? "connection dropped before fit completed"
            : `closed with code ${ev.code}`);
        settle(() => reject(new Error(`ICA websocket: ${reason}`)));
      });
    });

    g[inflightKey] = promise;
    void promise.finally(() => {
      g[inflightKey] = undefined;
    });
    return promise;
  },
  externalRoots: () => get<{ external_roots: string[] }>("/api/config/external-roots"),
  setExternalRoots: (roots: string[]) =>
    fetch(`${API_URL}/api/config/external-roots`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_roots: roots }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`PUT /external-roots → ${r.status}`);
      return (await r.json()) as { external_roots: string[] };
    }),
};
