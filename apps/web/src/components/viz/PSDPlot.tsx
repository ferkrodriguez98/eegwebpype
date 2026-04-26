"use client";

import { useEffect, useRef, useState } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";

type Props = {
  freqs: Float32Array;
  channels: { name: string; data: Float32Array }[];
  height?: number;
};

type HoverState = {
  freq: number;
  channel: string;
  value: number;
} | null;

function toLogDb(arr: Float32Array): number[] {
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] ?? 0;
    out[i] = v > 0 ? 10 * Math.log10(v) : Number.NaN;
  }
  return out;
}

export function PSDPlot({ freqs, channels, height = 280 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (channels.length === 0) return;

    const x: number[] = Array.from(freqs);
    const ySeries = channels.map((c) => toLogDb(c.data));
    const data: AlignedData = [x, ...ySeries] as AlignedData;

    const opts: Options = {
      width: el.clientWidth,
      height,
      padding: [10, 10, 10, 10],
      legend: { show: false },
      cursor: {
        focus: { prox: 30 },
        // Don't render the default per-series points on hover; we draw our
        // own single dot for the focused channel only.
        points: { show: false },
      },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [{ stroke: "#a1a1aa" }, { stroke: "#a1a1aa", grid: { stroke: "#27272a" } }],
      series: [
        {},
        ...channels.map((ch) => ({
          label: ch.name,
          stroke: "rgba(167, 139, 250, 0.30)",
          width: 1,
          points: { show: false },
        })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            const left = u.cursor.left ?? -1;
            const top = u.cursor.top ?? -1;
            if (idx == null || idx < 0 || left < 0 || top < 0) {
              setHover(null);
              setTooltipPos(null);
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
              setHover(null);
              return;
            }
            const ch = channels[bestI];
            const arr = ySeries[bestI];
            const v = arr?.[idx];
            if (!ch || v === undefined) return;
            setHover({ freq: x[idx] ?? 0, channel: ch.name, value: v });
            setTooltipPos({ x: left, y: top });

            // Highlight only the focused series visually.
            for (let i = 0; i < channels.length; i++) {
              const isFocused = i === bestI;
              u.setSeries(i + 1, { focus: isFocused }, false);
            }
          },
        ],
      },
    };

    const plot = new uPlot(opts, data, el);
    const onResize = () => plot.setSize({ width: el.clientWidth, height });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      plot.destroy();
    };
  }, [freqs, channels, height]);

  return (
    <div ref={containerRef} className="relative w-full">
      {hover && tooltipPos && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-zinc-700 bg-zinc-950/95 p-2 font-mono text-[10px] text-zinc-100 shadow-lg"
          style={{ left: tooltipPos.x + 12, top: Math.max(0, tooltipPos.y - 28) }}
        >
          <div className="mb-0.5 text-zinc-400">
            {hover.channel} · {hover.freq.toFixed(1)} Hz
          </div>
          <div className="text-zinc-100">{hover.value.toFixed(1)} dB</div>
        </div>
      )}
    </div>
  );
}
