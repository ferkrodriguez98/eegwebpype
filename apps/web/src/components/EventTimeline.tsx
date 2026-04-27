"use client";

import type { Event } from "@eegwebpype/shared";
import { ChevronDown, ChevronRight, ChevronUp, Undo2 } from "lucide-react";
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

function eventSummary(ev: Event, ctx?: { interpolatedCount?: number }): string {
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
    case "interpolate_bads": {
      const n = ctx?.interpolatedCount;
      return n != null ? `${n} ch` : "spherical";
    }
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

/** Distinguish manual vs automatic origin for mark_bad events. We
 * group consecutive events of the same op AND the same auto/manual
 * flavour — so a row of 8 manual marks collapses, but a manual mark
 * followed by an auto-detect mark stays in two separate rows. */
function eventVariant(ev: Event): string {
  if (ev.op === "mark_bad") {
    const r = ev.params.reason;
    if (r === "manual") return "manual";
    return "auto";
  }
  return "";
}

type Group = {
  /** First event id; used as key. */
  id: string;
  events: Event[];
  /** Index of the first event in the original list (1-based for display). */
  startIndex: number;
};

function groupEvents(events: Event[]): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    const last = groups[groups.length - 1];
    const sameOp = last && last.events[0]?.op === ev.op;
    const lastEv = last?.events[0];
    const sameVariant = sameOp && lastEv && eventVariant(lastEv) === eventVariant(ev);
    if (last && sameOp && sameVariant) {
      last.events.push(ev);
    } else {
      groups.push({ id: ev.id, events: [ev], startIndex: i + 1 });
    }
  }
  return groups;
}

/** Aggregate summary for a group: e.g. mark_bad ×8 manual · 8 ch */
function groupSummary(group: Group, interpolatedByEvent: Map<string, string[]>): string {
  const ev = group.events[0];
  if (!ev) return "";
  if (group.events.length === 1) {
    if (ev.op === "interpolate_bads") {
      const chans = interpolatedByEvent.get(ev.id);
      return chans ? `${chans.length} ch` : "spherical";
    }
    return eventSummary(ev);
  }
  // Aggregate channel counts where it makes sense.
  if (ev.op === "mark_bad" || ev.op === "unmark_bad") {
    const total = group.events.reduce((acc, e) => {
      if (e.op === "mark_bad" || e.op === "unmark_bad") return acc + e.params.channels.length;
      return acc;
    }, 0);
    return `${total} ch`;
  }
  return eventSummary(ev);
}

function groupVariantTag(group: Group): string {
  const ev = group.events[0];
  if (!ev) return "";
  if (ev.op === "mark_bad") return eventVariant(ev);
  return "";
}

/** For each `interpolate_bads` event, compute the list of channels
 * that were bad at the moment it ran (i.e. what actually got
 * interpolated). The payload itself is empty `{}`, so we replay the
 * mark/unmark history up to that point. */
