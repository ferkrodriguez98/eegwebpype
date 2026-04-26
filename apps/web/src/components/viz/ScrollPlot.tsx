"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";

type Props = {
  times: Float32Array;
  channels: { name: string; data: Float32Array }[];
  height?: number;
  /** Channels currently flagged as bad (rendered greyed-out). */
  badChannels?: Set<string>;
  /** Click on a channel name to toggle bad. */
  onToggleBad?: (channel: string) => void;
  /** When the user wheels horizontally over the plot, advance the parent's
   * window by `deltaSeconds` (positive = forward). The parent decides how
   * much to step. Without a modifier, wheel = pan in time. With Cmd/Ctrl,
   * wheel = zoom (handled internally on the plot scale). */
  onPan?: (deltaSeconds: number) => void;
};

// Distinct hues for unrelated channels; we round-robin through this list.
const PALETTE = [
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#f472b6",
  "#22d3ee",
  "#facc15",
];

const LABEL_WIDTH = 64;
// Vertical separation between adjacent channel rows, expressed in units of
// "median per-channel std". Bigger => more breathing room, smaller => denser.
const ROW_STEP = 6;

/** Normalize a channel by subtracting its mean and dividing by its std.
 * The result has zero mean and unit variance, so different channels with
 * wildly different scales (volts vs microvolts) all stack consistently. */
function normalize(arr: Float32Array): { values: Float32Array; std: number } {
  const n = arr.length;
  if (n === 0) return { values: new Float32Array(0), std: 1 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += arr[i] ?? 0;
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = (arr[i] ?? 0) - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n) || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ((arr[i] ?? 0) - mean) / std;
  return { values: out, std };
}

