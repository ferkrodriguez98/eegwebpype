"use client";

import type { TopomapPoint } from "@eegwebpype/shared";
import { interpolateInferno } from "d3-scale-chromatic";
import { useMemo } from "react";

type Props = {
  points: TopomapPoint[];
  badChannels: Set<string>;
  highlightedChannel?: string | null;
  onSelect?: (channel: string) => void;
  size?: number;
};

const GRID = 56;

/** Inverse-distance-weighted interpolation onto a square grid clipped to a circle. */
function interpolateGrid(
  points: { nx: number; ny: number; value: number }[],
  size: number,
): Float32Array {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const grid = new Float32Array(GRID * GRID);
  const cell = size / GRID;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const px = (gx + 0.5) * cell;
      const py = (gy + 0.5) * cell;
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
  const projected = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const cx = (maxX + minX) / 2;
    const cy = (maxY + minY) / 2;
    const range = Math.max(maxX - minX, maxY - minY) || 1;
    const padding = 0.86; // shrink a bit so points don't sit on the head outline
    const r = (size / 2) * padding;
    return points.map((p) => ({
      ...p,
      nx: size / 2 + ((p.x - cx) / range) * 2 * r,
      ny: size / 2 - ((p.y - cy) / range) * 2 * r,
    }));
  }, [points, size]);

  const heatmap = useMemo(() => {
    if (!projected) return null;
    const grid = interpolateGrid(projected, size);
    const finite: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (v !== undefined && Number.isFinite(v)) finite.push(v);
    }
    if (finite.length === 0) return null;
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const range = max - min || 1;

    const cell = size / GRID;
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
      const rgb = parseRgb(interpolateInferno(t));
      img.data[i * 4 + 0] = rgb[0];
      img.data[i * 4 + 1] = rgb[1];
      img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = 230;
    }
    ctx.putImageData(img, 0, 0);
    return { dataUrl: canvas.toDataURL(), cell };
  }, [projected, size]);

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

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  // Nose triangle (top) and ears (semicircles on the sides), in MNE style.
  const noseW = r * 0.18;
  const noseH = r * 0.18;
  const earR = r * 0.12;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="select-none">
      <title>Topomap</title>

      {/* Heatmap clipped to head */}
      <defs>
        <clipPath id={`topomap-clip-${size}`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      {heatmap && (
        <image
          href={heatmap.dataUrl}
          x={0}
          y={0}
          width={size}
          height={size}
          clipPath={`url(#topomap-clip-${size})`}
          style={{ imageRendering: "auto" }}
        />
      )}

      {/* Head outline */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#52525b" strokeWidth={1.5} />

      {/* Nose */}
      <path
        d={`M ${cx - noseW} ${cy - r + 2} L ${cx} ${cy - r - noseH} L ${cx + noseW} ${cy - r + 2}`}
        fill="none"
        stroke="#52525b"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* Left ear */}
      <path
        d={`M ${cx - r - 1} ${cy - earR} A ${earR} ${earR} 0 0 0 ${cx - r - 1} ${cy + earR}`}
        fill="none"
        stroke="#52525b"
        strokeWidth={1.5}
      />

      {/* Right ear */}
      <path
        d={`M ${cx + r + 1} ${cy - earR} A ${earR} ${earR} 0 0 1 ${cx + r + 1} ${cy + earR}`}
        fill="none"
        stroke="#52525b"
        strokeWidth={1.5}
      />

      {/* Electrode dots */}
      {projected.map((p) => {
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
              cx={p.nx}
              cy={p.ny}
              r={isSel ? 4 : 2.5}
              fill={isBad ? "#ef4444" : "#fafafa"}
              stroke="#18181b"
              strokeWidth={0.6}
            />
            {(isSel || isBad) && (
              <text
                x={p.nx}
                y={p.ny - 6}
                textAnchor="middle"
                fontSize={9}
                fill="#fafafa"
                style={{ fontFamily: "monospace", paintOrder: "stroke" }}
                stroke="#18181b"
                strokeWidth={2}
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
