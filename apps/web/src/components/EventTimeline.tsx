"use client";

import type { Event } from "@eegwebpype/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

const OP_COLORS: Record<string, string> = {
  load: "bg-zinc-700",
  drop_channels: "bg-amber-700",
  set_montage: "bg-amber-600",
  resample: "bg-blue-700",
  filter: "bg-blue-600",
  mark_bad: "bg-red-700",
  unmark_bad: "bg-emerald-700",
  fit_ica: "bg-purple-700",
  label_ica: "bg-purple-600",
  exclude_ica: "bg-purple-800",
  apply_ica: "bg-purple-700",
  interpolate_bads: "bg-cyan-700",
  set_reference: "bg-cyan-800",
  epoch: "bg-teal-700",
  reject_epochs: "bg-teal-800",
  export: "bg-emerald-800",
};

function eventSummary(ev: Event): string {
  switch (ev.op) {
    case "load":
      return ev.params.source_file.split("/").slice(-1)[0] ?? "";
    case "drop_channels":
      return `${ev.params.channels.length} ch`;
    case "set_montage":
      return ev.params.montage;
    case "resample":
      return `${ev.params.sfreq} Hz`;
    case "filter": {
      const l = ev.params.l_freq ?? "—";
      const h = ev.params.h_freq ?? "—";
      return `${l}–${h} Hz`;
    }
    case "mark_bad":
    case "unmark_bad":
      return `${ev.params.channels.length} ch`;
    case "interpolate_bads":
      return "spherical";
    case "set_reference":
      return ev.params.type;
    case "epoch":
      return `${ev.params.length_seconds}s`;
    case "reject_epochs":
      return `${ev.params.indices.length} ep`;
    case "export":
      return ev.params.kind;
    default:
      return "";
  }
}

export function EventTimeline({
  events,
  onUndo,
  canUndo,
}: {
  events: Event[];
  onUndo: () => void;
  canUndo: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">event log</h3>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          title="Cmd+Z"
        >
          undo
        </button>
      </div>
      <ol className="flex flex-wrap gap-1">
        {events.map((ev, i) => {
          const isOpen = expandedId === ev.id;
          const summary = eventSummary(ev);
          return (
            <li key={ev.id} className="flex">
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : ev.id)}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono text-zinc-100 transition ${
                  OP_COLORS[ev.op] ?? "bg-zinc-700"
                } ${isOpen ? "ring-1 ring-zinc-300" : ""}`}
                title={new Date(ev.ts).toLocaleTimeString()}
              >
                {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <span className="opacity-60">{i + 1}.</span>
                <span>{ev.op}</span>
                {summary && <span className="opacity-70">· {summary}</span>}
              </button>
            </li>
          );
        })}
      </ol>

      {expandedId && <EventDetails event={events.find((e) => e.id === expandedId)} />}
    </div>
  );
}

function EventDetails({ event }: { event: Event | undefined }) {
  if (!event) return null;
  return (
    <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/50 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-zinc-100">{event.op}</span>
        <span className="text-[10px] text-zinc-500">{new Date(event.ts).toLocaleString()}</span>
      </div>
      <div className="mb-2 text-[10px] text-zinc-600">
        id <span className="font-mono">{event.id}</span>
      </div>
      <pre className="overflow-x-auto rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
        {JSON.stringify(event.params, null, 2)}
      </pre>
    </div>
  );
}
