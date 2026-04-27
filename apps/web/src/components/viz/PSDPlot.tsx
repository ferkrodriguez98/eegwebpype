"use client";

import { HoverTooltip } from "@/components/ui/HoverTooltip";
import { useIdleCommit } from "@/lib/hooks/useHoverIdle";
import { useEffect, useRef } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";

type Props = {
  freqs: Float32Array;
  channels: { name: string; data: Float32Array }[];
  height?: number;
  /** Optional reference series rendered behind the main ones in dim
   * grey, useful for "before vs after" filter previews. Each entry's
   * `data` must be aligned to the same `freqs` array. */
  referenceChannels?: { name: string; data: Float32Array }[];
  /** Optional vertical lines drawn on the X axis (Hz). Useful for
   * showing filter cutoff frequencies. */
  verticalMarkers?: { freq: number; label: string; color?: string }[];
};

type HoverPayload = {
  freq: number;
  channel: string;
  value: number;
  x: number;
  y: number;
};

/** Draw a rounded rectangle path on a 2D canvas context. Falls back to
 * a sharp rect if the runtime doesn't expose `roundRect` (older Safari).
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function toLogDb(arr: Float32Array): number[] {
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] ?? 0;
    out[i] = v > 0 ? 10 * Math.log10(v) : Number.NaN;
  }
  return out;
}

export function PSDPlot({
  freqs,
  channels,
  height = 280,
  referenceChannels,
  verticalMarkers,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Tooltip is debounced: while the cursor moves, no React state churn;
  // once it goes idle for ~200ms, the tooltip appears at the rest spot.
  const hover = useIdleCommit<HoverPayload>(200);
  const insideRef = useRef<boolean>(false);
  const lastFocusedRef = useRef<string | null>(null);
  const hoveredChannel = hover.value?.channel ?? null;
  // Serialize markers so changing their values triggers a rebuild
  // without putting an array (whose identity can flip every render)
  // directly in the dep list.
  const verticalMarkersKey = (verticalMarkers ?? [])
    .map((m) => `${m.freq}|${m.label}|${m.color ?? ""}`)
    .join(",");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (channels.length === 0) return;

    const x: number[] = Array.from(freqs);
    if (x.length === 0) return;
    // Only include reference series whose data length matches `freqs`.
    // The "before" PSD and "after-filter" PSD can have slightly
    // different bin counts depending on backend rounding, and uPlot
    // throws if any series length doesn't match the X axis.
    const validRefs = (referenceChannels ?? []).filter((c) => c.data.length === freqs.length);
    const refSeries = validRefs.map((c) => toLogDb(c.data));
    const validChannels = channels.filter((c) => c.data.length === freqs.length);
    const ySeries = validChannels.map((c) => toLogDb(c.data));
    if (ySeries.length === 0) return;
    const data: AlignedData = [x, ...refSeries, ...ySeries] as AlignedData;

    const opts: Options = {
      width: el.clientWidth,
      height,
      padding: [10, 10, 10, 10],
      legend: { show: false },
      cursor: {
        // Disable uPlot's automatic per-series proximity scan — with
        // 128 channels it scans every series on every mousemove. We
        // do our own debounced single-pass closest-series search and
        // call setSeries(idx, { focus: true }) explicitly when the
        // hover settles.
        focus: { prox: -1 },
        points: { show: false },
      },
      // While a series is focused, the others fade to this alpha. This
      // is what makes the highlight VISIBLE — without it, focus has no
      // visual effect.
      focus: { alpha: 0.2 },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [{ stroke: "#a1a1aa" }, { stroke: "#a1a1aa", grid: { stroke: "#27272a" } }],
      series: [
        {},
        // Reference series first → painted in the back. Dimmed grey so
        // they read as "before" context, not as live data.
        ...validRefs.map((ch) => ({
          label: `ref:${ch.name}`,
          stroke: "rgba(161, 161, 170, 0.20)",
          width: 1,
          points: { show: false },
        })),
        // Main channels on top — these participate in the focus highlight.
        ...validChannels.map((ch) => ({
          label: ch.name,
          stroke: "rgba(167, 139, 250, 0.65)",
          width: 1,
          points: { show: false },
        })),
      ],
      hooks: {
        // Draw vertical guide lines at the requested marker frequencies
        // (e.g. filter cutoffs). Pinned via the `draw` hook so they
        // re-paint after every redraw without us having to track state.
        draw: [
          (u) => {
            if (!verticalMarkers || verticalMarkers.length === 0) return;
            const ctx = u.ctx;
            const { top, height: bbH } = u.bbox;
            const dpr = uPlot.pxRatio;
            ctx.save();
            for (const m of verticalMarkers) {
              const xPx = u.valToPos(m.freq, "x", true);
              if (!Number.isFinite(xPx)) continue;
              const lineColor = m.color ?? "#34d399"; // emerald-400
              // Vertical dashed line spanning the full plot area.
              ctx.beginPath();
              ctx.strokeStyle = lineColor;
              ctx.lineWidth = 2 * dpr;
              ctx.setLineDash([6 * dpr, 4 * dpr]);
              ctx.moveTo(xPx, top);
              ctx.lineTo(xPx, top + bbH);
              ctx.stroke();
              ctx.setLineDash([]);

              // Pill-style label at the top of the line, large and
              // opaque so it reads against busy traces.
              const labelText = m.label;
              ctx.font = `bold ${12 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
              const padX = 8 * dpr;
              const padY = 4 * dpr;
              const textWidth = ctx.measureText(labelText).width;
              const pillW = textWidth + padX * 2;
              const pillH = 18 * dpr;
              // Keep the pill inside the plot area horizontally.
              let pillX = xPx - pillW / 2;
              const minX = u.bbox.left;
              const maxX = u.bbox.left + u.bbox.width;
              if (pillX < minX) pillX = minX;
              if (pillX + pillW > maxX) pillX = maxX - pillW;
              const pillY = top + 4 * dpr;
              // Background pill.
              ctx.fillStyle = lineColor;
              roundRect(ctx, pillX, pillY, pillW, pillH, 4 * dpr);
              ctx.fill();
              // Text on top.
              ctx.fillStyle = "#0a0a0a"; // near-black for contrast on emerald
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(labelText, pillX + pillW / 2, pillY + pillH / 2 + 1 * dpr);
            }
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            // Drop any setCursor that fires while the cursor is outside
            // the wrapper. uPlot listens to mousemove on window and can
            // resurrect a tooltip after onMouseLeave.
            if (!insideRef.current) {
              hover.push(null);
              return;
            }
            const idx = u.cursor.idx;
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? -1;
            if (idx == null || idx < 0 || left < 0 || top < 0) {
              hover.push(null);
              return;
            }
            const yVal = u.posToVal(top, "y");

            // Pick the single channel whose value at this frequency is closest
            // to the cursor's y position. That's the one the user is pointing at.
            let bestI = -1;
            let bestD = Number.POSITIVE_INFINITY;
            for (let i = 0; i < channels.length; i++) {
              const arr = ySeries[i];
              if (!arr) continue;
              const v = arr[idx];
              if (v === undefined || !Number.isFinite(v)) continue;
              const d = Math.abs(v - yVal);
              if (d < bestD) {
                bestD = d;
                bestI = i;
              }
            }
            if (bestI < 0) {
              hover.push(null);
              return;
            }
            const ch = channels[bestI];
            const arr = ySeries[bestI];
            const v = arr?.[idx];
            if (!ch || v === undefined) return;
            hover.push({
              freq: x[idx] ?? 0,
              channel: ch.name,
              value: v,
              x: left,
              y: top,
            });
          },
        ],
      },
    };

    // Use the measured width or a sensible default — uPlot needs a
    // non-zero width at construction time. The ResizeObserver below
    // will resize the plot to the real container width as soon as
    // the layout settles.
    opts.width = Math.max(el.clientWidth, 100);
    const plot = new uPlot(opts, data, el);
    plotRef.current = plot;
    const onResize = () => {
      if (el.clientWidth > 0) plot.setSize({ width: el.clientWidth, height });
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [freqs, channels, height, referenceChannels, verticalMarkersKey]);

  // When the (debounced) hovered channel changes, drive uPlot's native
  // focus state. setSeries(idx, { focus: true }) is the canonical way to
  // tell uPlot "this is the highlighted series" — it dims the others via
  // focus.alpha and brightens this one, all without any rebuild.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    if (lastFocusedRef.current === hoveredChannel) return;
    lastFocusedRef.current = hoveredChannel;
    if (hoveredChannel == null) {
      plot.setSeries(null, { focus: false }, false);
      return;
    }
    const idx = channels.findIndex((ch) => ch.name === hoveredChannel);
    if (idx < 0) return;
    // +1 for the X series, + ref count to skip the dimmed reference series.
    const offset = 1 + (referenceChannels?.length ?? 0);
    plot.setSeries(offset + idx, { focus: true }, false);
  }, [hoveredChannel, channels, referenceChannels]);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onMouseEnter={() => {
        insideRef.current = true;
      }}
      onMouseLeave={() => {
        insideRef.current = false;
        hover.push(null);
      }}
    >
      {hover.value && (
        <HoverTooltip cursorX={hover.value.x} cursorY={hover.value.y} containerRef={containerRef}>
          <div className="mb-0.5 text-zinc-400">
            {hover.value.channel} · {hover.value.freq.toFixed(1)} Hz
          </div>
          <div className="text-zinc-100">{hover.value.value.toFixed(1)} dB</div>
        </HoverTooltip>
      )}
    </div>
  );
}
