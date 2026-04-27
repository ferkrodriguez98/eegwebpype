"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Returns a value that only updates when the source has been stable for
 * `delayMs`. Use this for hover-driven UI that's expensive to render or
 * fetches data: while the cursor is moving, no work happens; once it sits
 * still for the delay, the latest value is committed.
 *
 * Pattern:
 *   const [pending, setPending] = useState<T | null>(null);
 *   const settled = useHoverIdle(pending, 200);
 *   // call setPending(...) on every cursor move; render `settled` only.
 */
export function useHoverIdle<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState<T>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delayMs]);

  return settled;
}

/** Like `useHoverIdle` but the consumer drives a ref directly (zero
 * setState while the mouse moves), and the hook commits the ref's current
 * value to React state once the cursor goes idle for `delayMs`. */
export function useIdleCommit<T>(delayMs = 200): {
  push: (next: T | null) => void;
  value: T | null;
} {
  const [value, setValue] = useState<T | null>(null);
  const pending = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback(
    (next: T | null) => {
      // Always cancel any pending commit first. If we don't, a `push(null)`
      // followed by a stale `setTimeout` from the previous push will fire
      // and resurrect the tooltip after the cursor has already left.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      pending.current = next;
      // Clearing the tooltip (next === null) is instant, otherwise a stale
      // tooltip lingers when the cursor leaves the plot.
      if (next === null) {
        setValue(null);
        return;
      }
      timer.current = setTimeout(() => {
        setValue(pending.current);
        timer.current = null;
      }, delayMs);
    },
    [delayMs],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { push, value };
}
