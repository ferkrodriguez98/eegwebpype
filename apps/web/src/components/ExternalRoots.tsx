"use client";

import { api } from "@/lib/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function ExternalRoots() {
  const qc = useQueryClient();
  const roots = useQuery({ queryKey: ["external-roots"], queryFn: api.externalRoots });
  const [draft, setDraft] = useState<string>("");

  useEffect(() => {
    if (roots.data) setDraft(roots.data.external_roots.join("\n"));
  }, [roots.data]);

  const save = useMutation({
    mutationFn: (paths: string[]) => api.setExternalRoots(paths),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["external-roots"] });
      qc.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const onSave = () => {
    const lines = draft
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    save.mutate(lines);
  };

  return (
    <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <summary className="cursor-pointer text-sm text-zinc-300">
        external read-only roots ({roots.data?.external_roots.length ?? 0})
      </summary>
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-xs text-zinc-500">
          absolute paths to folders containing .bdf files you want to read in place. one per line.
          files inside these folders are read-only — pype never modifies them.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-24 w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
          placeholder="/path/to/your/eeg/data"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={save.isPending}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
          >
            {save.isPending ? "saving…" : "save"}
          </button>
          {save.isError && <span className="text-xs text-red-400">{String(save.error)}</span>}
          {save.isSuccess && <span className="text-xs text-emerald-400">saved</span>}
        </div>
      </div>
    </details>
  );
}
