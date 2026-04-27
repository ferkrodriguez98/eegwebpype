"use client";

import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api/client";
import { setBusyProgress } from "@/lib/busy";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import { usePersistedState } from "@/lib/hooks/usePersistedState";
import type { ICAComponent } from "@eegwebpype/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Eye, Heart, HelpCircle, Loader2, Play, Wand2, Zap } from "lucide-react";
import { useMemo, useState } from "react";

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

// Each ICLabel class gets its own colour so the grouping reads at a
// glance. Tailwind classes for badge bg/text plus an explicit hex used
// by the trace polyline (where we can't use Tailwind tokens).
type LabelStyle = {
  badge: string; // bg + text classes for the pill
  bar: string; // bg class for the progress bar fill
  trace: string; // hex for the SVG polyline stroke
  ring: string; // border tint for the card itself
};

const LABEL_STYLE: Record<string, LabelStyle> = {
  brain: {
    badge: "bg-emerald-900 text-emerald-100",
    bar: "bg-emerald-500",
    trace: "#34d399",
    ring: "border-emerald-900",
  },
  "eye blink": {
    badge: "bg-amber-900 text-amber-100",
    bar: "bg-amber-500",
    trace: "#fbbf24",
    ring: "border-amber-900",
  },
  eye: {
    badge: "bg-amber-900 text-amber-100",
    bar: "bg-amber-500",
    trace: "#fbbf24",
    ring: "border-amber-900",
  },
  muscle: {
    badge: "bg-rose-900 text-rose-100",
    bar: "bg-rose-500",
    trace: "#fb7185",
    ring: "border-rose-900",
  },
  "muscle artifact": {
    badge: "bg-rose-900 text-rose-100",
    bar: "bg-rose-500",
    trace: "#fb7185",
    ring: "border-rose-900",
  },
  heart: {
    badge: "bg-pink-900 text-pink-100",
    bar: "bg-pink-500",
    trace: "#f472b6",
    ring: "border-pink-900",
  },
  "channel noise": {
    badge: "bg-cyan-900 text-cyan-100",
    bar: "bg-cyan-500",
    trace: "#22d3ee",
    ring: "border-cyan-900",
  },
  "line noise": {
    badge: "bg-violet-900 text-violet-100",
    bar: "bg-violet-500",
    trace: "#a78bfa",
    ring: "border-violet-900",
  },
  other: {
    badge: "bg-zinc-800 text-zinc-200",
    bar: "bg-zinc-500",
    trace: "#a1a1aa",
    ring: "border-zinc-800",
  },
  unknown: {
    badge: "bg-zinc-800 text-zinc-400",
    bar: "bg-zinc-600",
    trace: "#71717a",
    ring: "border-zinc-800",
  },
};

const FALLBACK_STYLE: LabelStyle = {
  badge: "bg-zinc-800 text-zinc-300",
  bar: "bg-zinc-500",
  trace: "#a1a1aa",
  ring: "border-zinc-800",
};

function labelIcon(label: string): typeof Brain {
  return LABEL_ICON[label.toLowerCase()] ?? HelpCircle;
}

function labelStyle(label: string): LabelStyle {
  return LABEL_STYLE[label.toLowerCase()] ?? FALLBACK_STYLE;
}

// Display order: brain first (good), then artefact classes, then misc.
const LABEL_ORDER = [
  "brain",
  "eye",
  "eye blink",
  "muscle",
  "muscle artifact",
  "heart",
  "line noise",
  "channel noise",
  "other",
  "unknown",
];

