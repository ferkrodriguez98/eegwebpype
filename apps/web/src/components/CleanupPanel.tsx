"use client";

import { useAppendEvent } from "@/lib/hooks/useEventLog";
import type { SessionState } from "@eegwebpype/shared";
import { Anchor, Wand2 } from "lucide-react";
import { useMemo } from "react";

function badsFromState(state: SessionState | undefined): string[] {
  if (!state) return [];
  const bads = new Set<string>();
  for (const ev of state.events) {
    if (ev.op === "mark_bad") for (const c of ev.params.channels) bads.add(c);
    else if (ev.op === "unmark_bad") for (const c of ev.params.channels) bads.delete(c);
    else if (ev.op === "interpolate_bads") bads.clear();
  }
  return Array.from(bads);
}

function alreadyApplied(state: SessionState | undefined, op: string): boolean {
  if (!state) return false;
  return state.events.some((ev) => ev.op === op);
}

export function CleanupPanel({
  sessionId,
  state,
}: {
  sessionId: string;
  state: SessionState | undefined;
}) {
  const append = useAppendEvent(sessionId);
  const pending = useMemo(() => badsFromState(state), [state]);
  const refDone = alreadyApplied(state, "set_reference");

  const onInterpolate = () => {
    append.mutate({ op: "interpolate_bads", params: {} });
  };
  const onReference = () => {
    append.mutate({ op: "set_reference", params: { type: "average" } });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Wand2 size={16} className="text-zinc-400" />
          <h3 className="text-sm uppercase tracking-wider text-zinc-300">interpolación esférica</h3>
        </div>
        <p className="mb-3 text-xs text-zinc-500">
          interpola los canales marcados como malos a partir de sus vecinos. requiere montage
          configurado.
        </p>
        <div className="mb-3 text-xs text-zinc-400">
          {pending.length > 0 ? (
            <>
              {pending.length} canales pendientes:{" "}
              <span className="font-mono text-red-300">{pending.join(", ")}</span>
            </>
          ) : (
            <span className="text-zinc-600">no hay canales malos pendientes</span>
          )}
        </div>
        <button
          type="button"
          onClick={onInterpolate}
          disabled={pending.length === 0 || append.isPending}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          <Wand2 size={14} />
          interpolar {pending.length > 0 ? `(${pending.length})` : ""}
        </button>
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Anchor size={16} className="text-zinc-400" />
          <h3 className="text-sm uppercase tracking-wider text-zinc-300">referencia promedio</h3>
        </div>
        <p className="mb-3 text-xs text-zinc-500">
          re-referencia común (CAR): suma cero a través de canales por timepoint. estándar EEG-Pype.
        </p>
        {pending.length > 0 && !refDone && (
          <p className="mb-2 text-xs text-amber-400">
            recomendado: interpolar primero los canales malos para no contaminar la referencia.
          </p>
        )}
        <button
          type="button"
          onClick={onReference}
          disabled={refDone || append.isPending}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          <Anchor size={14} />
          {refDone ? "ya aplicada" : "aplicar referencia promedio"}
        </button>
      </section>
    </div>
  );
}
