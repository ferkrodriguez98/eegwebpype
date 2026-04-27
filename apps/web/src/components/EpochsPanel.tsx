"use client";

import { Skeleton } from "@/components/Skeleton";
import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import type { EpochsMatrix } from "@eegwebpype/shared";
import { useQuery } from "@tanstack/react-query";
import { interpolateInferno } from "d3-scale-chromatic";
import { Check, Grid3x3, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";

export function EpochsPanel({ sessionId }: { sessionId: string }) {
  const append = useAppendEvent(sessionId);
  const [length, setLength] = usePersistedState<number>(sessionId, "epoch-length", 8);
  const [manualRejectArr, setManualRejectArr] = usePersistedState<number[]>(
    sessionId,
    "epoch-manual-reject",
    [],
  );
  const manualReject = useMemo(() => new Set(manualRejectArr), [manualRejectArr]);
  const setManualReject = (updater: (prev: Set<number>) => Set<number>) => {
    setManualRejectArr((curr) => Array.from(updater(new Set(curr))));
  };

  const epochs = useQuery({
    queryKey: ["epochs", sessionId, length],
    queryFn: () => api.epochs(sessionId, length),
  });

  const onCommit = () => {
    if (!epochs.data) return;
    append.mutate({
      op: "epoch",
      params: { length_seconds: length, overlap: 0, detrend: 1 },
    });
    const auto = new Set<number>(epochs.data.rejected_indices);
    const all = new Set<number>([...auto, ...manualReject]);
    if (all.size > 0) {
      append.mutate({
        op: "reject_epochs",
        params: { indices: Array.from(all), reason: "manual" },
      });
    }
  };

  const toggleReject = (i: number) => {
    setManualReject((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top control bar */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-800 bg-zinc-950 p-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="uppercase tracking-wider text-zinc-500">epoch length</span>
          <input
            type="number"
            value={length}
            min={1}
            max={60}
            step={0.5}
            onChange={(e) => {
              const v = Number.parseFloat(e.target.value);
              if (!Number.isNaN(v) && v > 0) setLength(v);
            }}
            className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
          />
          <span className="text-zinc-600">s</span>
        </label>
        <button
          type="button"
          onClick={() => epochs.refetch()}
          disabled={epochs.isFetching}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          <RefreshCw size={14} className={epochs.isFetching ? "animate-spin" : ""} />
          recompute
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={!epochs.data || append.isPending}
          className="ml-auto flex items-center gap-1.5 rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-800/60 disabled:opacity-40"
        >
          <Grid3x3 size={14} />
          commit epochs
        </button>
      </div>

      {epochs.data ? (
        <EpochsView matrix={epochs.data} manualReject={manualReject} onToggle={toggleReject} />
      ) : (
        <Skeleton height={500} label={epochs.isFetching ? "computing epochs…" : "—"} />
      )}
    </div>
  );
}

function EpochsView({
  matrix,
  manualReject,
  onToggle,
}: {
  matrix: EpochsMatrix;
  manualReject: Set<number>;
  onToggle: (i: number) => void;
}) {
  // Per-epoch summary statistics: max PTP across channels and which
  // channel hit that max (the "worst offender" of each epoch).
  const epochStats = useMemo(() => {
    const out: { maxPtp: number; argmaxCh: number; meanPtp: number }[] = [];
    for (const row of matrix.ptp_matrix) {
      let max = 0;
      let argmax = 0;
      let sum = 0;
      for (let i = 0; i < row.length; i++) {
        const v = row[i] ?? 0;
        sum += v;
        if (v > max) {
          max = v;
          argmax = i;
        }
      }
      out.push({
        maxPtp: max,
        argmaxCh: argmax,
        meanPtp: row.length > 0 ? sum / row.length : 0,
      });
    }
    return out;
  }, [matrix.ptp_matrix]);

  const allValues = useMemo(() => matrix.ptp_matrix.flat(), [matrix.ptp_matrix]);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const maxPtps = epochStats.map((s) => s.maxPtp);
  const histogramBins = useMemo(() => buildHistogram(maxPtps, 25), [maxPtps]);

  const autoRejectSet = useMemo(() => new Set(matrix.rejected_indices), [matrix.rejected_indices]);
  const totalRejected = useMemo(() => {
    const u = new Set([...matrix.rejected_indices, ...manualReject]);
    return u.size;
  }, [matrix.rejected_indices, manualReject]);
  const kept = matrix.n_epochs - totalRejected;
  const keptPct = matrix.n_epochs > 0 ? (kept / matrix.n_epochs) * 100 : 0;

  const [hoveredEpoch, setHoveredEpoch] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {/* Stats strip: at-a-glance counts above the heatmap. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="epochs" value={matrix.n_epochs.toString()} />
        <Stat label="channels" value={matrix.n_channels.toString()} />
        <Stat label="threshold" value={`${matrix.threshold_uv.toFixed(0)} µV`} tone="amber" />
        <Stat label="auto-rejected" value={matrix.rejected_indices.length.toString()} tone="rose" />
        <Stat label="kept" value={`${kept} (${keptPct.toFixed(0)}%)`} tone="emerald" />
      </div>

      {/* Top: per-epoch max-PTP bar chart. The bar height is the worst
       * channel of the epoch — that's what the auto-reject threshold
       * compares against. Click a bar to manually toggle rejection. */}
      <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">
            max peak-to-peak per epoch
          </h3>
          <span className="text-[10px] text-zinc-600">
            click a bar to mark / unmark for rejection
          </span>
        </div>
        <PtpBars
          stats={epochStats}
          threshold={matrix.threshold_uv}
          autoRejectSet={autoRejectSet}
          manualReject={manualReject}
          hoveredEpoch={hoveredEpoch}
          onHover={setHoveredEpoch}
          onToggle={onToggle}
          channelNames={matrix.channel_names}
        />
      </div>

      {/* Heatmap: full PTP matrix, channels × epochs. */}
      <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">ptp by channel × epoch</h3>
          <span className="text-[10px] text-zinc-600">
            inferno colormap · darker = lower amplitude
          </span>
        </div>
        <Heatmap
          matrix={matrix}
          autoRejectSet={autoRejectSet}
          manualReject={manualReject}
          hoveredEpoch={hoveredEpoch}
          onHover={setHoveredEpoch}
          onToggle={onToggle}
          min={min}
          range={range}
        />
      </div>

      {/* Distribution + legend. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 lg:col-span-2">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500">max-ptp distribution</h3>
            <span className="text-[10px] text-zinc-600">vertical line = auto-reject threshold</span>
          </div>
          <Histogram bins={histogramBins} threshold={matrix.threshold_uv} />
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">legend</h3>
          <ul className="flex flex-col gap-2 text-xs text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded bg-zinc-700" />
              kept (will be exported)
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded bg-rose-700" />
              auto-rejected (above threshold)
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded bg-amber-600" />
              manually rejected
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded bg-emerald-600" />
              kept after manual override
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "rose" | "emerald";
}) {
  const toneClass =
    tone === "amber"
      ? "text-amber-300"
      : tone === "rose"
        ? "text-rose-300"
        : tone === "emerald"
          ? "text-emerald-300"
          : "text-zinc-100";
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-base ${toneClass}`}>{value}</div>
    </div>
  );
}

function PtpBars({
  stats,
  threshold,
  autoRejectSet,
  manualReject,
  hoveredEpoch,
  onHover,
  onToggle,
  channelNames,
}: {
  stats: { maxPtp: number; argmaxCh: number; meanPtp: number }[];
  threshold: number;
  autoRejectSet: Set<number>;
  manualReject: Set<number>;
  hoveredEpoch: number | null;
  onHover: (i: number | null) => void;
  onToggle: (i: number) => void;
  channelNames: string[];
}) {
  const n = stats.length;
  if (n === 0) return null;
  const maxV = Math.max(threshold * 1.2, ...stats.map((s) => s.maxPtp));
  const barWidth = 100 / n;
  return (
    <div className="relative">
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="h-32 w-full">
        <title>max peak-to-peak per epoch</title>
        {/* Threshold line */}
        <line
          x1="0"
          x2="100"
          y1={60 - (threshold / maxV) * 60}
          y2={60 - (threshold / maxV) * 60}
          stroke="#fbbf24"
          strokeWidth="0.3"
          strokeDasharray="1,0.6"
        />
        {stats.map((s, i) => {
          const isAuto = autoRejectSet.has(i);
          const isManual = manualReject.has(i);
          // Manual override: if auto-rejected but in manualReject we
          // assume the user wants to keep it (toggling); same for the
          // inverse. The visible reject set is the symmetric diff.
          const isRejected = isAuto !== isManual;
          const isHov = i === hoveredEpoch;
          const h = (s.maxPtp / maxV) * 60;
          const fill = isRejected
            ? isManual && !isAuto
              ? "#d97706" // amber: manual reject
              : "#be123c" // rose: auto reject
            : isManual && isAuto
              ? "#059669" // emerald: kept after manual override
              : "#52525b"; // zinc: normal kept
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: SVG rect; this is a custom widget and clicking is the only intended interaction
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: positional bars
              key={`bar-${i}`}
              x={i * barWidth + 0.05}
              y={60 - h}
              width={Math.max(0.2, barWidth - 0.1)}
              height={h}
              fill={fill}
              opacity={isHov ? 1 : 0.85}
              stroke={isHov ? "#fafafa" : "none"}
              strokeWidth="0.3"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onToggle(i)}
            />
          );
        })}
      </svg>
      {hoveredEpoch != null && stats[hoveredEpoch] && (
        <EpochTooltip
          index={hoveredEpoch}
          stat={stats[hoveredEpoch]}
          channelName={channelNames[stats[hoveredEpoch].argmaxCh] ?? "?"}
          autoRejected={autoRejectSet.has(hoveredEpoch)}
          manualRejected={manualReject.has(hoveredEpoch)}
        />
      )}
    </div>
  );
}

