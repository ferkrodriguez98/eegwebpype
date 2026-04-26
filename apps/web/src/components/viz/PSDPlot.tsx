"use client";

import { useEffect, useRef } from "react";
import uPlot, { type AlignedData, type Options } from "uplot";
import "uplot/dist/uPlot.min.css";

type Props = {
  freqs: Float32Array;
  channels: { name: string; data: Float32Array }[];
  height?: number;
};

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
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const x: number[] = Array.from(freqs);
    const data: AlignedData = [x, ...channels.map((c) => toLogDb(c.data))] as AlignedData;
    const opts: Options = {
      width: el.clientWidth,
      height,
      padding: [10, 10, 10, 10],
      legend: { show: false },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [{ stroke: "#a1a1aa" }, { stroke: "#a1a1aa", grid: { stroke: "#27272a" } }],
      series: [
        {},
        ...channels.map((ch) => ({
          label: ch.name,
          stroke: "rgba(167, 139, 250, 0.25)",
          width: 1,
          points: { show: false },
        })),
      ],
    };
    const plot = new uPlot(opts, data, el);
    const onResize = () => plot.setSize({ width: el.clientWidth, height });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      plot.destroy();
    };
  }, [freqs, channels, height]);

  return <div ref={containerRef} className="w-full" />;
}
