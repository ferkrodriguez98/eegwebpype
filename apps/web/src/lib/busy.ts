"use client";

import { useSyncExternalStore } from "react";

/** Progress info that the GlobalBusyOverlay can render. Mutations whose
 * progress is implicit (start → spinner → done) don't need this; only
 * long-running flows that stream progress (ICA WebSocket) push events
 * here so the overlay can show a real progress bar. */
export type BusyProgress = {
  /** Short phase label, e.g. "fitting ICA" or "filtering". */
  phase: string;
  /** Optional 0..1 fraction. Omit for indeterminate. */
  fraction?: number;
  /** When true, the overlay stays up until the user clicks "OK".
   * Use for ops where the user benefits from explicit confirmation
   * that the long-running step finished (e.g. ICA fit). */
  requiresAck?: boolean;
};

let current: BusyProgress | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Push a progress event. Pass `null` to clear. */
export function setBusyProgress(next: BusyProgress | null): void {
  current = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): BusyProgress | null {
  return current;
}

/** React hook: returns the current progress (or null). */
export function useBusyProgress(): BusyProgress | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