function interpolatedChannelsByEventId(events: Event[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const bads = new Set<string>();
  for (const ev of events) {
    if (ev.op === "mark_bad") {
      for (const c of ev.params.channels) bads.add(c);
    } else if (ev.op === "unmark_bad") {
      for (const c of ev.params.channels) bads.delete(c);
    } else if (ev.op === "interpolate_bads") {
      out.set(ev.id, Array.from(bads));
      bads.clear();
    }
  }
  return out;
}

export function EventTimeline({
  events,
  onUndo,
  canUndo,
  collapsed,
  onToggleCollapsed,
}: {
  events: Event[];
  onUndo: () => void;
  canUndo: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const groups = groupEvents(events);
  const interpolatedByEvent = interpolatedChannelsByEventId(events);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-y border-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
          title={collapsed ? "expand" : "collapse"}
        >
          {collapsed ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          <span>event log</span>
          <span className="text-[10px] text-zinc-600">({events.length})</span>
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          title="Cmd+Z"
        >
          <Undo2 size={10} />
          undo
        </button>
      </div>
      <ol
        className={`flex flex-col gap-0.5 overflow-y-auto p-2 transition-[flex-grow,padding,opacity] duration-300 ease-in-out ${
          collapsed ? "pointer-events-none flex-grow-0 p-0 opacity-0" : "flex-grow opacity-100"
        }`}
        aria-hidden={collapsed}
      >
        {groups.map((group) => {
          const ev = group.events[0];
          if (!ev) return null;
          const isOpen = expandedId === group.id;
          const summary = groupSummary(group, interpolatedByEvent);
          const variant = groupVariantTag(group);
          const count = group.events.length;
          const indexLabel =
            count === 1
              ? `${group.startIndex}.`
              : `${group.startIndex}–${group.startIndex + count - 1}.`;
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : group.id)}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] font-mono text-zinc-100 transition ${
                  OP_COLORS[ev.op] ?? "bg-zinc-700"
                } ${isOpen ? "ring-1 ring-zinc-300" : ""}`}
                title={new Date(ev.ts).toLocaleTimeString()}
              >
                {isOpen ? (
                  <ChevronDown size={10} className="shrink-0" />
                ) : (
                  <ChevronRight size={10} className="shrink-0" />
                )}
                <span className="shrink-0 opacity-60">{indexLabel}</span>
                <span className="truncate">{ev.op}</span>
                {count > 1 && (
                  <span className="shrink-0 rounded bg-black/30 px-1 text-[9px] opacity-80">
                    ×{count}
                  </span>
                )}
                {variant && (
                  <span className="shrink-0 rounded bg-black/30 px-1 text-[9px] uppercase opacity-80">
                    {variant}
                  </span>
                )}
                {summary && <span className="ml-auto truncate opacity-70">{summary}</span>}
              </button>
              {isOpen && <GroupDetails group={group} interpolatedByEvent={interpolatedByEvent} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function GroupDetails({
  group,
  interpolatedByEvent,
}: {
  group: Group;
  interpolatedByEvent: Map<string, string[]>;
}) {
  if (group.events.length === 1) {
    const ev = group.events[0];
    if (!ev) return null;
    return <EventDetails event={ev} interpolatedByEvent={interpolatedByEvent} />;
  }
  return (
    <div className="mt-1 mb-1 flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-900/50 p-2 text-[10px]">
      {group.events.map((ev, i) => {
        const interp = ev.op === "interpolate_bads" ? interpolatedByEvent.get(ev.id) : undefined;
        const summary = eventSummary(ev, { interpolatedCount: interp?.length });
        return (
          <div key={ev.id} className="flex items-baseline gap-2">
            <span className="shrink-0 font-mono text-zinc-600">{group.startIndex + i}.</span>
            <span className="font-mono text-zinc-300">{ev.op}</span>
            {summary && <span className="font-mono text-zinc-500">{summary}</span>}
            <span className="ml-auto shrink-0 text-[9px] text-zinc-600">
              {new Date(ev.ts).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EventDetails({
  event,
  interpolatedByEvent,
}: {
  event: Event;
  interpolatedByEvent: Map<string, string[]>;
}) {
  // For interpolate_bads, the params are empty by design — what
  // matters is which channels were bad at that point. Show that
  // explicitly so the user sees what the operation actually did.
  const interpolated =
    event.op === "interpolate_bads" ? interpolatedByEvent.get(event.id) : undefined;
  return (
    <div className="mt-1 mb-1 rounded border border-zinc-800 bg-zinc-900/50 p-2 text-[10px]">
      <div className="mb-1 text-[9px] text-zinc-600">{new Date(event.ts).toLocaleString()}</div>
      <div className="mb-1 text-[9px] text-zinc-600">
        id <span className="font-mono">{event.id.slice(0, 8)}</span>
      </div>
      {interpolated !== undefined && (
        <div className="mb-2">
          <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-500">
            interpolated channels ({interpolated.length})
          </div>
          {interpolated.length === 0 ? (
            <div className="text-[10px] text-zinc-600">none — no bads were marked</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {interpolated.map((ch) => (
                <span
                  key={ch}
                  className="rounded bg-cyan-900/60 px-1.5 py-0.5 font-mono text-[10px] text-cyan-100"
                >
                  {ch}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <pre className="overflow-x-auto rounded bg-zinc-950 p-1.5 font-mono text-[10px] leading-tight text-zinc-300">
        {JSON.stringify(event.params, null, 2)}
      </pre>
    </div>
  );
}