function EpochTooltip({
  index,
  stat,
  channelName,
  autoRejected,
  manualRejected,
}: {
  index: number;
  stat: { maxPtp: number; meanPtp: number };
  channelName: string;
  autoRejected: boolean;
  manualRejected: boolean;
}) {
  const finalRejected = autoRejected !== manualRejected;
  return (
    <div className="pointer-events-none absolute right-2 top-2 rounded border border-zinc-700 bg-zinc-950/95 p-2 text-[10px] font-mono text-zinc-100 shadow-lg">
      <div className="mb-1 text-zinc-400">epoch {index}</div>
      <div>
        max ptp <span className="text-zinc-100">{stat.maxPtp.toFixed(1)} µV</span>{" "}
        <span className="text-zinc-500">on {channelName}</span>
      </div>
      <div>
        mean ptp <span className="text-zinc-300">{stat.meanPtp.toFixed(1)} µV</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {finalRejected ? (
          <>
            <X size={10} className="text-rose-400" />
            <span className="text-rose-300">
              rejected ({manualRejected && !autoRejected ? "manual" : "auto"})
            </span>
          </>
        ) : (
          <>
            <Check size={10} className="text-emerald-400" />
            <span className="text-emerald-300">kept</span>
          </>
        )}
      </div>
    </div>
  );
}

