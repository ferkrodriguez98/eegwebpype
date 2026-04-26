"use client";

import { useEffect, useRef } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";

type Props = {
  times: Float32Array;
  channels: { name: string; data: Float32Array }[];
  height?: number;
  /** Vertical separation between channels in raw signal units (V). */
  spacing?: number;
};

/** Apilamiento de canales con offset para que se vean separados. */
function buildAlignedData(props: Props): AlignedData {
  const { times, channels, spacing = 1.5e-4 } = props;
  // x is plain JS number array because uPlot wants Number[] not Float64.
  const x: number[] = Array.from(times);
  const ys: number[][] = channels.map((ch, i) => {
    const offset = i * spacing;
    const out = new Array<number>(ch.data.length);
    for (let j = 0; j < ch.data.length; j++) out[j] = (ch.data[j] ?? 0) + offset;
    return out;
  });
  return [x, ...ys] as AlignedData;
}

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

export function ScrollPlot({ times, channels, height = 600, spacing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const data = buildAlignedData({ times, channels, spacing });
    const opts: Options = {
      width: el.clientWidth,
      height,
      padding: [10, 10, 10, 10],
      cursor: { drag: { x: true, y: false }, focus: { prox: 30 } },
      legend: { show: false },
      scales: {
        x: { time: false },
        y: { auto: true },
      },
      axes: [{ stroke: "#a1a1aa" }, { stroke: "#a1a1aa", grid: { stroke: "#27272a" } }],
      series: [
        {},
        ...channels.map((ch, i) => ({
          label: ch.name,
          stroke: PALETTE[i % PALETTE.length],
          width: 1,
          points: { show: false },
        })),
      ],
    };

    const plot = new uPlot(opts, data, el);
    plotRef.current = plot;

    const onResize = () => plot.setSize({ width: el.clientWidth, height });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      plot.destroy();
      plotRef.current = null;
    };
  }, [times, channels, height, spacing]);

  return <div ref={containerRef} className="w-full" />;
}
