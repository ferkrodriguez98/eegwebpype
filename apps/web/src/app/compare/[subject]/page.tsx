"use client";

import { PSDPlot } from "@/components/viz/PSDPlot";
import { api } from "@/lib/api/client";
import type { CompareResponse, SessionState } from "@eegwebpype/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { use } from "react";

type ParamsP = Promise<{ subject: string }>;

export default function ComparePage({ params }: { params: ParamsP }) {
  const { subject } = use(params);
  const cmp = useQuery({
    queryKey: ["compare", subject],
    queryFn: () => api.compare(subject),
    retry: false,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 p-6">
      <header>
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← workspace
        </Link>
        <div className="flex items-center gap-2">
          <ArrowLeftRight size={20} className="text-zinc-400" />
          <h1 className="font-mono text-xl">{subject} · compare D1 vs D2</h1>
        </div>
      </header>

      {cmp.isError && (
        <div className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {String(cmp.error)}
        </div>
      )}

      {cmp.data && <DiffPanel data={cmp.data} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SessionColumn label="D1" subject={subject} state={cmp.data?.d1 ?? null} sessionTag="D1" />
        <SessionColumn label="D2" subject={subject} state={cmp.data?.d2 ?? null} sessionTag="D2" />
      </div>
    </main>
  );
}

function DiffPanel({ data }: { data: CompareResponse }) {
  const { diff_only_d1, diff_only_d2, diff_in_both } = data;
  return (
    <section className="rounded border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">diff de canales malos</h2>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <DiffColumn label="solo D1" channels={diff_only_d1} color="amber" />
        <DiffColumn label="solo D2" channels={diff_only_d2} color="cyan" />
        <DiffColumn label="ambos" channels={diff_in_both} color="zinc" />
      </div>
    </section>
  );
}

function DiffColumn({
  label,
  channels,
  color,
}: {
  label: string;
  channels: string[];
  color: "amber" | "cyan" | "zinc";
}) {
  const palette: Record<typeof color, string> = {
    amber: "bg-amber-900 text-amber-100",
    cyan: "bg-cyan-900 text-cyan-100",
    zinc: "bg-zinc-700 text-zinc-100",
  };
  return (
    <div>
      <div className="mb-1 text-zinc-400">
        {label} ({channels.length})
      </div>
      {channels.length === 0 ? (
        <span className="text-zinc-600">—</span>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {channels.map((c) => (
            <li key={c} className={`rounded px-2 py-0.5 font-mono text-[10px] ${palette[color]}`}>
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionColumn({
  label,
  subject,
  state,
  sessionTag,
}: {
  label: string;
  subject: string;
  state: SessionState | null;
  sessionTag: "D1" | "D2";
}) {
  const sessionId = state?.id ?? `${subject}_${sessionTag}`;
  const psd = useQuery({
    queryKey: ["psd", sessionId],
    queryFn: () => api.psd(sessionId, { fmin: 1, fmax: 47 }),
    enabled: !!state,
  });

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-sm text-zinc-100">{label}</span>
        {state && (
          <Link href={`/session/${state.id}`} className="text-xs text-zinc-500 hover:text-zinc-300">
            abrir →
          </Link>
        )}
      </div>
      {!state && <p className="text-xs text-zinc-600">sin sesión {label} para este sujeto</p>}
      {state && (
        <p className="text-xs text-zinc-500">
          {state.metadata.n_channels_current} canales · {state.metadata.sfreq_current} Hz ·{" "}
          {state.metadata.duration_seconds.toFixed(1)} s · {state.events.length} eventos
        </p>
      )}
      {psd.data && (
        <PSDPlot
          freqs={psd.data.freqs ?? new Float32Array()}
          channels={Object.entries(psd.data)
            .filter(([k]) => k !== "freqs")
            .map(([name, data]) => ({ name, data }))}
          height={220}
        />
      )}
    </div>
  );
}
