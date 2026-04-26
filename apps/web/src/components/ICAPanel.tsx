"use client";

import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import type { ICAComponent } from "@eegwebpype/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Eye, Heart, HelpCircle, Loader2, Play, Wand2, Zap } from "lucide-react";
import { useState } from "react";

const LABEL_ICON: Record<string, typeof Brain> = {
  brain: Brain,
  "eye blink": Eye,
  eye: Eye,
  muscle: Zap,
  "muscle artifact": Zap,
  heart: Heart,
  "channel noise": HelpCircle,
  "line noise": Zap,
  other: HelpCircle,
  unknown: HelpCircle,
};

function labelIcon(label: string): typeof Brain {
  return LABEL_ICON[label.toLowerCase()] ?? HelpCircle;
}

function ComponentCard({
  comp,
  excluded,
  onToggle,
}: {
  comp: ICAComponent;
  excluded: boolean;
  onToggle: () => void;
}) {
  const Icon = labelIcon(comp.label);
  const seriesMin = Math.min(...comp.series);
  const seriesMax = Math.max(...comp.series);
  const seriesRange = Math.max(Math.abs(seriesMin), Math.abs(seriesMax)) || 1;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex flex-col gap-1 rounded border p-2 text-left transition ${
        excluded
          ? "border-red-700 bg-red-950/40 opacity-70"
          : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
      }`}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono">IC{comp.index.toString().padStart(2, "0")}</span>
        <span
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
            comp.label === "brain"
              ? "bg-emerald-900 text-emerald-100"
              : "bg-amber-900 text-amber-100"
          }`}
        >
          <Icon size={10} />
          {comp.label}
        </span>
      </div>

      <svg viewBox="0 0 100 30" className="h-8 w-full">
        <title>IC{comp.index} series</title>
        <polyline
          fill="none"
          stroke={excluded ? "#7f1d1d" : "#a78bfa"}
          strokeWidth="0.6"
          points={comp.series
            .map((v, i) => {
              const x = (i / Math.max(1, comp.series.length - 1)) * 100;
              const y = 15 - (v / seriesRange) * 12;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ")}
        />
      </svg>

      <div className="text-[10px] text-zinc-500">prob {(comp.prob * 100).toFixed(0)}%</div>
    </button>
  );
}

export function ICAPanel({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const append = useAppendEvent(sessionId);
  const [n, setN] = useState<number>(20);
  const [progress, setProgress] = useState<{ phase: string; fraction?: number } | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const components = useQuery({
    queryKey: ["ica-components", sessionId],
    queryFn: () => api.icaComponents(sessionId),
    retry: false,
  });

  const fit = useMutation({
    mutationFn: () => api.fitIcaWS(sessionId, n, (e) => setProgress(e)),
    onSuccess: () => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: ["ica-components", sessionId] });
    },
    onError: () => setProgress(null),
  });

  const onToggleExclude = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const onApply = () => {
    if (excluded.size === 0) return;
    append.mutate({
      op: "exclude_ica",
      params: { components: Array.from(excluded), reason: "manual" },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          n_components
          <input
            type="number"
            value={n}
            min={2}
            max={64}
            onChange={(e) => setN(Number.parseInt(e.target.value, 10) || n)}
            className="w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => fit.mutate()}
          disabled={fit.isPending}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          {fit.isPending ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
          fit ICA
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={excluded.size === 0 || append.isPending}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          <Wand2 size={14} />
          apply exclude ({excluded.size})
        </button>
        {progress && (
          <span className="text-xs text-zinc-500">
            {progress.phase}
            {progress.fraction !== undefined ? ` ${Math.round(progress.fraction * 100)}%` : ""}
          </span>
        )}
        {fit.error && <span className="text-xs text-red-400">{String(fit.error)}</span>}
      </div>

      {components.isError && (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
          ICA not fitted yet. Click "fit ICA" to start.
        </div>
      )}

      {components.data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {components.data.components.map((c) => (
            <ComponentCard
              key={c.index}
              comp={c}
              excluded={excluded.has(c.index)}
              onToggle={() => onToggleExclude(c.index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