export function ScrollPlot({
  times,
  channels,
  height = 600,
  badChannels,
  onToggleBad,
  onPan,
}: Props) {
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    channel: string;
    time: number;
    value: number;
    std: number;
  } | null>(null);

  // Normalized per-channel arrays. These have unit variance, so stacking
  // works regardless of input units. We still keep the channel's std around
  // to display real-units values in the tooltip.
  const normalized = useMemo(
    () => channels.map((ch) => ({ name: ch.name, ...normalize(ch.data) })),
    [channels],
  );

  const { data, channelOffsets } = useMemo(() => {
    const x: number[] = Array.from(times);
    const offsets: number[] = [];
    const ys: number[][] = normalized.map((ch, i) => {
      // Highest channel at top, lowest at bottom: row 0 → highest offset.
      const offset = (normalized.length - 1 - i) * ROW_STEP;
      offsets.push(offset);
      const out = new Array<number>(ch.values.length);
      for (let j = 0; j < ch.values.length; j++) out[j] = (ch.values[j] ?? 0) + offset;
      return out;
    });
    return { data: [x, ...ys] as AlignedData, channelOffsets: offsets };
  }, [times, normalized]);

  const yMin = -ROW_STEP;
  const yMax = (normalized.length - 1) * ROW_STEP + ROW_STEP;

  useEffect(() => {
    const el = plotContainerRef.current;
    if (!el) return;
    if (channels.length === 0) return;

    const opts: Options = {
      width: el.clientWidth,
      height,
      padding: [10, 10, 10, 0],
      cursor: {
        drag: { x: false, y: false },
        focus: { prox: 30 },
        // Disable the default crosshair points on every series; we draw our
        // own single dot for the focused channel only.
        points: { show: false },
      },
      legend: { show: false },
      scales: {
        x: { time: false },
        // Pin the y-scale to a known range so all channels are evenly spaced
        // even if some have lower variance than others.
        y: { auto: false, range: () => [yMin, yMax] },
      },
      axes: [
        { stroke: "#a1a1aa" },
        { stroke: "#a1a1aa", grid: { stroke: "#27272a" }, show: false },
      ],
      series: [
        {},
        ...normalized.map((ch, i) => {
          const isBad = badChannels?.has(ch.name);
          const isHov = ch.name === hoveredChannel;
          let stroke: string;
          if (isBad) stroke = "#3f3f46";
          else if (isHov) stroke = "#fafafa";
          else stroke = PALETTE[i % PALETTE.length] ?? "#a78bfa";
          return {
            label: ch.name,
            stroke,
            width: isBad ? 0.7 : isHov ? 1.6 : 0.9,
            points: { show: false },
          };
        }),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? -1;
            const idx = u.cursor.idx;
            if (left < 0 || top < 0 || idx == null) {
              setTooltip(null);
              setHoveredChannel(null);
              return;
            }
            // Find the channel whose row offset is closest to the cursor's y-value.
            const yVal = u.posToVal(top, "y");
            let bestI = 0;
            let bestD = Number.POSITIVE_INFINITY;
            for (let i = 0; i < channelOffsets.length; i++) {
              const d = Math.abs((channelOffsets[i] ?? 0) - yVal);
              if (d < bestD) {
                bestD = d;
                bestI = i;
              }
            }
            const ch = normalized[bestI];
            if (!ch) {
              setTooltip(null);
              return;
            }
            const t = (times[idx] as number | undefined) ?? 0;
            const vNorm = (ch.values[idx] as number | undefined) ?? 0;
            const realValue = vNorm * ch.std;
            setHoveredChannel(ch.name);
            setTooltip({
              x: left,
              y: top,
              channel: ch.name,
              time: t,
              value: realValue,
              std: ch.std,
            });
          },
        ],
      },
    };

    const plot = new uPlot(opts, data, el);
    plotRef.current = plot;

    // Wheel on the plot:
    // - With Cmd/Ctrl: zoom the X axis around the cursor (in-plot scale).
    // - Without modifier: pan the parent's time window via onPan(seconds).
    // Either way the page never scrolls when the cursor is over the plot.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        const { left } = el.getBoundingClientRect();
        const cx = e.clientX - left;
        const factor = e.deltaY < 0 ? 0.85 : 1.15;
        const xRange = plot.scales.x;
        if (!xRange || xRange.min == null || xRange.max == null) return;
        const valAt = plot.posToVal(cx, "x");
        const newMin = valAt - (valAt - xRange.min) * factor;
        const newMax = valAt + (xRange.max - valAt) * factor;
        plot.setScale("x", { min: newMin, max: newMax });
        return;
      }
      // Plain wheel = pan in seconds. deltaY positive (scroll down) goes
      // forward in time. We translate pixel deltas into seconds using the
      // plot's current x range so the gesture feels proportional.
      if (!onPan) return;
      const xRange = plot.scales.x;
      if (!xRange || xRange.min == null || xRange.max == null) return;
      const span = xRange.max - xRange.min;
      const delta = (e.deltaY / 200) * span;
      onPan(delta);
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    const onResize = () => plot.setSize({ width: el.clientWidth, height });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      el.removeEventListener("wheel", onWheel);
      plot.destroy();
      plotRef.current = null;
    };
  }, [
    data,
    normalized,
    channels.length,
    channelOffsets,
    times,
    height,
    badChannels,
    hoveredChannel,
    yMin,
    yMax,
    onPan,
  ]);

  // Compute the screen-space Y position of each channel label.
  const [labelPositions, setLabelPositions] = useState<{ name: string; top: number }[]>([]);

  useEffect(() => {
    const update = () => {
      const plot = plotRef.current;
      if (!plot) return;
      const positions: { name: string; top: number }[] = [];
      for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (!ch) continue;
        const offset = channelOffsets[i] ?? 0;
        const top = plot.valToPos(offset, "y", false);
        if (!Number.isFinite(top)) continue;
        positions.push({ name: ch.name, top });
      }
      setLabelPositions(positions);
    };

    // Try a few frames in a row; uPlot finishes its first layout async.
    const handles = [
      requestAnimationFrame(update),
      requestAnimationFrame(() => requestAnimationFrame(update)),
    ];
    const t = setTimeout(update, 80);

    const el = plotContainerRef.current;
    el?.addEventListener("mousemove", update);
    window.addEventListener("resize", update);
    return () => {
      for (const h of handles) cancelAnimationFrame(h);
      clearTimeout(t);
      el?.removeEventListener("mousemove", update);
      window.removeEventListener("resize", update);
    };
  }, [normalized, channelOffsets]);

  return (
    <div className="relative w-full" style={{ paddingLeft: LABEL_WIDTH }}>
      <div ref={plotContainerRef} className="w-full select-none" />
      {/* Channel labels gutter on the left, clickable to toggle bad. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 font-mono text-[10px]"
        style={{ width: LABEL_WIDTH }}
      >
        {labelPositions.map(({ name, top }) => {
          const isBad = badChannels?.has(name);
          const isHov = name === hoveredChannel;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggleBad?.(name)}
              onMouseEnter={() => setHoveredChannel(name)}
              onMouseLeave={() => setHoveredChannel((c) => (c === name ? null : c))}
              disabled={!onToggleBad}
              className={`pointer-events-auto absolute right-1 -translate-y-1/2 px-1 py-0.5 transition ${
                isBad ? "text-zinc-600 line-through" : isHov ? "text-zinc-100" : "text-zinc-400"
              } ${onToggleBad ? "cursor-pointer hover:text-red-400" : ""}`}
              style={{ top }}
              title={onToggleBad ? `click to ${isBad ? "unmark" : "mark"} ${name} as bad` : name}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Floating tooltip with the focused channel's value at the cursor. */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-zinc-700 bg-zinc-950/95 p-2 font-mono text-[10px] text-zinc-100 shadow-lg"
          style={{
            left: tooltip.x + LABEL_WIDTH + 12,
            top: Math.max(0, tooltip.y - 30),
          }}
        >
          <div className="mb-0.5 text-zinc-400">
            {tooltip.channel} · {tooltip.time.toFixed(3)} s
          </div>
          <div className="text-zinc-100">{(tooltip.value * 1e6).toFixed(1)} µV</div>
        </div>
      )}
    </div>
  );
}