function compareLabels(a: string, b: string): number {
  const ia = LABEL_ORDER.indexOf(a.toLowerCase());
  const ib = LABEL_ORDER.indexOf(b.toLowerCase());
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
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
  const style = labelStyle(comp.label);
  // ICA components carry arbitrary DC offsets (often hundreds of
  // units away from zero) so we can't just divide by the absolute
  // max — the trace would render as a flat line at the bottom of
  // the SVG. Center on the median and scale by the peak deviation
  // so the sparkline always uses the full vertical extent of the
  // little canvas.
  const seriesMin = Math.min(...comp.series);
  const seriesMax = Math.max(...comp.series);
  const seriesMid = (seriesMin + seriesMax) / 2;
  const seriesHalfRange = (seriesMax - seriesMin) / 2 || 1;
  const probPct = Math.round(comp.prob * 100);

  return (
    <button
      type="button"
      onClick={onToggle}
      // Default: no border (the previous border-zinc-700 looked like a
      // selection state). Excluded gets a red border to mean "marked
      // for removal". The class colour shows up on the trace and bar.
      className={`flex w-full flex-col gap-1.5 rounded p-3 text-left transition ${
        excluded
          ? "bg-red-950/40 ring-1 ring-red-700 opacity-80"
          : "bg-zinc-900 hover:bg-zinc-800/80"
      }`}
    >
      {/* Top row: index on the left, classification badge pinned to
       * the top-right. `ml-auto` on the badge guarantees it floats
       * right even when the card is narrow. */}
      <div className="flex w-full items-start gap-2 text-xs">
        <span className="font-mono text-zinc-300">IC{comp.index.toString().padStart(2, "0")}</span>
        <span
          className={`ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${style.badge}`}
        >
          <Icon size={10} />
          {comp.label}
        </span>
      </div>

      <svg viewBox="0 0 100 30" className="h-8 w-full">
        <title>IC{comp.index} series</title>
        <polyline
          fill="none"
          stroke={excluded ? "#7f1d1d" : style.trace}
          strokeWidth="0.7"
          points={comp.series
            .map((v, i) => {
              const x = (i / Math.max(1, comp.series.length - 1)) * 100;
              // Center on the median, then scale: a value at the top
              // of the range maps to y=3, bottom to y=27 (canvas is
              // viewBox 0..30, midline is 15, ±12px headroom).
              const norm = (v - seriesMid) / seriesHalfRange;
              const y = 15 - norm * 12;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ")}
        />
      </svg>

      {/* Probability bar at the bottom of the card. Top row: "PROB"
       * label on the left, percentage on the right. Below that a
       * full-width track with colour-coded fill (green/amber/rose
       * by confidence). */}
      <div className="mt-1.5 flex w-full flex-col gap-1">
        <div className="flex w-full items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">prob</span>
          <span className="font-mono text-[10px] tabular-nums text-zinc-300">{probPct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, probPct))}%`,
              backgroundColor: probabilityColor(probPct),
            }}
          />
        </div>
      </div>
    </button>
  );
}

/** Empty placeholder card, shown before any fit has run. Mirrors the
 * shape of `ComponentCard` (header row, sparkline area, prob bar) so
 * the layout doesn't shift when real data replaces the placeholders.
 * When `working=true` (a fit is running), the inner blocks pulse and
 * the prob bar runs an indeterminate shimmer so the user can tell the
 * cards are not just static.
 */
function PlaceholderCard({ index, working }: { index: number; working?: boolean }) {
  const pulse = working ? "animate-pulse" : "";
  return (
    <div
      className={`flex w-full flex-col gap-1.5 rounded bg-zinc-900/60 p-3 ${
        working ? "opacity-90" : "opacity-60"
      }`}
    >
      <div className="flex w-full items-start gap-2 text-xs">
        <span className="font-mono text-zinc-500">IC{index.toString().padStart(2, "0")}</span>
        <span className={`ml-auto h-4 w-14 rounded bg-zinc-800 ${pulse}`} />
      </div>
      <div className={`h-8 w-full rounded bg-zinc-950/40 ${pulse}`} />
      <div className="mt-1.5 flex w-full flex-col gap-1">
        <div className="flex w-full items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">prob</span>
          <span className="font-mono text-[10px] text-zinc-600">—</span>
        </div>
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          {working && (
            // Indeterminate shimmer: a 30%-wide emerald sliver slides
            // across the track while the fit is in progress.
            <div className="absolute inset-y-0 w-1/3 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-emerald-500/40" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline hex for the probability bar fill, by confidence band.
 * Using `style={{ backgroundColor }}` instead of a Tailwind class so
 * the colour applies regardless of JIT class detection / browser CSS
 * caching after recent edits. Tones match emerald-500 / amber-500 /
 * rose-500 from the Tailwind palette. */
function probabilityColor(pct: number): string {
  if (pct >= 80) return "#10b981"; // emerald-500
  if (pct >= 50) return "#f59e0b"; // amber-500
  return "#f43f5e"; // rose-500
}

function ComponentGroups({
  components,
  excluded,
  onToggleExclude,
  onSelectMany,
}: {
  components: ICAComponent[];
  excluded: Set<number>;
  onToggleExclude: (index: number) => void;
  onSelectMany: (indices: number[], select: boolean) => void;
}) {
  // Group components by their predicted label, preserving the canonical
  // class order (brain → eye → muscle → ...). Components within a group
  // are sorted by descending probability so the most confident ones
  // surface first.
  const groups = new Map<string, ICAComponent[]>();
  for (const c of components) {
    const key = c.label.toLowerCase();
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }
  const sortedKeys = Array.from(groups.keys()).sort(compareLabels);

  return (
    // Generous vertical gap between sections so each class group reads
    // as its own block instead of running into the next.
    <div className="flex flex-col gap-5">
      {sortedKeys.map((key) => {
        const items = (groups.get(key) ?? []).slice().sort((a, b) => b.prob - a.prob);
        const style = labelStyle(key);
        const Icon = labelIcon(key);
        const indices = items.map((c) => c.index);
        const allSelected = indices.every((i) => excluded.has(i));
        const someSelected = indices.some((i) => excluded.has(i));
        return (
          // Tight but breathing: a small gap above (`pt-1`) keeps
          // the header off the previous group's last card,
          // `gap-3` separates header / separator from the cards
          // below, and `pb-2` below the header keeps the badge
          // off the line.
          <section key={key} className="flex flex-col gap-3 pt-1">
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
              <span
                className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] uppercase tracking-wider ${style.badge}`}
              >
                <Icon size={11} />
                {key}
              </span>
              <span className="text-[11px] text-zinc-500">{items.length}</span>
              <div className="ml-auto flex items-center gap-1.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => onSelectMany(indices, true)}
                  disabled={allSelected}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  exclude all
                </button>
                <button
                  type="button"
                  onClick={() => onSelectMany(indices, false)}
                  disabled={!someSelected}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {items.map((c) => (
                <ComponentCard
                  key={c.index}
                  comp={c}
                  excluded={excluded.has(c.index)}
                  onToggle={() => onToggleExclude(c.index)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function ICAPanel({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const append = useAppendEvent(sessionId);

  // Three pieces of UI state are persisted to localStorage so they
  // survive page reloads (we don't have a DB for transactional UI
  // selections — only the event log lives on disk):
  //   - `n`: chosen n_components for the next fit
  //   - `excludedArr`: indices marked for exclusion before applying
  //   - `fitAttempted`: whether the user has fitted at least once
  const [n, writeN] = usePersistedState<number>(sessionId, "ica-n", 20);
  const [excludedArr, setExcludedArr] = usePersistedState<number[]>(sessionId, "ica-excluded", []);
  const excluded = useMemo(() => new Set<number>(excludedArr), [excludedArr]);
  const setExcluded = (updater: (prev: Set<number>) => Set<number>) => {
    setExcludedArr((curr) => Array.from(updater(new Set(curr))));
  };
  const [fitAttempted, setFitAttempted] = usePersistedState<boolean>(
    sessionId,
    "ica-fit-attempted",
    false,
  );

  // Pending n_components value while the confirmation modal is open.
  // Null when no confirmation is in progress.
  const [pendingN, setPendingN] = useState<number | null>(null);

  const confirmNChange = () => {
    if (pendingN == null) return;
    writeN(pendingN);
    // Reset everything that depends on the old fit.
    setFitAttempted(false);
    qc.removeQueries({ queryKey: ["ica-components", sessionId] });
    setExcludedArr([]);
    setPendingN(null);
  };

  const cancelNChange = () => {
    setPendingN(null);
  };

  const components = useQuery({
    queryKey: ["ica-components", sessionId],
    queryFn: () => api.icaComponents(sessionId),
    retry: false,
    enabled: fitAttempted,
  });

  // Top-level setter for n_components. If there are real fitted
  // results visible OR a fit was attempted in this session, ask the
  // user to confirm — changing the count requires a re-fit and
  // throws away the existing components and exclusions. With only
  // placeholders showing, the change is harmless and applies
  // immediately.
  const setN = (next: number) => {
    if (next === n) return;
    const hasResults = fitAttempted || components.data != null;
    if (hasResults) {
      setPendingN(next);
      return;
    }
    writeN(next);
  };

  // ICA fits stream progress over WebSocket. We forward each phase
  // event into the global busy bus so the overlay can show the bar —
  // no in-panel duplicate UI. On success we leave the overlay at 100%
  // with `requiresAck: true` so the user explicitly closes it; that
  // way they actually notice the fit is done before navigating away.
  const fit = useMutation({
    mutationFn: () =>
      api.fitIcaWS(sessionId, n, (e) => setBusyProgress({ phase: e.phase, fraction: e.fraction })),
    onSuccess: () => {
      setBusyProgress({ phase: "ICA fitted", fraction: 1, requiresAck: true });
      setFitAttempted(true);
      qc.invalidateQueries({ queryKey: ["ica-components", sessionId] });
    },
    onError: () => setBusyProgress(null),
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
        {fit.error && <span className="text-xs text-red-400">{String(fit.error)}</span>}
      </div>

      {/* No data yet (either pre-fit, or post-fit error). Show N
       * placeholder cards so the user sees the shape of what the fit
       * is going to produce — same grid the real components will
       * occupy, just dimmed and empty. The IC count tracks the
       * current `n_components` so changing the input updates the
       * preview in real time. */}
      {!components.data && !fit.isPending && (
        <div className="flex flex-col gap-3">
          {fitAttempted && components.isError ? (
            <div className="rounded border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">
              Could not load components. Try fitting ICA again.
            </div>
          ) : (
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
              ICA not fitted yet. Showing a preview of{" "}
              <span className="font-mono text-zinc-200">{n}</span> empty components — click{" "}
              <span className="font-mono text-zinc-200">fit ICA</span> above to populate them.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: n }, (_, i) => {
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are pure indices, never reordered
              return <PlaceholderCard key={i} index={i} />;
            })}
          </div>
        </div>
      )}

      {components.data && (
        <ComponentGroups
          components={components.data.components}
          excluded={excluded}
          onToggleExclude={onToggleExclude}
          onSelectMany={(indices, select) =>
            setExcluded((prev) => {
              const next = new Set(prev);
              for (const i of indices) {
                if (select) next.add(i);
                else next.delete(i);
              }
              return next;
            })
          }
        />
      )}

      <Modal
        open={pendingN != null}
        onClose={cancelNChange}
        title="change n_components?"
        maxWidthClass="max-w-md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-zinc-300">
            Changing the number of components from{" "}
            <span className="font-mono text-zinc-100">{n}</span> to{" "}
            <span className="font-mono text-zinc-100">{pendingN}</span> will discard the current ICA
            fit and your selected exclusions. You'll need to run{" "}
            <span className="font-mono text-zinc-100">fit ICA</span> again afterwards.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={cancelNChange}
              className="rounded border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={confirmNChange}
              className="rounded border border-red-700 bg-red-900/40 px-4 py-1.5 text-xs text-red-100 hover:bg-red-800/60"
            >
              discard fit & change
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