function Heatmap({
  matrix,
  autoRejectSet,
  manualReject,
  hoveredEpoch,
  onHover,
  onToggle,
  min,
  range,
}: {
  matrix: EpochsMatrix;
  autoRejectSet: Set<number>;
  manualReject: Set<number>;
  hoveredEpoch: number | null;
  onHover: (i: number | null) => void;
  onToggle: (i: number) => void;
  min: number;
  range: number;
}) {
  const cellW = 14;
  const cellH = 6;
  const labelW = 48;
  const width = matrix.n_epochs * cellW + labelW + 4;
  const height = matrix.n_channels * cellH + 4;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="block">
        <title>peak-to-peak by epoch and channel</title>
        {/* Channel name labels on the left */}
        {matrix.channel_names.map((name, c) => (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
            key={c}
            x={labelW - 4}
            y={c * cellH + cellH - 1}
            fontSize="6"
            fontFamily="ui-monospace, monospace"
            fill="#71717a"
            textAnchor="end"
          >
            {name}
          </text>
        ))}
        {/* Heatmap cells */}
        {matrix.ptp_matrix.map((row, e) =>
          row.map((v, c) => {
            const t = (v - min) / range;
            const fill = interpolateInferno(t);
            const isAuto = autoRejectSet.has(e);
            const isManual = manualReject.has(e);
            const isRejected = isAuto !== isManual;
            const isHov = e === hoveredEpoch;
            const chName = matrix.channel_names[c] ?? `c${c}`;
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: cell positions are the identity
                key={`${chName}-e${e}`}
                x={labelW + e * cellW}
                y={c * cellH}
                width={cellW - 1}
                height={cellH - 1}
                fill={fill}
                opacity={isRejected ? 0.18 : isHov ? 1 : 0.92}
              />
            );
          }),
        )}
        {/* Per-epoch column overlays for hover + click. Transparent
         * over the cells, full-width over the heatmap height. */}
        {Array.from({ length: matrix.n_epochs }).map((_, e) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: SVG rect overlay; click is the intended interaction
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: positional columns
            key={`col-${e}`}
            x={labelW + e * cellW}
            y={0}
            width={cellW - 1}
            height={matrix.n_channels * cellH}
            fill="transparent"
            stroke={e === hoveredEpoch ? "#fafafa" : "transparent"}
            strokeWidth="0.5"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => onHover(e)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onToggle(e)}
          />
        ))}
      </svg>
    </div>
  );
}

