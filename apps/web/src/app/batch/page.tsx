"use client";

import { api } from "@/lib/api/client";
import type { BatchRecipe, BatchSessionResult } from "@eegwebpype/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Layers, Play, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const STATUS_ICON: Record<BatchSessionResult["status"], typeof CheckCircle2> = {
  done: CheckCircle2,
  needs_review: AlertTriangle,
  error: XCircle,
};

const STATUS_COLOR: Record<BatchSessionResult["status"], string> = {
  done: "text-emerald-400",
  needs_review: "text-amber-400",
  error: "text-red-400",
};

export default function BatchPage() {
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const run = useMutation({
    mutationFn: (input: { ids: string[]; recipe: BatchRecipe }) =>
      api.runBatch(input.ids, input.recipe),
  });

  const allIds = ws.data?.sessions.map((s) => s.id) ?? [];
  const allChecked = selected.size > 0 && selected.size === allIds.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(allIds));
  };

  const onRun = () => {
    if (selected.size === 0) return;
    const recipe: BatchRecipe = {
      steps: [
        { op: "set_montage", params: { montage: "biosemi128" } },
        { op: "filter", params: { l_freq: 0.5, h_freq: 47, l_trans: 0.4, h_trans: 1.5 } },
      ],
      auto_detect_bads: true,
      pause_threshold: 0.25,
    };
    run.mutate({ ids: Array.from(selected), recipe });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <header>
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← workspace
        </Link>
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-zinc-400" />
          <h1 className="font-mono text-xl">batch processing</h1>
        </div>
        <p className="text-xs text-zinc-500">
          apply a default recipe (montage + bandpass 0.5–47 Hz + auto-detect bads) to multiple
          sessions. sessions ending with &gt;25% bad channels get marked{" "}
          <span className="text-amber-400">needs_review</span>.
        </p>
      </header>

      <section className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleAll}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800"
        >
          {allChecked ? "deselect all" : "select all"}
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={selected.size === 0 || run.isPending}
          className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          <Play size={14} />
          run on {selected.size} session{selected.size === 1 ? "" : "s"}
        </button>
      </section>

      <section className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {ws.data?.sessions.map((s) => (
          <label
            key={s.id}
            className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs"
          >
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
              className="accent-emerald-500"
            />
            <span className="font-mono">{s.id}</span>
          </label>
        ))}
      </section>

      {run.data && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">results</h2>
          <ul className="flex flex-col gap-1">
            {run.data.results.map((r) => {
              const Icon = STATUS_ICON[r.status];
              return (
                <li
                  key={r.session_id}
                  className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs"
                >
                  <Icon size={14} className={STATUS_COLOR[r.status]} />
                  <span className="font-mono">{r.session_id}</span>
                  <span className={STATUS_COLOR[r.status]}>{r.status}</span>
                  <span className="text-zinc-500">
                    {r.n_events_appended} events · {r.n_bads_marked} bads (
                    {(r.bads_fraction * 100).toFixed(0)}%)
                  </span>
                  {r.error && <span className="text-red-400">{r.error}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
