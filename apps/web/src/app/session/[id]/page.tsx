"use client";

import { EventTimeline } from "@/components/EventTimeline";
import { PSDPlot } from "@/components/viz/PSDPlot";
import { ScrollPlot } from "@/components/viz/ScrollPlot";
import { api } from "@/lib/api/client";
import { useAppendEvent, useSession, useUndo, useUndoShortcut } from "@/lib/hooks/useEventLog";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";

type ParamsP = Promise<{ id: string }>;

export default function SessionPage({ params }: { params: ParamsP }) {
  const { id } = use(params);

  const session = useSession(id);
  const append = useAppendEvent(id);
  const undo = useUndo(id);
  useUndoShortcut(() => undo.mutate());

  const [bad, setBad] = useState<string>("");

  const signal = useQuery({
    queryKey: ["signal", id, 0, 10],
    queryFn: () => api.signal(id, { tStart: 0, tEnd: 10 }),
    enabled: !!session.data,
  });

  const psd = useQuery({
    queryKey: ["psd", id],
    queryFn: () => api.psd(id, { fmin: 1, fmax: 47 }),
    enabled: !!session.data,
  });

  const events = session.data?.events ?? [];
  const canUndo = events.length > 1;

  const onMarkBad = () => {
    const ch = bad.trim();
    if (!ch) return;
    append.mutate({ op: "mark_bad", params: { channels: [ch], reason: "manual" } });
    setBad("");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← workspace
          </Link>
          <h1 className="font-mono text-xl">{id}</h1>
          {session.data && (
            <p className="text-xs text-zinc-500">
              {session.data.metadata.n_channels_current} canales ·{" "}
              {session.data.metadata.sfreq_current} Hz ·{" "}
              {session.data.metadata.duration_seconds.toFixed(1)} s
            </p>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onMarkBad();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={bad}
            onChange={(e) => setBad(e.target.value)}
            placeholder="canal (ej. A1)"
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
          />
          <button
            type="submit"
            disabled={append.isPending || !bad.trim()}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            mark bad
          </button>
        </form>
      </header>

      {session.isError && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          error: {String(session.error)}
        </div>
      )}

      <EventTimeline events={events} canUndo={canUndo} onUndo={() => undo.mutate()} />

      <section>
        <h2 className="mb-2 text-sm uppercase tracking-wider text-zinc-500">
          scroll temporal · primeros 10s
        </h2>
        <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
          {signal.data ? (
            <ScrollPlot
              times={signal.data.times ?? new Float32Array()}
              channels={Object.entries(signal.data)
                .filter(([k]) => k !== "times")
                .slice(0, 32)
                .map(([name, data]) => ({ name, data }))}
            />
          ) : (
            <div className="grid h-[400px] place-items-center text-sm text-zinc-600">
              {signal.isFetching ? "cargando…" : "—"}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm uppercase tracking-wider text-zinc-500">PSD · 1–47 Hz</h2>
        <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
          {psd.data ? (
            <PSDPlot
              freqs={psd.data.freqs ?? new Float32Array()}
              channels={Object.entries(psd.data)
                .filter(([k]) => k !== "freqs")
                .map(([name, data]) => ({ name, data }))}
            />
          ) : (
            <div className="grid h-[280px] place-items-center text-sm text-zinc-600">
              {psd.isFetching ? "cargando…" : "—"}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
