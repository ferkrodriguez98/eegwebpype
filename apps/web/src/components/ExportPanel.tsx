"use client";

import { api } from "@/lib/api/client";
import type { SessionState } from "@eegwebpype/shared";
import { useMutation } from "@tanstack/react-query";
import { Download, FileCheck, FileText } from "lucide-react";

function hasEpochEvent(state: SessionState | undefined): boolean {
  if (!state) return false;
  return state.events.some((ev) => ev.op === "epoch");
}

export function ExportPanel({
  sessionId,
  state,
}: {
  sessionId: string;
  state: SessionState | undefined;
}) {
  const ready = hasEpochEvent(state);

  const exp = useMutation({
    mutationFn: () => api.exportSession(sessionId),
  });

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Download size={16} className="text-zinc-400" />
          <h3 className="text-sm uppercase tracking-wider text-zinc-300">export</h3>
        </div>
        <p className="mb-3 text-xs text-zinc-500">
          materializa <code className="rounded bg-zinc-900 px-1 font-mono">clean-epo.fif</code> +{" "}
          <code className="rounded bg-zinc-900 px-1 font-mono">log.json</code> con todo el
          provenance del estado actual. requiere haber comiteado un evento <code>epoch</code>.
        </p>

        {!ready && (
          <p className="mb-2 text-xs text-amber-400">
            primero creá épocas en la pestaña <span className="font-mono">epochs</span> y tocá
            commit.
          </p>
        )}

        <button
          type="button"
          onClick={() => exp.mutate()}
          disabled={!ready || exp.isPending}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          <Download size={14} />
          {exp.isPending ? "exportando…" : "export clean-epo.fif"}
        </button>

        {exp.error && <p className="mt-2 text-xs text-red-400">{String(exp.error)}</p>}

        {exp.data && (
          <div className="mt-4 flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-300">
              <FileCheck size={14} />
              <span>
                listo: {exp.data.n_epochs} épocas × {exp.data.n_channels} canales
              </span>
            </div>
            <div className="flex items-start gap-2 text-zinc-500">
              <FileCheck size={14} className="mt-0.5 shrink-0" />
              <code className="break-all rounded bg-zinc-900 px-1.5 py-0.5 font-mono">
                {exp.data.fif_path}
              </code>
            </div>
            <div className="flex items-start gap-2 text-zinc-500">
              <FileText size={14} className="mt-0.5 shrink-0" />
              <code className="break-all rounded bg-zinc-900 px-1.5 py-0.5 font-mono">
                {exp.data.log_path}
              </code>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
