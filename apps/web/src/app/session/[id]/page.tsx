"use client";

import { BadChannelsPanel } from "@/components/BadChannelsPanel";
import { EventTimeline } from "@/components/EventTimeline";
import { FilterPanel } from "@/components/FilterPanel";
import { ICAPanel } from "@/components/ICAPanel";
import { PSDPlot } from "@/components/viz/PSDPlot";
import { ScrollPlot } from "@/components/viz/ScrollPlot";
import { api } from "@/lib/api/client";
import { useSession, useUndo, useUndoShortcut } from "@/lib/hooks/useEventLog";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";

type ParamsP = Promise<{ id: string }>;

const TABS = ["overview", "bad-channels", "filter", "ica"] as const;
type Tab = (typeof TABS)[number];

export default function SessionPage({ params }: { params: ParamsP }) {
  const { id } = use(params);
  const session = useSession(id);
  const undo = useUndo(id);
  useUndoShortcut(() => undo.mutate());

  const [tab, setTab] = useState<Tab>("overview");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

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

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6">
      <header>
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← workspace
        </Link>
        <div className="flex items-baseline justify-between">
          <h1 className="font-mono text-xl">{id}</h1>
          {session.data && (
            <p className="text-xs text-zinc-500">
              {session.data.metadata.n_channels_current} canales ·{" "}
              {session.data.metadata.sfreq_current} Hz ·{" "}
              {session.data.metadata.duration_seconds.toFixed(1)} s
            </p>
          )}
        </div>
        <nav className="mt-3 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-t border-b-2 px-3 py-1 text-xs ${
                tab === t
                  ? "border-emerald-400 text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <EventTimeline events={events} canUndo={canUndo} onUndo={() => undo.mutate()} />

      {tab === "overview" && (
        <>
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
        </>
      )}

      {tab === "bad-channels" && (
        <BadChannelsPanel
          sessionId={id}
          state={session.data}
          selected={selectedChannel}
          onSelect={setSelectedChannel}
        />
      )}

      {tab === "filter" && <FilterPanel sessionId={id} />}

      {tab === "ica" && <ICAPanel sessionId={id} />}
    </main>
  );
}
