"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  /** Cursor x, in pixels relative to `containerRef`'s top-left. */
  cursorX: number;
  /** Cursor y, in pixels relative to `containerRef`'s top-left. */
  cursorY: number;
  /** Container the tooltip is positioned within (and clamped to). */
  containerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** Pixels of breathing room between the cursor and the tooltip. */
  offset?: number;
};

/** Floating tooltip that auto-picks which side of the cursor to render
 * on, based on which side of the container has enough room. Avoids
 * covering the cursor or overflowing the plot. */
export function HoverTooltip({ cursorX, cursorY, containerRef, children, offset = 14 }: Props) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    const container = containerRef.current;
    if (!tip || !container) return;
    const tipRect = tip.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const tipW = tipRect.width;
    const tipH = tipRect.height;
    const containerW = containerRect.width;
    const containerH = containerRect.height;

    // Available space in each direction from the cursor (within the container).
    const spaceRight = containerW - cursorX;
    const spaceLeft = cursorX;
    const spaceBelow = containerH - cursorY;
    const spaceAbove = cursorY;

    // Prefer right of cursor if it fits, else left.
    let left =
      spaceRight >= tipW + offset
        ? cursorX + offset
        : spaceLeft >= tipW + offset
          ? cursorX - tipW - offset
          : Math.max(0, Math.min(containerW - tipW, cursorX - tipW / 2));

    // Prefer below if there's room, else above. If neither fits cleanly,
    // clamp inside the container so we never escape the plot.
    let top =
      spaceBelow >= tipH + offset
        ? cursorY + offset
        : spaceAbove >= tipH + offset
          ? cursorY - tipH - offset
          : Math.max(0, Math.min(containerH - tipH, cursorY - tipH / 2));

    // Final safety clamp.
    left = Math.max(0, Math.min(containerW - tipW, left));
    top = Math.max(0, Math.min(containerH - tipH, top));

    setPos({ left, top });
  }, [cursorX, cursorY, containerRef, children]);

  return (
    <div
      ref={tipRef}
      className="pointer-events-none absolute z-20 rounded border border-zinc-700 bg-zinc-950/95 p-2 font-mono text-[10px] text-zinc-100 shadow-lg"
      style={
        pos
          ? { left: pos.left, top: pos.top }
          : // First paint: render off-screen so we can measure without flicker.
            { left: -9999, top: -9999 }
      }
    >
      {children}
    </div>
  );
}
