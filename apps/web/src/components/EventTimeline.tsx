"use client";

import type { Event } from "@eegwebpype/shared";

const OP_COLORS: Record<string, string> = {
  load: "bg-zinc-700",
  drop_channels: "bg-amber-700",
  set_montage: "bg-amber-600",
  resample: "bg-blue-700",
  filter: "bg-blue-600",
  mark_bad: "bg-red-700",
  unmark_bad: "bg-emerald-700",
};

export function EventTimeline({
  events,
  onUndo,
  canUndo,
}: {
  events: Event[];
  onUndo: () => void;
  canUndo: boolean;
}) {
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
        {events.map((ev, i) => (
          <li
            key={ev.id}
            className={`rounded px-2 py-0.5 text-xs font-mono text-zinc-100 ${
              OP_COLORS[ev.op] ?? "bg-zinc-700"
            }`}
            title={`${ev.id} · ${new Date(ev.ts).toLocaleTimeString()}`}
          >
            <span className="opacity-60">{i + 1}.</span> {ev.op}
          </li>
        ))}
      </ol>
    </div>
  );
}
