"use client";

type Props = {
  height?: number;
  className?: string;
  label?: string;
};

/** A subtle pulsing rectangle for placeholder UI while data loads. */
export function Skeleton({ height = 280, className, label }: Props) {
  return (
    <div
      style={{ height }}
      className={`relative grid w-full place-items-center overflow-hidden rounded border border-zinc-800 bg-zinc-950 ${className ?? ""}`}
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-zinc-900/50 via-zinc-950 to-zinc-900/30" />
      {label && <span className="relative text-xs text-zinc-600">{label}</span>}
    </div>
  );
}
