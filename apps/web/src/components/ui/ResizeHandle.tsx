"use client";

import { ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  /** Called with the pixel delta from the last mousemove event. The parent
   * decides what to do with it (clamp, persist, etc). */
  onResize: (deltaPx: number) => void;
  /** Caption rendered under the handle. Visible at all times — no tooltip. */
  caption?: string;
  className?: string;
};

/** A thin horizontal bar that the user drags up or down to resize the
 * element above it. Emits incremental pixel deltas via `onResize`. */
export function ResizeHandle({ onResize, caption, className }: Props) {
  const [dragging, setDragging] = useState(false);
  const lastY = useRef<number | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    lastY.current = e.clientY;
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      if (lastY.current == null) return;
      const dy = e.clientY - lastY.current;
      lastY.current = e.clientY;
      if (dy !== 0) onResize(dy);
    };
    const up = () => {
      lastY.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    // Prevent text selection while dragging.
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = "";
    };
  }, [dragging, onResize]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 50 : 10;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        onResize(-step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        onResize(step);
      }
    },
    [onResize],
  );

  return (
    <div className={`flex w-full flex-col items-center ${className ?? ""}`}>
      <button
        type="button"
        aria-label="drag to resize"
        aria-orientation="horizontal"
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        className={`group flex h-5 w-full cursor-ns-resize items-center justify-center rounded border-0 bg-transparent p-0 transition-colors ${
          dragging ? "bg-emerald-700/30" : "hover:bg-zinc-800/60"
        }`}
      >
        <ChevronsUpDown
          size={14}
          className={`transition-colors ${
            dragging ? "text-emerald-300" : "text-zinc-500 group-hover:text-zinc-300"
          }`}
        />
      </button>
      {caption && <span className="mt-0.5 text-[10px] text-zinc-600">{caption}</span>}
    </div>
  );
}
