"use client";

import { BadChannelsPanel } from "@/components/BadChannelsPanel";
import { CleanupPanel } from "@/components/CleanupPanel";
import { EpochsPanel } from "@/components/EpochsPanel";
import { EventTimeline } from "@/components/EventTimeline";
import { ExportPanel } from "@/components/ExportPanel";
import { FilterPanel } from "@/components/FilterPanel";
import { ICAPanel } from "@/components/ICAPanel";
import { SetupBanner } from "@/components/SetupBanner";
import { Skeleton } from "@/components/Skeleton";
import { PSDPlot } from "@/components/viz/PSDPlot";
import { ScrollPlot } from "@/components/viz/ScrollPlot";
import { api } from "@/lib/api/client";
import { useSession, useUndo, useUndoShortcut } from "@/lib/hooks/useEventLog";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useState } from "react";

type ParamsP = Promise<{ id: string }>;

const TABS = ["overview", "bad-channels", "filter", "ica", "cleanup", "epochs", "export"] as const;
type Tab = (typeof TABS)[number];

export default function SessionPage({ params }: { params: ParamsP }) {
  const { id } = use(params);
  const session = useSession(id);
  const undo = useUndo(id);
  useUndoShortcut(() => undo.mutate());

  const [tab, setTab] = useState<Tab>("overview");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  // Tab navigation with [ and ].
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isInput) return;
      if (e.key === "[") {
        e.preventDefault();
        const idx = TABS.indexOf(tab);
        const next = TABS[(idx - 1 + TABS.length) % TABS.length];
        if (next) setTab(next);
      } else if (e.key === "]") {
        e.preventDefault();
        const idx = TABS.indexOf(tab);
        const next = TABS[(idx + 1) % TABS.length];
        if (next) setTab(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

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
              {session.data.metadata.n_channels_current} channels ·{" "}
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

      <SetupBanner sessionId={id} />

      <EventTimeline events={events} canUndo={canUndo} onUndo={() => undo.mutate()} />

      {tab === "overview" && (
        <>
          <section>
            <h2 className="mb-2 text-sm uppercase tracking-wider text-zinc-500">
              time scroll · first 10s
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
                <Skeleton height={400} label={signal.isFetching ? "loading signal…" : "—"} />
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
                <Skeleton height={280} label={psd.isFetching ? "loading PSD…" : "—"} />
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

      {tab === "cleanup" && <CleanupPanel sessionId={id} state={session.data} />}

      {tab === "epochs" && <EpochsPanel sessionId={id} />}

      {tab === "export" && <ExportPanel sessionId={id} state={session.data} />}
    </main>
  );
}
