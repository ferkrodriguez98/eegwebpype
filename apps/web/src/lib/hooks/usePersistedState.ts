"use client";

import { useEffect, useRef, useState } from "react";

const NAMESPACE = "eegwebpype:v1";

/** Stable session-scoped key, e.g. "eegwebpype:v1:AB11_D1:ica-excluded". */
function fullKey(scope: string, name: string): string {
  return `${NAMESPACE}:${scope}:${name}`;
}

function readFromStorage<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function writeToStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — silently no-op.
  }
}

/** Drop-in replacement for `useState` that persists its value to
 * localStorage under `eegwebpype:v1:<scope>:<name>`. The value is read
 * once at mount, written on every change. SSR-safe: returns the
 * default during server render and rehydrates on the client.
 *
 * Use for things the user will be annoyed to lose on reload —
 * pre-apply filter settings, ICA exclusion selection, etc. Don't use
 * for ephemeral UI state (scroll position, hover) where persistence
 * would surprise more than help. */
export function usePersistedState<T>(
  scope: string,
  name: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const key = fullKey(scope, name);
  const [value, setValue] = useState<T>(defaultValue);
  const hydratedRef = useRef(false);

  // Hydrate from storage once on mount. We can't initialise via the
  // useState lazy init because Next.js SSR would generate different
  // markup than the client and React would warn.
  useEffect(() => {
    const stored = readFromStorage<T>(key);
    if (stored !== undefined) {
      setValue(stored);
    }
    hydratedRef.current = true;
  }, [key]);

  // Mirror writes to storage. Skip the very first render so the SSR
  // default doesn't overwrite a real stored value before hydration
  // has a chance to run.
  useEffect(() => {
    if (!hydratedRef.current) return;
    writeToStorage(key, value);
  }, [key, value]);

  return [value, setValue];
}
