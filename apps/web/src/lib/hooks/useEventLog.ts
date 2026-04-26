"use client";

import { api } from "@/lib/api/client";
import type { EventInput, SessionState } from "@eegwebpype/shared";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function useSession(id: string) {
  return useQuery({ queryKey: ["session", id], queryFn: () => api.session(id) });
}

/** Invalidate every query whose result depends on the session's current raw.
 * Called after any append or undo so the UI reflects the new state. */
function invalidateDerivedQueries(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: ["signal", id] });
  qc.invalidateQueries({ queryKey: ["psd", id] });
  qc.invalidateQueries({ queryKey: ["psd-preview", id] });
  qc.invalidateQueries({ queryKey: ["topomap", id] });
  qc.invalidateQueries({ queryKey: ["epochs", id] });
  qc.invalidateQueries({ queryKey: ["ica-components", id] });
  qc.invalidateQueries({ queryKey: ["setup", id] });
}

export function useAppendEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: EventInput) => api.appendEvent(id, payload),
    onSuccess: (data: SessionState) => {
      qc.setQueryData(["session", id], data);
      invalidateDerivedQueries(qc, id);
    },
  });
}

export function useUndo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.undoLast(id),
    onSuccess: (data: SessionState) => {
      qc.setQueryData(["session", id], data);
      invalidateDerivedQueries(qc, id);
    },
  });
}

/** Bind Cmd/Ctrl+Z to undo while the user is on a session view. */
export function useUndoShortcut(undo: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);
}
