"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";

type Props = {
  times: Float32Array;
  channels: { name: string; data: Float32Array }[];
  height?: number;
  /** Vertical separation between channels in raw signal units (V). */
  spacing?: number;
  /** Channels currently flagged as bad (rendered greyed-out). */
  badChannels?: Set<string>;
  /** Click on a channel name to toggle bad. */
  onToggleBad?: (channel: string) => void;
};

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

export function ScrollPlot({
  times,
  channels,
  height = 600,
  spacing = 1.5e-4,
  badChannels,
  onToggleBad,
}: Props) {
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null);

  // Build the data once per [times, channels, spacing] tuple. The y-stacking
  // happens here so each channel sits on its own row.
  const { data, channelOffsets } = useMemo(() => {
    const x: number[] = Array.from(times);
    const offsets: number[] = [];
    const ys: number[][] = channels.map((ch, i) => {
      const offset = i * spacing;
      offsets.push(offset);
      const out = new Array<number>(ch.data.length);
      for (let j = 0; j < ch.data.length; j++) out[j] = (ch.data[j] ?? 0) + offset;
      return out;
    });
    return { data: [x, ...ys] as AlignedData, channelOffsets: offsets };
  }, [times, channels, spacing]);

  useEffect(() => {
    const el = plotContainerRef.current;
    if (!el) return;

    const opts: Options = {
      width: el.clientWidth,
      height,
      padding: [10, 10, 10, 0],
      cursor: {
        // Drag is disabled — selecting a range was confusing because there is
        // no "zoom out" button. Use the window slider above and Cmd+wheel to zoom.
        drag: { x: false, y: false },
        focus: { prox: 30 },
      },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [
        { stroke: "#a1a1aa" },
        // Hide the default y-axis ticks; channel names are rendered separately.
        { stroke: "#a1a1aa", grid: { stroke: "#27272a" }, show: false },
      ],
      series: [
        {},
        ...channels.map((ch, i) => {
          const isBad = badChannels?.has(ch.name);
          const isHov = ch.name === hoveredChannel;
          let stroke: string;
          if (isBad) stroke = "#3f3f46";
          else if (isHov) stroke = "#fafafa";
          else stroke = PALETTE[i % PALETTE.length] ?? "#a78bfa";
          return {
            label: ch.name,
            stroke,
            width: isBad ? 0.7 : isHov ? 1.6 : 1,
            points: { show: false },
          };
        }),
      ],
    };

    const plot = new uPlot(opts, data, el);
    plotRef.current = plot;

    // Mouse-wheel zoom on the X axis, but ONLY when a modifier is held
    // (Cmd/Ctrl on Mac, Ctrl on others). Without a modifier, the default
    // page scroll wins so the plot doesn't hijack the user's wheel.
    const onWheel = (e: WheelEvent) => {
      if (!plot) return;
      if (!(e.metaKey || e.ctrlKey)) return; // let the page scroll
      e.preventDefault();
      const { left } = el.getBoundingClientRect();
      const cx = e.clientX - left;
      const factor = e.deltaY < 0 ? 0.85 : 1.15;
      const xRange = plot.scales.x;
      if (!xRange || xRange.min == null || xRange.max == null) return;
      const min = xRange.min;
      const max = xRange.max;
      const valAt = plot.posToVal(cx, "x");
      const newMin = valAt - (valAt - min) * factor;
      const newMax = valAt + (max - valAt) * factor;
      plot.setScale("x", { min: newMin, max: newMax });
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
  }, [data, channels, height, badChannels, hoveredChannel]);

  // Compute the on-screen Y position of each channel label by reading the
  // current scale of the plot. We do it on every render so labels stay
  // aligned even if the user pans/zooms the Y axis (they don't, but defensive).
  const [labelPositions, setLabelPositions] = useState<{ name: string; top: number }[]>([]);
  useEffect(() => {
    if (!plotRef.current) return;
    const plot = plotRef.current;
    const update = () => {
      const positions: { name: string; top: number }[] = [];
      for (let i = 0; i < channels.length; i++) {
        const ch = channels[i];
        if (!ch) continue;
        const offset = channelOffsets[i] ?? 0;
        const top = plot.valToPos(offset, "y", false);
        // valToPos returns NaN before the first paint or if the y scale is
        // not yet ready. Skip those — labels will appear once the plot is laid out.
        if (!Number.isFinite(top)) continue;
        positions.push({ name: ch.name, top });
      }
      setLabelPositions(positions);
    };

    // First paint may not have a valid y scale yet — retry on the next frame.
    const raf = requestAnimationFrame(update);

    // uPlot doesn't expose a clean "after-redraw" hook here; we listen to
    // mousemove on the plot which fires often enough to keep labels glued.
    const el = plotContainerRef.current;
    el?.addEventListener("mousemove", update);
    el?.addEventListener("wheel", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener("mousemove", update);
      el?.removeEventListener("wheel", update);
      window.removeEventListener("resize", update);
    };
  }, [channels, channelOffsets]);

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
    </div>
  );
}