function buildHistogram(values: number[], nBins: number): { x: number; count: number }[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return [{ x: min, count: values.length }];
  const w = (max - min) / nBins;
  const bins = Array.from({ length: nBins }, (_, i) => ({ x: min + i * w, count: 0 }));
  for (const v of values) {
    const idx = Math.min(nBins - 1, Math.floor((v - min) / w));
    const bin = bins[idx];
    if (bin) bin.count++;
  }
  return bins;
}

function Histogram({
  bins,
  threshold,
}: {
  bins: { x: number; count: number }[];
  threshold: number;
}) {
  if (bins.length === 0) return null;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const minX = bins[0]?.x ?? 0;
  const lastBin = bins[bins.length - 1];
  const firstBin = bins[0];
  const secondBin = bins[1];
  const binWidth = firstBin && secondBin ? secondBin.x - firstBin.x : 1;
  const maxX = (lastBin?.x ?? 0) + binWidth;
  const range = maxX - minX || 1;
  const thresholdX = ((threshold - minX) / range) * 100;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full">
      <title>distribution of max peak-to-peak amplitudes</title>
      {bins.map((b, i) => {
        const h = (b.count / maxCount) * 40;
        const w = 100 / bins.length;
        const isPastThreshold = b.x >= threshold;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: positional bars
            key={i}
            x={i * w + 0.1}
            y={40 - h}
            width={w - 0.2}
            height={h}
            fill={isPastThreshold ? "#be123c" : "#52525b"}
          />
        );
      })}
      {thresholdX >= 0 && thresholdX <= 100 && (
        <line
          x1={thresholdX}
          x2={thresholdX}
          y1="0"
          y2="40"
          stroke="#fbbf24"
          strokeWidth="0.4"
          strokeDasharray="1,0.5"
        />
      )}
    </svg>
  );
}
