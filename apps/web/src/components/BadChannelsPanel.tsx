"use client";

import { Topomap } from "@/components/viz/Topomap";
import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import type { ChannelDetection, DetectorReason, SessionState } from "@eegwebpype/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Info, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";

const REASON_LABEL: Record<DetectorReason, string> = {
  auto_power: "power",
  auto_shape: "shape",
  auto_neighbors: "nbrs",
};

const REASON_COLOR: Record<DetectorReason, string> = {
  auto_power: "bg-amber-700",
  auto_shape: "bg-fuchsia-700",
  auto_neighbors: "bg-cyan-700",
};

type SortKey = "channel" | "pot_z" | "shape_dev_db" | "neighbor_corr";

function badsFromState(state: SessionState | undefined): Set<string> {
  if (!state) return new Set();
  const bads = new Set<string>();
  for (const ev of state.events) {
    if (ev.op === "mark_bad") {
      for (const c of ev.params.channels) bads.add(c);
    } else if (ev.op === "unmark_bad") {
      for (const c of ev.params.channels) bads.delete(c);
    } else if (ev.op === "interpolate_bads") {
      bads.clear();
    }
  }
  return bads;
}

function MetricBar({
  value,
  max,
  invert,
  highlight,
  unavailable,
}: {
  value: number;
  max: number;
  invert?: boolean;
  highlight?: boolean;
  unavailable?: boolean;
}) {
  if (unavailable) {
    return <span className="font-mono text-[10px] text-zinc-600">n/a</span>;
  }
  const t = Math.max(0, Math.min(1, max > 0 ? Math.abs(value) / max : 0));
  const display = invert ? 1 - t : t;
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-300">
      <div className="relative h-1 w-16 overflow-hidden rounded bg-zinc-900">
        <div
          className={`absolute inset-y-0 left-0 ${highlight ? "bg-emerald-400" : "bg-zinc-500"}`}
          style={{ width: `${display * 100}%` }}
        />
      </div>
      <span className="w-10 text-right tabular-nums text-zinc-400">{value.toFixed(2)}</span>
    </div>
  );
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

  // Threshold knobs for the detector. Backend defaults are mirrored here.
  const [madK, setMadK] = useState(4.0);
  const [potZ, setPotZ] = useState(8.0);
  const [nbrThr, setNbrThr] = useState(0.4);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const detect = useMutation({
    mutationFn: () =>
      api.detectBadChannels(sessionId, {
        mad_k: madK,
        pot_z_extreme: potZ,
        neighbor_corr_thr: nbrThr,
      }),
  });

  const detections: ChannelDetection[] = detect.data?.detections ?? [];

  const [sortBy, setSortBy] = useState<SortKey>("shape_dev_db");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const arr = [...detections];
    arr.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortBy === "channel") return a.channel.localeCompare(b.channel) * dir;
      const av = a[sortBy] as number;
      const bv = b[sortBy] as number;
      return (av - bv) * dir;
    });
    return arr;
  }, [detections, sortBy, sortDir]);

  const ranges = useMemo(() => {
    if (detections.length === 0) {
      return { pot_z: 1, shape_dev_db: 1 };
    }
    return {
      pot_z: Math.max(...detections.map((d) => d.pot_z), 1),
      shape_dev_db: Math.max(...detections.map((d) => d.shape_dev_db), 1),
    };
  }, [detections]);

  const bads = useMemo(() => badsFromState(state), [state]);

  /** Re-run detection from scratch: clear any currently marked bads first,
   * then re-fetch. The user explicitly asked for this so the run is idempotent. */
  const onRunAutoDetect = () => {
    if (bads.size > 0) {
      append.mutate({ op: "unmark_bad", params: { channels: Array.from(bads) } });
    }
    detect.mutate();
  };

  const onAutoApply = () => {
    if (detections.length === 0) return;
    const channels = detections.map((d) => d.channel);
    append.mutate(
      { op: "mark_bad", params: { channels, reason: "manual" } },
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

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "channel" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
    >
      {label}
      {sortBy === k && (sortDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRunAutoDetect}
            disabled={detect.isPending || append.isPending}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            {detect.isPending ? "detecting…" : "auto-detect"}
          </button>
          <button
            type="button"
            onClick={onAutoApply}
            disabled={detections.length === 0 || append.isPending}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            apply detected ({detections.length})
          </button>
          <span className="text-xs text-zinc-500">{bads.size} marked</span>
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-pressed={helpOpen}
              className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
            >
              <Info size={11} />
              what is this?
            </button>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-pressed={advancedOpen}
              className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
            >
              <Settings2 size={11} />
              thresholds
            </button>
          </div>
        </div>

        {helpOpen && (
          <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
              what each metric means
            </div>
            <ul className="flex flex-col gap-1.5">
              <li>
                <span className="mr-1.5 rounded bg-amber-700 px-1 text-[9px] uppercase">power</span>
                channel total power deviates by more than{" "}
                <span className="font-mono text-zinc-100">pot_z_extreme</span> from the median
                across channels (z-score using MAD).
              </li>
              <li>
                <span className="mr-1.5 rounded bg-fuchsia-700 px-1 text-[9px] uppercase">
                  shape
                </span>
                the shape of the channel's log-PSD deviates from the median curve. RMS difference
                threshold is <span className="font-mono text-zinc-100">median + mad_k × MAD</span>.
              </li>
              <li>
                <span className="mr-1.5 rounded bg-cyan-700 px-1 text-[9px] uppercase">nbrs</span>
                signal correlates poorly (&lt;{" "}
                <span className="font-mono text-zinc-100">neighbor_corr_thr</span>) with its spatial
                nearest neighbors. Requires a montage so positions are known.
              </li>
            </ul>
            <p className="mt-2 text-[10px] text-zinc-500">
              A channel is flagged if it triggers any of the three. Re-running auto-detect clears
              all previous manual marks first.
            </p>
          </div>
        )}

        {advancedOpen && (
          <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                detector thresholds
              </span>
              <button
                type="button"
                onClick={() => {
                  setMadK(4);
                  setPotZ(8);
                  setNbrThr(0.4);
                }}
                className="text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                reset defaults
              </button>
            </div>
            <ThresholdSlider
              label="mad_k (shape MAD multiplier)"
              value={madK}
              min={1}
              max={10}
              step={0.1}
              onChange={setMadK}
            />
            <ThresholdSlider
              label="pot_z_extreme (power z-MAD threshold)"
              value={potZ}
              min={1}
              max={50}
              step={0.5}
              onChange={setPotZ}
            />
            <ThresholdSlider
              label="neighbor_corr_thr"
              value={nbrThr}
              min={0}
              max={1}
              step={0.01}
              onChange={setNbrThr}
            />
            <p className="mt-2 text-[10px] text-zinc-500">click "auto-detect" to apply.</p>
          </div>
        )}

        <div className="rounded border border-zinc-800 bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="text-xs uppercase tracking-wider text-zinc-500">detected</span>
            <span className="text-[10px] text-zinc-600">
              hover to highlight on topomap · click to mark
            </span>
          </div>

          {detect.data ? (
            detections.length === 0 ? (
              <p className="px-3 py-3 text-xs text-zinc-500">
                no suspicious channels at the current thresholds
              </p>
            ) : (
              <div className="max-h-[460px] overflow-y-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-zinc-950">
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-1.5 text-left">
                        <SortHeader label="channel" k="channel" />
                      </th>
                      <th className="px-3 py-1.5 text-left">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                          reasons
                        </span>
                      </th>
                      <th className="px-3 py-1.5 text-left">
                        <SortHeader label="pot_z" k="pot_z" />
                      </th>
                      <th className="px-3 py-1.5 text-left">
                        <SortHeader label="shape (dB)" k="shape_dev_db" />
                      </th>
                      <th className="px-3 py-1.5 text-left">
                        <SortHeader label="nbr corr" k="neighbor_corr" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((d) => {
                      const isBad = bads.has(d.channel);
                      const isSel = selected === d.channel;
                      const nbrUnavailable = d.neighbor_corr < 0;
                      return (
                        <tr
                          key={d.channel}
                          onMouseEnter={() => onSelect(d.channel)}
                          onMouseLeave={() => onSelect(null)}
                          onClick={() => onToggleBad(d.channel)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onToggleBad(d.channel);
                            }
                          }}
                          tabIndex={0}
                          className={`cursor-pointer border-b border-zinc-900 transition focus:outline focus:outline-1 focus:outline-emerald-400 ${
                            isSel ? "bg-zinc-900" : "hover:bg-zinc-900/60"
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono ${
                                isBad ? "bg-red-900 text-red-100" : "bg-zinc-800 text-zinc-100"
                              }`}
                            >
                              {d.channel}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="inline-flex gap-0.5">
                              {d.reasons.map((r) => (
                                <span
                                  key={r}
                                  className={`rounded px-1 text-[9px] uppercase ${REASON_COLOR[r]}`}
                                >
                                  {REASON_LABEL[r]}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <MetricBar
                              value={d.pot_z}
                              max={ranges.pot_z}
                              highlight={d.reasons.includes("auto_power")}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <MetricBar
                              value={d.shape_dev_db}
                              max={ranges.shape_dev_db}
                              highlight={d.reasons.includes("auto_shape")}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <MetricBar
                              value={d.neighbor_corr}
                              max={1}
                              invert
                              highlight={d.reasons.includes("auto_neighbors")}
                              unavailable={nbrUnavailable}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <p className="px-3 py-3 text-xs text-zinc-600">
              click "auto-detect" to run the 3 metrics.
            </p>
          )}
        </div>

        <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">marked</div>
          {bads.size === 0 ? (
            <p className="text-xs text-zinc-600">none marked</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {Array.from(bads).map((ch) => (
                <li key={ch}>
                  <button
                    type="button"
                    onClick={() => onToggleBad(ch)}
                    onMouseEnter={() => onSelect(ch)}
                    onMouseLeave={() => onSelect(null)}
                    className="rounded bg-red-900 px-2 py-0.5 font-mono text-xs text-red-100 hover:bg-red-800"
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
          topomap · shape deviation
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

function ThresholdSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="mb-2 flex flex-col gap-1 text-[11px] text-zinc-400">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-zinc-200">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="accent-emerald-500"
      />
    </label>
  );
}
