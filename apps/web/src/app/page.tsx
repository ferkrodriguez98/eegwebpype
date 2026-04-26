"use client";

import { ExternalRoots } from "@/components/ExternalRoots";
import { HealthCheck } from "@/components/HealthCheck";
import { api } from "@/lib/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

export default function HomePage() {
  const qc = useQueryClient();
  const ws = useQuery({ queryKey: ["workspace"], queryFn: api.workspace });
  const scan = useMutation({
    mutationFn: api.scanWorkspace,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace"] }),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">eegwebpype</h1>
          <p className="text-sm text-zinc-400">workspace</p>
        </div>
        <HealthCheck />
      </header>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
        >
          {scan.isPending ? "scanning…" : "scan sources"}
        </button>
        <span className="text-xs text-zinc-500">
          .bdf/.fif en{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono">data/sources/</code> +
          external roots
        </span>
      </div>

      <ExternalRoots />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ws.data?.sessions.map((s) => (
          <Link
            key={s.id}
            href={`/session/${s.id}`}
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-600 hover:bg-zinc-900"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg">{s.subject}</span>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs">{s.session}</span>
            </div>
            <div className="mt-2 text-xs text-zinc-500">{s.status}</div>
          </Link>
        ))}
        {ws.data && ws.data.sessions.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            no hay sesiones. poné archivos en{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono">data/sources/</code> y
            tocá "scan sources".
          </div>
        )}
      </section>
    </main>
  );
}
