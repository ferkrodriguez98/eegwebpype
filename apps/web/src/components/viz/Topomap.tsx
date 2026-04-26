"use client";

import type { TopomapPoint } from "@eegwebpype/shared";
import { interpolateRdBu } from "d3-scale-chromatic";
import { useMemo } from "react";

type Props = {
  points: TopomapPoint[];
  badChannels: Set<string>;
  highlightedChannel?: string | null;
  onSelect?: (channel: string) => void;
  size?: number;
};

const GRID = 64;

/** Inverse-distance-weighted interpolation onto a square grid clipped to a circle. */
function interpolateGrid(
  points: { nx: number; ny: number; value: number }[],
  width: number,
  height: number,
  cx: number,
  cy: number,
  r: number,
): Float32Array {
  const grid = new Float32Array(GRID * GRID);
  const cellW = width / GRID;
  const cellH = height / GRID;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const px = (gx + 0.5) * cellW;
      const py = (gy + 0.5) * cellH;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > r * r) {
        grid[gy * GRID + gx] = Number.NaN;
        continue;
      }
      let num = 0;
      let den = 0;
      for (const p of points) {
        const ddx = px - p.nx;
        const ddy = py - p.ny;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 1) {
          num = p.value;
          den = 1;
          break;
        }
        const w = 1 / (d2 * d2);
        num += w * p.value;
        den += w;
      }
      grid[gy * GRID + gx] = den > 0 ? num / den : Number.NaN;
    }
  }
  return grid;
}

export function Topomap({ points, badChannels, highlightedChannel, onSelect, size = 320 }: Props) {
  // We expand the SVG viewBox beyond the head circle so that nose and ears
  // never get clipped, regardless of `size`.
  const margin = Math.round(size * 0.15);
  const width = size + margin * 2;
  const height = size + margin * 2;
  const cx = width / 2;
  const cy = height / 2;
  const r = size / 2 - 2;

  // Project the backend's 2D coordinates (azimuthal-equidistant, in radians)
  // onto pixel space inside the head circle.
  const projected = useMemo(() => {
    if (points.length === 0) return null;
    const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (valid.length === 0) return null;
    const xs = valid.map((p) => p.x);
    const ys = valid.map((p) => p.y);
    // Find the largest radius among the input points; map it onto `r * 0.92`
    // (a small inner padding so points sit inside the head circle).
    const maxRadius = Math.max(...valid.map((p) => Math.hypot(p.x, p.y)), 1e-6);
    const scale = (r * 0.92) / maxRadius;
    // Center on (0,0) of the input space.
    const cxIn = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cyIn = (Math.min(...ys) + Math.max(...ys)) / 2;
    return points.map((p) => ({
      ...p,
      nx: cx + (p.x - cxIn) * scale,
      // Flip y so positive values point up (front of head).
      ny: cy - (p.y - cyIn) * scale,
    }));
  }, [points, cx, cy, r]);

  const heatmap = useMemo(() => {
    if (!projected) return null;
    const grid = interpolateGrid(projected, width, height, cx, cy, r);
    const finite: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (v !== undefined && Number.isFinite(v)) finite.push(v);
    }
    if (finite.length === 0) return null;
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const range = max - min || 1;

    const canvas = document.createElement("canvas");
    canvas.width = GRID;
    canvas.height = GRID;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(GRID, GRID);
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (v === undefined || !Number.isFinite(v)) {
        img.data[i * 4 + 3] = 0;
        continue;
      }
      const t = (v - min) / range;
      // RdBu: blue = low, red = high. Invert because we want high = warm.
      const rgb = parseRgb(interpolateRdBu(1 - t));
      img.data[i * 4 + 0] = rgb[0];
      img.data[i * 4 + 1] = rgb[1];
      img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = 235;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [projected, width, height, cx, cy, r]);

  if (!projected) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid place-items-center text-xs text-zinc-600"
      >
        no electrode positions
      </div>
    );
  }

  // Nose tip and ear arcs sit OUTSIDE the head circle; we have margin for them.
  const noseW = r * 0.14;
  const noseTipY = cy - r - r * 0.18;
  const earR = r * 0.18;
  const earCx = r * 1.02;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${width} ${height}`}
      className="select-none"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>Topomap</title>

      <defs>
        <clipPath id={`topomap-clip-${size}`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>

      {/* Heatmap clipped to the head circle */}
      {heatmap && (
        <image
          href={heatmap}
          x={0}
          y={0}
          width={width}
          height={height}
          clipPath={`url(#topomap-clip-${size})`}
          style={{ imageRendering: "auto" }}
        />
      )}

      {/* Head outline */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#71717a" strokeWidth={1.6} />

      {/* Nose: triangle pointing up, sitting on top of the head circle */}
      <path
        d={`M ${cx - noseW} ${cy - r + 1} Q ${cx} ${noseTipY} ${cx + noseW} ${cy - r + 1}`}
        fill="none"
        stroke="#71717a"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Left ear */}
      <path
        d={`M ${cx - earCx + 1} ${cy - earR} Q ${cx - earCx - earR} ${cy} ${cx - earCx + 1} ${cy + earR}`}
        fill="none"
        stroke="#71717a"
        strokeWidth={1.6}
        strokeLinecap="round"
      />

      {/* Right ear */}
      <path
        d={`M ${cx + earCx - 1} ${cy - earR} Q ${cx + earCx + earR} ${cy} ${cx + earCx - 1} ${cy + earR}`}
        fill="none"
        stroke="#71717a"
        strokeWidth={1.6}
        strokeLinecap="round"
      />

      {/* Electrode dots on top */}
      {projected.map((p) => {
        const isBad = badChannels.has(p.channel);
        const isSel = p.channel === highlightedChannel;
        const fill = isBad ? "#ef4444" : isSel ? "#fafafa" : "#18181b";
        const stroke = isBad || isSel ? "#fafafa" : "#a1a1aa";
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
              cx={p.nx}
              cy={p.ny}
              r={isSel ? 4 : 2.4}
              fill={fill}
              stroke={stroke}
              strokeWidth={0.8}
            />
            {(isSel || isBad) && (
              <text
                x={p.nx}
                y={p.ny - 6}
                textAnchor="middle"
                fontSize={9}
                fill="#fafafa"
                stroke="#18181b"
                strokeWidth={2.5}
                style={{ fontFamily: "monospace", paintOrder: "stroke" }}
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

function parseRgb(css: string): [number, number, number] {
  // d3-scale-chromatic returns "rgb(r, g, b)" strings.
  const m = css.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number.parseInt(m[1] ?? "0"), Number.parseInt(m[2] ?? "0"), Number.parseInt(m[3] ?? "0")];
}
