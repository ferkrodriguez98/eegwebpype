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
  detectBadChannels: (id: string) =>
    post<DetectBadResult>(`/api/sessions/${id}/detect-bad-channels`),
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
    return new Promise((resolve, reject) => {
      const wsUrl = `${API_URL.replace(/^http/, "ws")}/ws/sessions/${id}/ica`;
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ n_components: n, method: "extended_infomax", random_state: 42 }));
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { phase?: string; error?: string; fraction?: number };
          if (data.error) {
            ws.close();
            reject(new Error(data.error));
            return;
          }
          if (data.phase) onProgress({ phase: data.phase, fraction: data.fraction });
          if (data.phase === "ready") {
            ws.close();
            resolve();
          }
        } catch (e) {
          reject(e instanceof Error ? e : new Error("ws parse error"));
        }
      };
      ws.onerror = () => reject(new Error("websocket error"));
    });
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
