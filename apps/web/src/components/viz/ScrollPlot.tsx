"use client";

import { HoverTooltip } from "@/components/ui/HoverTooltip";
import { useIdleCommit } from "@/lib/hooks/useHoverIdle";
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
  /** Pin the X scale to this exact range. Useful when `times` comes from
   * a min/max-bucketed overview and ends a few ms shy of the requested
   * window — without this, ticks like "9.977" appear instead of "10". */
  xRange?: [number, number];
  /** Optional channel-pager controls rendered as a vertical column on the
   * right edge of the plot, opposite the channel labels. The plot lays
   * them out itself so they're always anchored to the canvas. */
  pager?: {
    onPrev: () => void;
    onNext: () => void;
    canPrev: boolean;
    canNext: boolean;
    /** Visible range, e.g. "1–32". */
    rangeLabel: string;
    /** Total channel count. */
    total: number;
  };
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

type Tooltip = {
  x: number;
  y: number;
  channel: string;
  time: number;
  value: number;
  std: number;
};

const PAGER_WIDTH = 56;

export function ScrollPlot({
  times,
  channels,
  height = 600,
  badChannels,
  onToggleBad,
  xRange,
  pager,
}: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Hover state is debounced: while the cursor is moving, only refs are
  // updated; once it goes idle for ~200ms, React state commits. This keeps
  // tooltip rendering and series highlighting from running on every
  // mousemove (which would re-create uPlot via useEffect deps).
  const hover = useIdleCommit<{ channel: string; tooltip: Tooltip | null }>(200);
  const hoveredChannel = hover.value?.channel ?? null;
  const tooltip = hover.value?.tooltip ?? null;
  // Keep a ref to the latest hovered channel so the highlighting effect
  // can update uPlot without re-running on every mousemove.
  const lastHoveredRef = useRef<string | null>(null);
  // True only while the cursor is inside the plot wrapper. uPlot's
  // setCursor hook can fire one extra event after the wrapper's
  // onMouseLeave (because uPlot listens to mousemove on window), which
  // would resurrect the tooltip. We gate setCursor on this ref.
  const insideRef = useRef<boolean>(false);
  // Set by the label-reposition effect so the uPlot draw hook can poke
  // it without re-creating the plot.
  const redrawCallbackRef = useRef<(() => void) | null>(null);

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
      // Horizontal padding gives uPlot room to render the first AND last
      // x-axis tick labels without clipping them at the canvas edges.
      // E.g. for a 120-130s window we want to see both "120" and "130"
      // fully drawn, not "20" or "13" with the leading/trailing digit cut.
      padding: [10, 24, 10, 24],
      cursor: {
        drag: { x: false, y: false },
        // We don't use uPlot's automatic proximity focus: with many
        // channels it scans every series on every mousemove. Instead we
        // compute the closest channel ourselves (debounced via
        // useIdleCommit) and then call setSeries(idx, { focus: true })
        // explicitly. `prox: -1` disables automatic focus selection
        // while keeping the focus styling system enabled.
        focus: { prox: -1 },
        // Hide the default per-series crosshair dot.
        points: { show: false },
      },
      // Skip pixel-aligning paths for cheaper paint with many points.
      pxAlign: false,
      // When a series is in focus, the others fade to this alpha. Combined
      // with our manual `setSeries({ focus: true })` call, this is what
      // produces the dim-everything-else-highlight-this-one effect.
      focus: { alpha: 0.25 },
      legend: { show: false },
      scales: {
        x: xRange
          ? { time: false, auto: false, range: () => [xRange[0], xRange[1]] }
          : { time: false },
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
        // Static colours per channel. uPlot handles the focus highlight
        // natively via the cursor's proximity logic and our `focus.alpha`
        // setting above — when one series is in focus, the rest fade.
        ...normalized.map((ch, i) => {
          const baseColor = PALETTE[i % PALETTE.length] ?? "#a78bfa";
          const isBad = badChannels?.has(ch.name);
          return {
            label: ch.name,
            stroke: isBad ? "#3f3f46" : baseColor,
            width: isBad ? 0.7 : 0.9,
            points: { show: false },
          };
        }),
      ],
      hooks: {
        // After every redraw (resize, focus change, scale change), the
        // canvas's CSS pixel rect may have changed and any cached label
        // top positions are stale. The reposition effect installs a
        // callback into `redrawCallbackRef` so we can poke it from here
        // without rebuilding uPlot.
        draw: [
          () => {
            requestAnimationFrame(() => {
              redrawCallbackRef.current?.();
            });
          },
        ],
        setCursor: [
          (u) => {
            // Drop any setCursor that fires while the cursor is outside
            // our wrapper. Without this, uPlot's window-level mousemove
            // listener can resurrect a tooltip after onMouseLeave already
            // cleared it.
            if (!insideRef.current) {
              hover.push(null);
              return;
            }
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? -1;
            const idx = u.cursor.idx;
            if (left < 0 || top < 0 || idx == null) {
              hover.push(null);
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
              hover.push(null);
              return;
            }
            const t = (times[idx] as number | undefined) ?? 0;
            const vNorm = (ch.values[idx] as number | undefined) ?? 0;
            const realValue = vNorm * ch.std;
            hover.push({
              channel: ch.name,
              tooltip: {
                x: left,
                y: top,
                channel: ch.name,
                time: t,
                value: realValue,
                std: ch.std,
              },
            });
          },
        ],
      },
    };

    const plot = new uPlot(opts, data, el);
    plotRef.current = plot;

    const onResize = () => plot.setSize({ width: el.clientWidth, height });
    window.addEventListener("resize", onResize);

    // The container width can change without the window resizing (e.g. the
    // outer sidebar collapsing/expanding, a parent grid animating). uPlot
    // doesn't track that on its own — we have to feed it new dimensions.
    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
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
    yMin,
    yMax,
    xRange,
  ]);

  // When the (debounced) hovered channel changes, drive uPlot's native
  // focus state. `setSeries(idx, { focus: true })` is the canonical way
  // to tell uPlot "this is the highlighted series" — it dims the others
  // via `focus.alpha` and brightens this one, all without any rebuild.
  useEffect(() => {
    lastHoveredRef.current = hoveredChannel;
    const plot = plotRef.current;
    if (!plot) return;
    if (hoveredChannel == null) {
      plot.setSeries(null, { focus: false }, false);
      return;
    }
    const idx = normalized.findIndex((ch) => ch.name === hoveredChannel);
    if (idx < 0) return;
    plot.setSeries(idx + 1, { focus: true }, false);
  }, [hoveredChannel, normalized]);

  // Compute the screen-space Y position of each channel label.
  const [labelPositions, setLabelPositions] = useState<{ name: string; top: number }[]>([]);

  useEffect(() => {
    const update = () => {
      const plot = plotRef.current;
      const plotEl = plotContainerRef.current;
      if (!plot || !plotEl) return;
      // `valToPos(v, "y", false)` returns CSS pixels offset from the top
      // of uPlot's PLOT AREA (the `.u-over` div), NOT from the top of
      // the wrapper. To position our labels (which are absolute inside
      // the same wrapper), we need to add the plot area's own offset
      // within the wrapper.
      const overEl = plot.over as HTMLDivElement | undefined;
      const plotAreaTop = overEl
        ? overEl.getBoundingClientRect().top - plotEl.getBoundingClientRect().top
        : 0;
      const positions: { name: string; top: number }[] = [];
      for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (!ch) continue;
        const offset = channelOffsets[i] ?? 0;
        const top = plot.valToPos(offset, "y", false);
        if (!Number.isFinite(top)) continue;
        positions.push({ name: ch.name, top: top + plotAreaTop });
      }
      setLabelPositions(positions);
    };

    // Register `update` so the uPlot draw hook can call it after every
    // redraw — the canonical moment when the canvas rect is final.
    redrawCallbackRef.current = update;

    // Try a few frames in a row; uPlot finishes its first layout async.
    const handles = [
      requestAnimationFrame(update),
      requestAnimationFrame(() => requestAnimationFrame(update)),
    ];
    const t = setTimeout(update, 80);

    const el = plotContainerRef.current;
    window.addEventListener("resize", update);
    // The wrapper's own height/width can change without the window resizing
    // (e.g. parent container locks min-height after data arrives), which
    // shifts the canvas offset and would leave labels stale.
    const ro = el ? new ResizeObserver(() => update()) : null;
    if (el && ro) ro.observe(el);
    return () => {
      for (const h of handles) cancelAnimationFrame(h);
      clearTimeout(t);
      window.removeEventListener("resize", update);
      ro?.disconnect();
      redrawCallbackRef.current = null;
    };
  }, [normalized, channelOffsets]);

  return (
    <div
      ref={outerRef}
      className="relative h-full w-full"
      style={{
        paddingLeft: LABEL_WIDTH,
        paddingRight: pager ? PAGER_WIDTH : 0,
      }}
      onMouseEnter={() => {
        insideRef.current = true;
      }}
      onMouseLeave={() => {
        insideRef.current = false;
        hover.push(null);
      }}
    >
      {/* Channel pager column, mirror of the labels gutter on the left.
       * Positioned outside the canvas so it never overlaps the traces.
       * Centered vertically against the wrapper, which is forced to
       * `h-full` so it spans the entire plot box (not just the canvas
       * height). */}
      {pager && (
        <div
          className="absolute inset-y-0 flex flex-col items-center justify-center gap-3 text-xs text-zinc-400"
          style={{ right: 0, width: PAGER_WIDTH }}
        >
          <button
            type="button"
            onClick={pager.onPrev}
            disabled={!pager.canPrev}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
            title="previous channel block"
          >
            ↑
          </button>
          <div className="flex flex-col items-center font-mono text-[10px] leading-tight text-zinc-400">
            <span className="text-zinc-200">{pager.rangeLabel}</span>
            <span className="text-zinc-600">of {pager.total}</span>
          </div>
          <button
            type="button"
            onClick={pager.onNext}
            disabled={!pager.canNext}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
            title="next channel block"
          >
            ↓
          </button>
        </div>
      )}
      <div ref={plotContainerRef} className="relative w-full select-none">
        {/* Channel labels gutter on the left, clickable to toggle bad. They
         * live INSIDE the plot container (same coordinate system as
         * `plot.valToPos`) so vertical alignment stays correct regardless of
         * outer padding/borders. */}
        <div
          className="pointer-events-none absolute inset-y-0 font-mono text-[10px]"
          style={{ left: -LABEL_WIDTH, width: LABEL_WIDTH }}
        >
          {labelPositions.map(({ name, top }) => {
            const isBad = badChannels?.has(name);
            const isHov = name === hoveredChannel;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onToggleBad?.(name)}
                onMouseEnter={() => hover.push({ channel: name, tooltip: null })}
                onMouseLeave={() => hover.push(null)}
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

      {/* Floating tooltip — auto-placed on whichever side has room so
       * it never covers the cursor or escapes the plot. */}
      {tooltip && (
        <HoverTooltip cursorX={tooltip.x + LABEL_WIDTH} cursorY={tooltip.y} containerRef={outerRef}>
          <div className="mb-0.5 text-zinc-400">
            {tooltip.channel} · {tooltip.time.toFixed(3)} s
          </div>
          <div className="text-zinc-100">{(tooltip.value * 1e6).toFixed(1)} µV</div>
        </HoverTooltip>
      )}
    </div>
  );
}
