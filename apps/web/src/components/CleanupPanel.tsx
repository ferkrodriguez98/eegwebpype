"use client";

import { TimeScroller } from "@/components/TimeScroller";
import { setBusyProgress } from "@/lib/busy";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import type { SessionState } from "@eegwebpype/shared";
import { Anchor, Wand2 } from "lucide-react";
import { useMemo } from "react";

function badsFromState(state: SessionState | undefined): string[] {
  if (!state) return [];
  const bads = new Set<string>();
  for (const ev of state.events) {
    if (ev.op === "mark_bad") for (const c of ev.params.channels) bads.add(c);
    else if (ev.op === "unmark_bad") for (const c of ev.params.channels) bads.delete(c);
    else if (ev.op === "interpolate_bads") bads.clear();
  }
  return Array.from(bads);
}

function alreadyApplied(state: SessionState | undefined, op: string): boolean {
  if (!state) return false;
  return state.events.some((ev) => ev.op === op);
}

export function CleanupPanel({
  sessionId,
  state,
}: {
  sessionId: string;
  state: SessionState | undefined;
}) {
  const append = useAppendEvent(sessionId);
  const pending = useMemo(() => badsFromState(state), [state]);
  const bads = useMemo(() => new Set(pending), [pending]);
  const refDone = alreadyApplied(state, "set_reference");
  const duration = state?.metadata.duration_seconds ?? 0;

  // After each cleanup action, surface a "done" modal via the global
  // busy bus (with `requiresAck` so it stays until the user clicks OK).
  // The user otherwise has no clear feedback that the action ran —
  // the time-series preview updates but the mutation finishes in
  // ~100ms and there's no toast / status line.
  const interpolateCount = pending.length;
  const onInterpolate = () => {
    append.mutate(
      { op: "interpolate_bads", params: {} },
      {
        onSuccess: () => {
          setBusyProgress({
            phase: `interpolated ${interpolateCount} channel${interpolateCount === 1 ? "" : "s"}`,
            fraction: 1,
            requiresAck: true,
          });
        },
      },
    );
  };
  const onReference = () => {
    append.mutate(
      { op: "set_reference", params: { type: "average" } },
      {
        onSuccess: () => {
          setBusyProgress({
            phase: "average reference applied",
            fraction: 1,
            requiresAck: true,
          });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Two action panels side-by-side at 50/50 above the live
       * preview. Both inherit the same height so the two cards align
       * horizontally regardless of inner content. */}
      <div className="grid grid-cols-2 gap-4">
        <section className="flex flex-col rounded border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wand2 size={16} className="text-zinc-400" />
            <h3 className="text-sm uppercase tracking-wider text-zinc-300">
              spherical interpolation
            </h3>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            interpolate channels marked as bad from their neighbors. requires a montage.
          </p>
          <div className="mb-3 text-xs text-zinc-400">
            {pending.length > 0 ? (
              <>
                {pending.length} pending channels:{" "}
                <span className="font-mono text-red-300">{pending.join(", ")}</span>
              </>
            ) : (
              <span className="text-zinc-600">no bad channels pending</span>
            )}
          </div>
          <button
            type="button"
            onClick={onInterpolate}
            disabled={pending.length === 0 || append.isPending}
            className="mt-auto flex items-center gap-1.5 self-start rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            <Wand2 size={14} />
            interpolate {pending.length > 0 ? `(${pending.length})` : ""}
          </button>
        </section>

        <section className="flex flex-col rounded border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Anchor size={16} className="text-zinc-400" />
            <h3 className="text-sm uppercase tracking-wider text-zinc-300">average reference</h3>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            common average reference (CAR): the sum across channels at each timepoint becomes zero.
          </p>
          {pending.length > 0 && !refDone && (
            <p className="mb-2 text-xs text-amber-400">
              recommended: interpolate bad channels first to avoid contaminating the reference.
            </p>
          )}
          <button
            type="button"
            onClick={onReference}
            disabled={refDone || append.isPending}
            className="mt-auto flex items-center gap-1.5 self-start rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            <Anchor size={14} />
            {refDone ? "already applied" : "apply average reference"}
          </button>
        </section>
      </div>

      {/* Live preview using the same `<TimeScroller>` as the overview
       * tab so the user gets the full set of controls (window selector,
       * channel pager, slider) right where they're applying changes. */}
      <TimeScroller
        sessionId={sessionId}
        duration={duration}
        badChannels={bads}
        defaultHeight={500}
      />
    </div>
  );
}
