"use client";

import { useEffect, useState } from "react";

type Props = {
  /** Triggers a fresh slide-in whenever this changes. */
  triggerKey: string | number;
  /** "down" = new content slides down from the top; "up" = from the bottom.
   * `null` means render statically (no animation). */
  direction: "up" | "down" | null;
  /** ms */
  durationMs?: number;
  /** Initial translation in px. */
  offsetPx?: number;
  children: React.ReactNode;
  className?: string;
};

/** Plays a subtle vertical slide + fade animation each time `triggerKey`
 * changes. The element starts offset and faded, then transitions to its
 * resting state in the next frame. Cheap: pure CSS transition on a single
 * wrapper, no per-child work. */
export function SlideIn({
  triggerKey,
  direction,
  durationMs = 200,
  offsetPx = 24,
  children,
  className,
}: Props) {
  // `playing` toggles between "entering" and "rest". On every triggerKey
  // change we set `playing=true` for one frame (entering pose), then flip
  // to `false` so the CSS transition runs to rest.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (direction == null) return;
    setPlaying(true);
    // Two RAFs: first paints the entering pose, second triggers the
    // transition by flipping `playing` back to false.
    let r2: number | null = null;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setPlaying(false));
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2 != null) cancelAnimationFrame(r2);
    };
  }, [triggerKey, direction]);

  const sign = direction === "down" ? 1 : -1;
  const translate = playing ? `translateY(${sign * -offsetPx}px)` : "translateY(0)";
  const opacity = playing ? 0 : 1;

  return (
    <div
      className={className}
      style={{
        transform: translate,
        opacity,
        transition: `transform ${durationMs}ms ease-out, opacity ${durationMs}ms ease-out`,
        willChange: "transform, opacity",
      }}
    >
      {children}
    </div>
  );
}
