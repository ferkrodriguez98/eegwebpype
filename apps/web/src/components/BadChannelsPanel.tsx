"use client";

import { Topomap } from "@/components/viz/Topomap";
import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import type { ChannelDetection, DetectorReason, SessionState } from "@eegwebpype/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

const REASON_LABEL: Record<DetectorReason, string> = {
  auto_power: "potencia",
  auto_shape: "forma",
  auto_neighbors: "vecinos",
};

const REASON_COLOR: Record<DetectorReason, string> = {
  auto_power: "bg-amber-700",
  auto_shape: "bg-fuchsia-700",
  auto_neighbors: "bg-cyan-700",
};

function badsFromState(state: SessionState | undefined): Set<string> {
  if (!state) return new Set();
  const bads = new Set<string>();
  for (const ev of state.events) {
    if (ev.op === "mark_bad") {
      for (const c of ev.params.channels) bads.add(c);
    } else if (ev.op === "unmark_bad") {
      for (const c of ev.params.channels) bads.delete(c);
    }
  }
  return bads;
}

export function BadChannelsPanel({
  sessionId,
  state,
  selected,
  onSelect,
}: {
  sessionId: string;
  state: SessionState | undefined;
  selected: string | null;
  onSelect: (ch: string | null) => void;
}) {
  const qc = useQueryClient();
  const append = useAppendEvent(sessionId);

  const topo = useQuery({
    queryKey: ["topomap", sessionId, "shape_dev"],
    queryFn: () => api.topomap(sessionId, "shape_dev"),
    enabled: !!state,
  });

  const detect = useMutation({
    mutationFn: () => api.detectBadChannels(sessionId),
  });

  const detectionByChannel = useMemo(() => {
    const m = new Map<string, ChannelDetection>();
    for (const d of detect.data?.detections ?? []) m.set(d.channel, d);
    return m;
  }, [detect.data]);

  const bads = useMemo(() => badsFromState(state), [state]);

  const onAutoApply = () => {
    if (!detect.data) return;
    const channels = detect.data.detections.map((d) => d.channel);
    if (channels.length === 0) return;
    append.mutate(
      {
        op: "mark_bad",
        params: { channels, reason: "manual" },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["session", sessionId] });
        },
      },
    );
  };

  const onToggleBad = (ch: string) => {
    if (bads.has(ch)) {
      append.mutate({ op: "unmark_bad", params: { channels: [ch] } });
    } else {
      append.mutate({ op: "mark_bad", params: { channels: [ch], reason: "manual" } });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => detect.mutate()}
            disabled={detect.isPending}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            {detect.isPending ? "detectando…" : "auto-detect"}
          </button>
          <button
            type="button"
            onClick={onAutoApply}
            disabled={!detect.data || detect.data.detections.length === 0 || append.isPending}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            apply detected ({detect.data?.detections.length ?? 0})
          </button>
          <span className="text-xs text-zinc-500">{bads.size} marcados</span>
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
            detectados (click para seleccionar / mark)
          </div>
          {detect.data ? (
            <ul className="flex flex-wrap gap-1">
              {detect.data.detections.map((d) => (
                <li key={d.channel}>
                  <button
                    type="button"
                    onClick={() => onSelect(d.channel)}
                    onDoubleClick={() => onToggleBad(d.channel)}
                    title={`pot_z=${d.pot_z.toFixed(2)} shape=${d.shape_dev_db.toFixed(2)} nbr=${d.neighbor_corr.toFixed(3)}`}
                    className={`rounded px-2 py-0.5 font-mono text-xs ${
                      bads.has(d.channel) ? "bg-red-900 text-red-100" : "bg-zinc-800 text-zinc-100"
                    } ${selected === d.channel ? "outline outline-1 outline-emerald-400" : ""}`}
                  >
                    <span>{d.channel}</span>
                    <span className="ml-1 inline-flex gap-0.5">
                      {d.reasons.map((r) => (
                        <span
                          key={r}
                          className={`rounded px-1 text-[9px] uppercase ${REASON_COLOR[r]}`}
                        >
                          {REASON_LABEL[r]}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
              {detect.data.detections.length === 0 && (
                <li className="text-xs text-zinc-500">
                  sin canales sospechosos con los umbrales por defecto
                </li>
              )}
            </ul>
          ) : (
            <p className="text-xs text-zinc-600">tocá "auto-detect" para correr las 3 métricas.</p>
          )}
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">marcados</div>
          {bads.size === 0 ? (
            <p className="text-xs text-zinc-600">ninguno marcado</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {Array.from(bads).map((ch) => (
                <li key={ch}>
                  <button
                    type="button"
                    onClick={() => onToggleBad(ch)}
                    className="rounded bg-red-900 px-2 py-0.5 font-mono text-xs text-red-100 hover:bg-red-800"
                    title={`click para desmarcar · ${detectionByChannel.get(ch)?.reasons.join(",") ?? "manual"}`}
                  >
                    {ch}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">
          topomap · desviación de forma
        </h3>
        <Topomap
          points={topo.data?.points ?? []}
          badChannels={bads}
          highlightedChannel={selected}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
