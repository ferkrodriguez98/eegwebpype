"use client";

import type { TopomapPoint } from "@eegwebpype/shared";
import { interpolateInferno } from "d3-scale-chromatic";

type Props = {
  points: TopomapPoint[];
  badChannels: Set<string>;
  highlightedChannel?: string | null;
  onSelect?: (channel: string) => void;
  size?: number;
};

function normalize(values: number[]): (v: number) => number {
  if (values.length === 0) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return () => 0.5;
  return (v) => (v - min) / (max - min);
}

export function Topomap({ points, badChannels, highlightedChannel, onSelect, size = 320 }: Props) {
  if (points.length === 0) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid place-items-center text-xs text-zinc-600"
      >
        sin posiciones de electrodos
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (maxX + minX) / 2;
  const cy = (maxY + minY) / 2;
  const range = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = size * 0.1;
  const r = (size - pad * 2) / 2;
  const project = (x: number, y: number) => ({
    cx: pad + r + ((x - cx) / range) * (size - pad * 2),
    cy: pad + r - ((y - cy) / range) * (size - pad * 2),
  });

  const norm = normalize(points.map((p) => p.value));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-full">
      <title>Topomap</title>
      <circle cx={size / 2} cy={size / 2} r={r + 4} fill="none" stroke="#3f3f46" strokeWidth="1" />
      {points.map((p) => {
        const { cx: px, cy: py } = project(p.x, p.y);
        const t = norm(p.value);
        const fill = interpolateInferno(t);
        const isBad = badChannels.has(p.channel);
        const isSel = p.channel === highlightedChannel;
        return (
          <g
            key={p.channel}
            onClick={() => onSelect?.(p.channel)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(p.channel);
              }
            }}
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            <title>{`${p.channel} · ${p.value.toFixed(2)}`}</title>
            <circle
              cx={px}
              cy={py}
              r={isSel ? 8 : 6}
              fill={fill}
              stroke={isBad ? "#ef4444" : isSel ? "#fafafa" : "#27272a"}
              strokeWidth={isBad ? 2 : 1}
            />
            {(isSel || isBad) && (
              <text
                x={px}
                y={py - 10}
                textAnchor="middle"
                fontSize={9}
                fill="#fafafa"
                style={{ fontFamily: "monospace" }}
              >
                {p.channel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
