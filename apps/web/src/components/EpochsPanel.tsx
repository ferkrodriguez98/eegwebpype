"use client";

import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import type { EpochsMatrix } from "@eegwebpype/shared";
import { useQuery } from "@tanstack/react-query";
import { interpolateInferno } from "d3-scale-chromatic";
import { Grid3x3, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

export function EpochsPanel({ sessionId }: { sessionId: string }) {
  const append = useAppendEvent(sessionId);
  const [length, setLength] = useState<number>(8);
  const [manualReject, setManualReject] = useState<Set<number>>(new Set());

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
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          length (s)
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
            className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
          />
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
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          <Grid3x3 size={14} />
          commit
        </button>
      </div>

      {epochs.data && (
        <Heatmap matrix={epochs.data} manualReject={manualReject} onToggle={toggleReject} />
      )}
    </div>
  );
}

function Heatmap({
  matrix,
  manualReject,
  onToggle,
}: {
  matrix: EpochsMatrix;
  manualReject: Set<number>;
  onToggle: (i: number) => void;
}) {
  const allValues = useMemo(() => matrix.ptp_matrix.flat(), [matrix.ptp_matrix]);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const cellW = 16;
  const cellH = 8;
  const width = matrix.n_epochs * cellW;
  const height = matrix.n_channels * cellH;

  return (
    <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-2">
      <p className="mb-2 text-xs text-zinc-500">
        {matrix.n_epochs} epochs × {matrix.n_channels} channels · threshold{" "}
        {matrix.threshold_uv.toFixed(0)} µV · {matrix.rejected_indices.length} auto-rejected
      </p>
      <svg width={width + 40} height={height + 30}>
        <title>peak-to-peak by epoch and channel</title>
        {matrix.ptp_matrix.map((row, e) =>
          row.map((v, c) => {
            const t = (v - min) / range;
            const fill = interpolateInferno(t);
            const epIsRejected = matrix.rejected_indices.includes(e) || manualReject.has(e);
            const chName = matrix.channel_names[c] ?? `c${c}`;
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: epochs are positional
                key={`${chName}-e${e}`}
                x={e * cellW}
                y={c * cellH}
                width={cellW - 1}
                height={cellH - 1}
                fill={fill}
                opacity={epIsRejected ? 0.3 : 1}
              />
            );
          }),
        )}
        {Array.from({ length: matrix.n_epochs }).map((_, e) => {
          const epIsRejected = matrix.rejected_indices.includes(e) || manualReject.has(e);
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: epochs are positional
              key={`btn-e${e}`}
              x={e * cellW}
              y={height + 4}
              width={cellW - 1}
              height={16}
              fill={epIsRejected ? "#7f1d1d" : "#27272a"}
              stroke={manualReject.has(e) ? "#fafafa" : "transparent"}
              strokeWidth={1}
              onClick={() => onToggle(e)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onToggle(e);
                }
              }}
              style={{ cursor: "pointer" }}
            />
          );
        })}
      </svg>
    </div>
  );
}
