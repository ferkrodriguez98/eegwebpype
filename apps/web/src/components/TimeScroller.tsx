"use client";

import { Skeleton } from "@/components/Skeleton";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { Select } from "@/components/ui/Select";
import { SlideIn } from "@/components/ui/SlideIn";
import { ScrollPlot } from "@/components/viz/ScrollPlot";
import { api } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

type Props = {
  sessionId: string;
  duration: number;
  badChannels?: Set<string>;
  onToggleBad?: (channel: string) => void;
  /** Initial window length in seconds. */
  defaultWindow?: number;
  /** Initial channels per page. */
  defaultRows?: number;
  /** Initial plot height. */
  defaultHeight?: number;
  /** Whether to expose the resize handle below the plot. Off in
   * compact contexts (cleanup preview) so the panel stays tidy. */
  resizable?: boolean;
};

/** Self-contained time-series scroller with a built-in time pager
 * (← slider →), channel pager (↑ counter ↓), window length and rows
 * selectors, and an optional resize handle. Reuses the shared
 * `signal-overview` query so multiple instances don't re-fetch. */
export function TimeScroller({
  sessionId,
  duration,
  badChannels,
  onToggleBad,
  defaultWindow = 10,
  defaultRows = 32,
  defaultHeight = 600,
  resizable = true,
}: Props) {
  const [windowStart, setWindowStart] = useState(0);
  const [windowLength, setWindowLength] = useState(defaultWindow);
  const [channelPage, setChannelPage] = useState(0);
  const [channelsPerPage, setChannelsPerPage] = useState(defaultRows);
  const [pageDir, setPageDir] = useState<"up" | "down" | null>(null);
  const [plotHeight, setPlotHeight] = useState(defaultHeight);

  const effectiveLength = duration > 0 ? Math.min(windowLength, duration) : windowLength;
  const maxStart = Math.max(0, duration - effectiveLength);
  const tStart = Math.max(0, Math.min(windowStart, maxStart));
  const tEnd = Math.min(
    duration > 0 ? duration : tStart + effectiveLength,
    tStart + effectiveLength,
  );

  const signal = useQuery({
    queryKey: ["signal-overview", sessionId],
    queryFn: () =>
      api.signal(sessionId, {
        tStart: 0,
        tEnd: duration > 0 ? duration : 1,
        targetPoints: 8000,
      }),
    enabled: duration > 0,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const visibleSignal = useMemo(() => {
    if (!signal.data) return undefined;
    const times = signal.data.times;
    if (!times || times.length === 0) return signal.data;
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

  const allChannelNames = useMemo(() => {
    if (!signal.data) return [] as string[];
    return Object.keys(signal.data).filter((k) => k !== "times");
  }, [signal.data]);
  const totalChannels = allChannelNames.length;
  const totalPages = Math.max(1, Math.ceil(totalChannels / channelsPerPage));
  const safePage = Math.min(channelPage, totalPages - 1);
  const pageStart = safePage * channelsPerPage;
  const pageEnd = Math.min(totalChannels, pageStart + channelsPerPage);

  // Track the last page so we can drive the slide animation direction.
  useEffect(() => {
    setPageDir(null);
  }, []);
  const onPageChange = (next: number) => {
    setPageDir(next > safePage ? "down" : "up");
    setChannelPage(next);
  };

  return (
    <div className="flex flex-col">
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
      <div
        className="relative overflow-hidden rounded border border-zinc-800 bg-zinc-950 p-2"
        style={{ height: plotHeight }}
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
              badChannels={badChannels}
              onToggleBad={onToggleBad}
              height={plotHeight - 16 - 40}
              xRange={[tStart, tEnd]}
            />
          ) : (
            <Skeleton
              height={plotHeight - 16 - 40}
              label={signal.isFetching ? "loading recording…" : "—"}
            />
          )}
        </SlideIn>
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
        {totalChannels > channelsPerPage && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-14 flex-col items-center justify-center gap-3 text-xs text-zinc-400">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(0, safePage - 1))}
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
              onClick={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="pointer-events-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
              title="next channel block"
            >
              ↓
            </button>
          </div>
        )}
      </div>
      {resizable && (
        <ResizeHandle
          caption="drag to resize"
          onResize={(delta) => setPlotHeight((h) => Math.max(200, Math.min(2000, h + delta)))}
        />
      )}
    </div>
  );
}
