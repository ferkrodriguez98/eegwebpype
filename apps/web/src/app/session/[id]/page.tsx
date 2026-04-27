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
import { GlobalBusyOverlay } from "@/components/ui/GlobalBusyOverlay";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { Select } from "@/components/ui/Select";
import { SlideIn } from "@/components/ui/SlideIn";
import { PSDPlot } from "@/components/viz/PSDPlot";
import { ScrollPlot } from "@/components/viz/ScrollPlot";
import { api } from "@/lib/api/client";
import {
  useAppendEvent,
  useResetSession,
  useSession,
  useUndo,
  useUndoShortcut,
} from "@/lib/hooks/useEventLog";
import type { SessionState } from "@eegwebpype/shared";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Download,
  Eye,
  Filter,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Scissors,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

const TABS = [
  { id: "overview", label: "overview", Icon: Eye },
  { id: "bad-channels", label: "bad channels", Icon: Activity },
  { id: "filter", label: "filter", Icon: Filter },
  { id: "ica", label: "ICA", Icon: Sparkles },
  { id: "cleanup", label: "cleanup", Icon: Scissors },
  { id: "epochs", label: "epochs", Icon: Layers },
  { id: "export", label: "export", Icon: Download },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function SessionPage({ params }: { params: ParamsP }) {
  const { id } = use(params);
  const session = useSession(id);
  const undo = useUndo(id);
  const reset = useResetSession(id);
  useUndoShortcut(() => undo.mutate());

  const [tab, setTab] = useState<Tab>("overview");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<number>(0);
  const [windowLength, setWindowLength] = useState<number>(10);
  const [eventLogCollapsed, setEventLogCollapsed] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [channelPage, setChannelPage] = useState<number>(0);
  // Direction of the most recent channel-page change. Drives the slide-in
  // animation on the ScrollPlot wrapper. `null` = no animation pending.
  const [pageDir, setPageDir] = useState<"up" | "down" | null>(null);
  const lastPageRef = useRef<number>(0);
  const [channelsPerPage, setChannelsPerPage] = useState<number>(32);
  // User-resizable plot height. Default 600px; clamped to a sensible range
  // so the plot can never become unusable.
  const [signalPlotHeight, setSignalPlotHeight] = useState<number>(600);
  const signalBoxRef = useRef<HTMLDivElement>(null);
  const psdBoxRef = useRef<HTMLDivElement>(null);
  const [psdMinH, setPsdMinH] = useState<number>(0);

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
      const ids = TABS.map((t) => t.id);
      if (e.key === "[") {
        e.preventDefault();
        const idx = ids.indexOf(tab);
        const next = ids[(idx - 1 + ids.length) % ids.length];
        if (next) setTab(next);
      } else if (e.key === "]") {
        e.preventDefault();
        const idx = ids.indexOf(tab);
        const next = ids[(idx + 1) % ids.length];
        if (next) setTab(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const duration = session.data?.metadata.duration_seconds ?? 0;
  const effectiveLength = duration > 0 ? Math.min(windowLength, duration) : windowLength;
  const maxStart = Math.max(0, duration - effectiveLength);
  const tStart = Math.max(0, Math.min(windowStart, maxStart));
  const tEnd = Math.min(
    duration > 0 ? duration : tStart + effectiveLength,
    tStart + effectiveLength,
  );

  // One fetch per session: bring the entire recording at min/max-bucketed
  // resolution. ~8000 buckets per channel is enough envelope detail for any
  // realistic monitor width. Pan/zoom slice this in-memory; no refetch.
  const signal = useQuery({
    queryKey: ["signal-overview", id],
    queryFn: () =>
      api.signal(id, {
        tStart: 0,
        tEnd: duration > 0 ? duration : 1,
        targetPoints: 8000,
      }),
    enabled: !!session.data && duration > 0,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Slice the cached overview to whatever the user is currently looking at.
  // Both `times` and each channel array share the same length, so we find
  // the first/last sample inside [tStart, tEnd] with binary search and
  // subarray everything to that range.
  const visibleSignal = useMemo(() => {
    if (!signal.data) return undefined;
    const times = signal.data.times;
    if (!times || times.length === 0) return signal.data;
    // Binary search for [tStart, tEnd] bounds.
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((times[mid] ?? 0) < tStart) lo = mid + 1;
      else hi = mid;
    }
    const startIdx = lo;
    lo = startIdx;
    hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((times[mid] ?? 0) <= tEnd) lo = mid + 1;
      else hi = mid;
    }
    const endIdx = lo;
    if (endIdx <= startIdx) return signal.data;
    const out: Record<string, Float32Array> = {};
    for (const k of Object.keys(signal.data)) {
      const arr = signal.data[k];
      if (arr) out[k] = arr.subarray(startIdx, endIdx);
    }
    return out;
  }, [signal.data, tStart, tEnd]);

  const psd = useQuery({
    queryKey: ["psd", id],
    queryFn: () => api.psd(id, { fmin: 1, fmax: 47 }),
    enabled: !!session.data,
  });

  const events = session.data?.events ?? [];
  const canUndo = events.length > 1;

  // All channel names from the cached overview, in the server-provided order.
  const allChannelNames = useMemo(() => {
    if (!signal.data) return [] as string[];
    return Object.keys(signal.data).filter((k) => k !== "times");
  }, [signal.data]);
  const totalChannels = allChannelNames.length;
  const totalPages = Math.max(1, Math.ceil(totalChannels / channelsPerPage));
  const safePage = Math.min(channelPage, totalPages - 1);
  const pageStart = safePage * channelsPerPage;
  const pageEnd = Math.min(totalChannels, pageStart + channelsPerPage);

  // PSD container is still locked to its first measured height (no resize
  // handle on the PSD plot for now — only the time scroll has one).
  const psdChannelCount = psd.data ? Object.keys(psd.data).filter((k) => k !== "freqs").length : 0;

  // When the user pages through channels, mark the direction so the
  // ScrollPlot wrapper can slide-in from the correct side. The animation
  // unwinds itself in the next frame, so we don't need a setTimeout.
  useEffect(() => {
    const prev = lastPageRef.current;
    if (prev !== safePage) {
      setPageDir(safePage > prev ? "down" : "up");
      lastPageRef.current = safePage;
      // Clear the direction after the transition finishes so the wrapper
      // returns to its neutral state and a future page change re-arms it.
      const t = setTimeout(() => setPageDir(null), 220);
      return () => clearTimeout(t);
    }
  }, [safePage]);

  useLayoutEffect(() => {
    if (psd.data && psdBoxRef.current) {
      const h = psdBoxRef.current.getBoundingClientRect().height;
      if (h > 0) setPsdMinH(h);
    }
  }, [psd.data, psdChannelCount]);

  return (
    <main
      className="grid h-screen grid-rows-[auto_1fr] overflow-hidden transition-[grid-template-columns] duration-300 ease-in-out"
      style={{
        gridTemplateColumns: `${sidebarCollapsed ? 48 : 260}px 1fr`,
      }}
    >
      <header className="col-span-2 grid grid-cols-3 items-center border-b border-zinc-800 px-6 py-3">
        <Link href="/" className="justify-self-start text-xs text-zinc-500 hover:text-zinc-300">
          ← workspace
        </Link>
        <h1 className="justify-self-center font-mono text-base">{id}</h1>
        {session.data ? (
          <p className="justify-self-end text-xs text-zinc-500">
            {session.data.metadata.n_channels_current} channels ·{" "}
            {session.data.metadata.sfreq_current} Hz ·{" "}
            {session.data.metadata.duration_seconds.toFixed(1)} s
          </p>
        ) : (
          <span />
        )}
      </header>

      <aside className="flex flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950">
        {/* Sidebar collapse toggle. Lives at the very top so it's always
         * reachable, regardless of which tab is active or how big the
         * event log got. */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          className="flex items-center gap-2 border-b border-zinc-800 px-2.5 py-2 text-[11px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          title={sidebarCollapsed ? "expand sidebar" : "collapse sidebar"}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          {!sidebarCollapsed && <span>collapse</span>}
        </button>
        <nav className="flex flex-col gap-0.5 border-b border-zinc-800 p-2">
          {TABS.map(({ id: tid, label, Icon }) => (
            <button
              key={tid}
              type="button"
              onClick={() => setTab(tid)}
              title={sidebarCollapsed ? label : undefined}
              className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs ${
                sidebarCollapsed ? "justify-center px-1.5" : ""
              } ${
                tab === tid
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
              }`}
            >
              <Icon size={14} className="shrink-0" />
              {!sidebarCollapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>
        {/* Setup banner and event log are hidden in collapsed mode — they
         * need horizontal space to be useful. */}
        {!sidebarCollapsed && (
          <>
            <SetupBanner sessionId={id} />
            {/* Event log wrapper. Always mt-auto so it sits at the bottom
             * of the sidebar; toggling between expanded and collapsed
             * just animates its height (flex-grow + basis). The mt-auto
             * is permanent so the anchor doesn't pop between states —
             * the slide-up/down feels symmetric. */}
            <div
              className={`mt-auto flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${
                eventLogCollapsed ? "flex-grow-0 basis-[37px]" : "flex-grow basis-0"
              }`}
            >
              <EventTimeline
                events={events}
                canUndo={canUndo}
                onUndo={() => undo.mutate()}
                canReset={events.length > 0 && !reset.isPending}
                onReset={() => reset.mutate()}
                collapsed={eventLogCollapsed}
                onToggleCollapsed={() => setEventLogCollapsed((c) => !c)}
              />
            </div>
          </>
        )}
      </aside>

      <div className="flex flex-col gap-6 overflow-y-auto p-6">
        {tab === "overview" && (
          <>
            <section>
              {/* Header bar: title on the left, layout selectors on the
               * right. Primary time-navigation controls (← slider →) are
               * not here — they live as an overlay anchored to the top
               * center of the plot box itself, mirroring the channel pager
               * which sits centered on the right edge. */}
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm uppercase tracking-wider text-zinc-500">
                  time scroll · {tStart.toFixed(1)}–{tEnd.toFixed(1)}s
                </h2>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="text-zinc-500">window</span>
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
                  <span className="ml-2 text-zinc-500">rows</span>
                  <Select
                    ariaLabel="Channels per page"
                    value={channelsPerPage}
                    onChange={(v) => {
                      setChannelsPerPage(v);
                      setChannelPage(0);
                    }}
                    options={[
                      { value: 8, label: "8" },
                      { value: 16, label: "16" },
                      { value: 32, label: "32" },
                      { value: 64, label: "64" },
                      { value: Math.max(8, totalChannels || 8), label: "all" },
                    ]}
                  />
                </div>
              </div>
              <p className="mb-2 text-[10px] text-zinc-600">
                click a channel name on the left to toggle bad · hover (and pause) to inspect ·
                arrows on the right of the plot page through channel blocks
              </p>
              {/* Plot box: traces in the middle. The time pager (← slider →)
               * sits as an overlay centered on the top edge, mirroring
               * the channel pager which is centered on the right edge.
               * Both overlays live outside the SlideIn so they stay still
               * while the trace block animates between channel pages. */}
              <div
                ref={signalBoxRef}
                className="relative overflow-hidden rounded border border-zinc-800 bg-zinc-950 p-2"
                style={{ height: signalPlotHeight }}
              >
                <SlideIn
                  triggerKey={safePage}
                  direction={pageDir}
                  durationMs={200}
                  offsetPx={28}
                  className={`h-full w-full pt-10 ${totalChannels > channelsPerPage ? "pr-14" : ""}`}
                >
                  {visibleSignal ? (
                    <ScrollPlot
                      times={visibleSignal.times ?? new Float32Array()}
                      channels={allChannelNames.slice(pageStart, pageEnd).map((name) => ({
                        name,
                        data: visibleSignal[name] ?? new Float32Array(),
                      }))}
                      badChannels={bads}
                      onToggleBad={onToggleBad}
                      height={signalPlotHeight - 16 - 40}
                      xRange={[tStart, tEnd]}
                    />
                  ) : (
                    <Skeleton
                      height={signalPlotHeight - 16 - 40}
                      label={signal.isFetching ? "loading recording…" : "—"}
                    />
                  )}
                </SlideIn>
                {/* Time pager: ← slider → centered horizontally on the
                 * top of the plot box. */}
                <div className="pointer-events-none absolute inset-x-0 top-0 flex h-10 items-center justify-center gap-2 text-xs text-zinc-400">
                  <button
                    type="button"
                    onClick={() => setWindowStart((s) => Math.max(0, s - windowLength))}
                    disabled={windowStart === 0}
                    className="pointer-events-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
                    title="back one window"
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
                    className="pointer-events-auto w-64 accent-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setWindowStart((s) => Math.min(maxStart, s + windowLength))}
                    disabled={windowStart >= maxStart}
                    className="pointer-events-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
                    title="forward one window"
                  >
                    →
                  </button>
                </div>
                {/* Channel pager: ↑ counter ↓ centered vertically on the
                 * right edge. Outside the SlideIn so the buttons stay
                 * rock-still while the trace block transitions. */}
                {totalChannels > channelsPerPage && (
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex w-14 flex-col items-center justify-center gap-3 text-xs text-zinc-400">
                    <button
                      type="button"
                      onClick={() => setChannelPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="pointer-events-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
                      title="previous channel block"
                    >
                      ↑
                    </button>
                    <div className="pointer-events-auto flex flex-col items-center font-mono text-[10px] leading-tight">
                      <span className="text-zinc-200">
                        {pageStart + 1}–{pageEnd}
                      </span>
                      <span className="text-zinc-600">of {totalChannels}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setChannelPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                      className="pointer-events-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
                      title="next channel block"
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>
              <ResizeHandle
                caption="drag to resize"
                onResize={(delta) =>
                  setSignalPlotHeight((h) => Math.max(200, Math.min(2000, h + delta)))
                }
              />
            </section>

            <section>
              <h2 className="mb-2 text-sm uppercase tracking-wider text-zinc-500">PSD · 1–47 Hz</h2>
              <div
                ref={psdBoxRef}
                className="relative rounded border border-zinc-800 bg-zinc-950 p-2"
                style={psdMinH > 0 ? { minHeight: psdMinH } : undefined}
              >
                {psd.data ? (
                  <PSDPlot
                    freqs={psd.data.freqs ?? new Float32Array()}
                    channels={Object.entries(psd.data)
                      .filter(([k]) => k !== "freqs")
                      .map(([name, data]) => ({ name, data }))}
                  />
                ) : (
                  <Skeleton height={psdMinH || 280} label={psd.isFetching ? "loading PSD…" : "—"} />
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

        {tab === "filter" && <FilterPanel sessionId={id} state={session.data} />}

        {tab === "ica" && <ICAPanel sessionId={id} />}

        {tab === "cleanup" && <CleanupPanel sessionId={id} state={session.data} />}

        {tab === "epochs" && <EpochsPanel sessionId={id} />}

        {tab === "export" && <ExportPanel sessionId={id} state={session.data} />}
      </div>
      {/* Full-screen blocking overlay for slow mutations (resample,
       * filter, fit_ica, etc.). Auto-mounts on any in-flight mutation
       * after a small delay, dismounts when none remain. */}
      <GlobalBusyOverlay />
    </main>
  );
}
