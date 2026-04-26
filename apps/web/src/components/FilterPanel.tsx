"use client";

import { PSDPlot } from "@/components/viz/PSDPlot";
import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";

type Props = { sessionId: string };

export function FilterPanel({ sessionId }: Props) {
  const [lFreq, setLFreq] = useState<number>(0.5);
  const [hFreq, setHFreq] = useState<number>(47);
  const [lTrans, setLTrans] = useState<number>(0.4);
  const [hTrans, setHTrans] = useState<number>(1.5);

  const dLFreq = useDeferredValue(lFreq);
  const dHFreq = useDeferredValue(hFreq);
  const dLTrans = useDeferredValue(lTrans);
  const dHTrans = useDeferredValue(hTrans);

  const preview = useQuery({
    queryKey: ["psd-preview", sessionId, dLFreq, dHFreq, dLTrans, dHTrans],
    queryFn: () =>
      api.psdWithFilter(sessionId, {
        l_freq: dLFreq,
        h_freq: dHFreq,
        l_trans: dLTrans,
        h_trans: dHTrans,
        fmin: 0.1,
        fmax: 100,
      }),
  });

  const append = useAppendEvent(sessionId);

  const onApply = () => {
    append.mutate({
      op: "filter",
      params: {
        l_freq: lFreq,
        h_freq: hFreq,
        l_trans: lTrans,
        h_trans: hTrans,
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FilterField label="l_freq (Hz)" value={lFreq} onChange={setLFreq} step={0.1} />
        <FilterField label="h_freq (Hz)" value={hFreq} onChange={setHFreq} step={1} />
        <FilterField label="l_trans" value={lTrans} onChange={setLTrans} step={0.1} />
        <FilterField label="h_trans" value={hTrans} onChange={setHTrans} step={0.1} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={append.isPending}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          {append.isPending ? "applying…" : `apply filter (${lFreq}–${hFreq} Hz)`}
        </button>
        {preview.isFetching && (
          <span className="text-xs text-zinc-500">preview actualizándose…</span>
        )}
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
        {preview.data ? (
          <PSDPlot
            freqs={preview.data.freqs ?? new Float32Array()}
            channels={Object.entries(preview.data)
              .filter(([k]) => k !== "freqs")
              .map(([name, data]) => ({ name, data }))}
          />
        ) : (
          <div className="grid h-[280px] place-items-center text-sm text-zinc-600">
            {preview.isFetching ? "cargando preview…" : "—"}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-400">
      <span className="uppercase tracking-wider">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm text-zinc-100"
      />
    </label>
  );
}
