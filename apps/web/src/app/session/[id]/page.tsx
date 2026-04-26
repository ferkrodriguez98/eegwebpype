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
import { Select } from "@/components/ui/Select";
import { PSDPlot } from "@/components/viz/PSDPlot";
import { ScrollPlot } from "@/components/viz/ScrollPlot";
import { api } from "@/lib/api/client";
import { useAppendEvent, useSession, useUndo, useUndoShortcut } from "@/lib/hooks/useEventLog";
import type { SessionState } from "@eegwebpype/shared";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

function badsFromState(state: SessionState | undefined): Set<string> {
  const bads = new Set<string>();
  if (!state) return bads;
  for (const ev of state.events) {
    if (ev.op === "mark_bad") for (const c of ev.params.channels) bads.add(c);
    else if (ev.op === "unmark_bad") for (const c of ev.params.channels) bads.delete(c);
    else if (ev.op === "interpolate_bads") bads.clear();
  }
  return bads;
}

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
  const [windowStart, setWindowStart] = useState<number>(0);
  const [windowLength, setWindowLength] = useState<number>(10);

  const append = useAppendEvent(id);
  const bads = useMemo(() => badsFromState(session.data), [session.data]);

  const onToggleBad = (channel: string) => {
    if (bads.has(channel)) {
      append.mutate({ op: "unmark_bad", params: { channels: [channel] } });
    } else {
      append.mutate({
        op: "mark_bad",
        params: { channels: [channel], reason: "manual" },
      });
    }
  };

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

  const duration = session.data?.metadata.duration_seconds ?? 0;
  // Clamp the requested window so we never request beyond the recording.
  const effectiveLength = duration > 0 ? Math.min(windowLength, duration) : windowLength;
  const maxStart = Math.max(0, duration - effectiveLength);
  const tStart = Math.max(0, Math.min(windowStart, maxStart));
  const tEnd = Math.min(
    duration > 0 ? duration : tStart + effectiveLength,
    tStart + effectiveLength,
  );

  const signal = useQuery({
    queryKey: ["signal", id, tStart, tEnd],
    queryFn: () => api.signal(id, { tStart, tEnd }),
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
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm uppercase tracking-wider text-zinc-500">
                time scroll · {tStart.toFixed(1)}–{tEnd.toFixed(1)}s
              </h2>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <button
                  type="button"
                  onClick={() => setWindowStart((s) => Math.max(0, s - windowLength))}
                  disabled={windowStart === 0}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
                >
                  ←
                </button>
                <input
                  type="range"
                  min={0}
                  max={maxStart}
                  step={Math.max(0.1, windowLength / 4)}
                  value={Math.min(windowStart, maxStart)}
                  onChange={(e) => setWindowStart(Number.parseFloat(e.target.value))}
                  disabled={duration === 0}
                  className="w-48 accent-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setWindowStart((s) => Math.min(maxStart, s + windowLength))}
                  disabled={windowStart >= maxStart}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
                >
                  →
                </button>
                <span className="ml-2 text-zinc-500">window</span>
                <Select
                  ariaLabel="Window length"
                  value={windowLength}
                  onChange={setWindowLength}
                  options={[
                    { value: 5, label: "5s" },
                    { value: 10, label: "10s" },
                    { value: 20, label: "20s" },
                    { value: 60, label: "1m" },
                    { value: 120, label: "2m" },
                    { value: 300, label: "5m" },
                    { value: Math.max(5, Math.ceil(duration)), label: "full" },
                  ]}
                />
              </div>
            </div>
            <p className="mb-2 text-[10px] text-zinc-600">
              click a channel name on the left to toggle bad · hover to inspect a channel · wheel
              over the plot to pan in time · ⌘+wheel to zoom
            </p>
            <div className="relative rounded border border-zinc-800 bg-zinc-950 p-2">
              {signal.data ? (
                <ScrollPlot
                  times={signal.data.times ?? new Float32Array()}
                  channels={Object.entries(signal.data)
                    .filter(([k]) => k !== "times")
                    .slice(0, 32)
                    .map(([name, data]) => ({ name, data }))}
                  badChannels={bads}
                  onToggleBad={onToggleBad}
                  onPan={(delta) =>
                    setWindowStart((s) => Math.max(0, Math.min(maxStart, s + delta)))
                  }
                />
              ) : (
                <Skeleton height={400} label={signal.isFetching ? "loading signal…" : "—"} />
              )}
              {signal.data && signal.isFetching && (
                <div className="pointer-events-none absolute right-3 top-3 rounded bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-400 backdrop-blur">
                  refreshing…
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm uppercase tracking-wider text-zinc-500">PSD · 1–47 Hz</h2>
            <div className="relative rounded border border-zinc-800 bg-zinc-950 p-2">
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
              {psd.data && psd.isFetching && (
                <div className="pointer-events-none absolute right-3 top-3 rounded bg-zinc-900/90 px-2 py-0.5 text-[10px] text-zinc-400 backdrop-blur">
                  refreshing…
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

      {tab === "cleanup" && <CleanupPanel sessionId={id} state={session.data} />}

      {tab === "epochs" && <EpochsPanel sessionId={id} />}

      {tab === "export" && <ExportPanel sessionId={id} state={session.data} />}
    </main>
  );
}
