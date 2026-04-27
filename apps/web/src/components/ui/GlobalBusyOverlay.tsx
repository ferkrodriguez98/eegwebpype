"use client";

import { setBusyProgress, useBusyProgress } from "@/lib/busy";
import { useMutationState } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  /** Minimum time (ms) a mutation must be running before the overlay
   * appears. Prevents a flash on near-instant mutations like
   * mark/unmark which complete in <50 ms. */
  minDelayMs?: number;
};

// Friendly labels for each event op. Anything not listed falls back to
// the raw op name (so we never lie if a new op type is added).
const OP_LABELS: Record<string, string> = {
  load: "loading recording",
  drop_channels: "dropping channels",
  set_montage: "applying montage",
  resample: "resampling — this can take a few minutes",
  filter: "applying filter",
  mark_bad: "marking channel",
  unmark_bad: "unmarking channel",
  fit_ica: "fitting ICA",
  label_ica: "labeling ICA components",
  exclude_ica: "excluding ICA components",
  apply_ica: "applying ICA",
  interpolate_bads: "interpolating bad channels",
  set_reference: "setting reference",
  epoch: "creating epochs",
  reject_epochs: "rejecting epochs",
  export: "exporting",
};

type EventInputLike = { op?: string };

/** Full-screen blocking overlay shown while any TanStack Query mutation
 * is in flight. Used for slow ops like `resample`, `filter`, `fit_ica`,
 * etc. that take many seconds and must not be interrupted by other
 * concurrent actions. The label is derived from the mutation's payload
 * (an EventInput) when available. */
export function GlobalBusyOverlay({ minDelayMs = 250 }: Props) {
  // Pull all currently-running mutations and their submitted variables.
  // We use the most recently started one to label the overlay.
  const pending = useMutationState({
    filters: { status: "pending" },
    select: (m) => m.state.variables as EventInputLike | undefined,
  });
  const progress = useBusyProgress();
  // The overlay is visible if there's either an active mutation OR an
  // explicit progress event (e.g. ICA WebSocket fits don't go through
  // useMutation but still want to block the UI).
  const isBusy = pending.length > 0 || progress != null;
  const latestOp = pending.length > 0 ? pending[pending.length - 1]?.op : undefined;
  // The progress phase wins over the mutation op label, since it's
  // more specific (e.g. "fitting" vs the generic "fit_ica").
  const label = progress?.phase
    ? progress.phase
    : latestOp
      ? (OP_LABELS[latestOp] ?? latestOp)
      : "processing…";
  const fraction = progress?.fraction;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isBusy) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), minDelayMs);
    return () => clearTimeout(t);
  }, [isBusy, minDelayMs]);

  if (!visible) return null;

  // The "done" state: progress reached 100% AND the caller asked for an
  // explicit ack. We swap the spinner for a check, fill the bar, and
  // surface an OK button. Until the user clicks it, the overlay stays.
  const isDone = progress?.requiresAck === true && fraction !== undefined && fraction >= 1 - 1e-6;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: not a button/region
      role="status"
      aria-live="polite"
      aria-busy={!isDone}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      {/* Compact card: tight stack of icon + label/percent + bar +
       * footer (caption while busy, OK button when done). Same width
       * always; the footer slot keeps height consistent so the modal
       * doesn't jump between states. */}
      <div
        style={{ width: 320 }}
        className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          {isDone ? (
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-400" />
          ) : (
            <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-emerald-400" />
          )}
          <span className="flex-1 break-words font-mono text-sm leading-tight text-zinc-100">
            {isDone ? "done" : label}
          </span>
          {fraction !== undefined && (
            <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-zinc-400">
              {Math.round(fraction * 100)}%
            </span>
          )}
        </div>
        <div className="h-1 w-full overflow-hidden rounded bg-zinc-900">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-200"
            style={{
              width: fraction !== undefined ? `${Math.max(0, Math.min(1, fraction)) * 100}%` : "0%",
            }}
          />
        </div>
        {/* Fixed-height footer slot: 32px tall holds either caption text
         * or the OK button without changing the card's overall height. */}
        <div className="flex h-8 items-center justify-center">
          {isDone ? (
            <button
              type="button"
              onClick={() => setBusyProgress(null)}
              className="rounded border border-emerald-700 bg-emerald-900/40 px-6 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-800/60"
            >
              OK
            </button>
          ) : (
            <span className="text-center text-[10px] text-zinc-500">
              please wait — closing this window will not cancel the operation
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
