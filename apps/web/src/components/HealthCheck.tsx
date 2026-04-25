"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; service: string; version: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function HealthCheck() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; data: Health } | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Health;
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "ok", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : "unknown error";
          setState({ kind: "error", message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 font-mono text-sm">
      {state.kind === "loading" && <span className="text-zinc-500">checking api…</span>}
      {state.kind === "ok" && (
        <span className="text-emerald-400">
          api ok — {state.data.service} v{state.data.version}
        </span>
      )}
      {state.kind === "error" && (
        <span className="text-red-400">api unreachable: {state.message}</span>
      )}
    </div>
  );
}
