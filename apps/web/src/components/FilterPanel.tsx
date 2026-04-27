"use client";

import { Skeleton } from "@/components/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { PSDPlot } from "@/components/viz/PSDPlot";
import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import type { SessionState } from "@eegwebpype/shared";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

type Props = { sessionId: string; state?: SessionState | undefined };

const PLOT_HEIGHT = 500;

export function FilterPanel({ sessionId, state }: Props) {
  const [lFreq, setLFreq] = useState<number>(0.5);
  const [hFreq, setHFreq] = useState<number>(47);
  const [lTrans, setLTrans] = useState<number>(0.4);
  const [hTrans, setHTrans] = useState<number>(1.5);
  const [helpOpen, setHelpOpen] = useState(false);

  const dLFreq = useDeferredValue(lFreq);
  const dHFreq = useDeferredValue(hFreq);
  const dLTrans = useDeferredValue(lTrans);
  const dHTrans = useDeferredValue(hTrans);

  // Channels currently flagged as bad — we drop them from the preview
  // so a single noisy electrode doesn't compress the y-axis range.
  const badChannels = useMemo(() => {
    const bads = new Set<string>();
    if (!state) return bads;
    for (const ev of state.events) {
      if (ev.op === "mark_bad") for (const c of ev.params.channels) bads.add(c);
      else if (ev.op === "unmark_bad") for (const c of ev.params.channels) bads.delete(c);
      else if (ev.op === "interpolate_bads") bads.clear();
    }
    return bads;
  }, [state]);

  // Original (unfiltered) PSD — fetched once and reused as the
  // "before" reference behind the filtered preview.
  const original = useQuery({
    queryKey: ["psd", sessionId],
    queryFn: () => api.psd(sessionId, { fmin: 0.1, fmax: 100 }),
  });

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

  // Strip bad channels and the `freqs` axis out of an arrow record so
  // we end up with the list of healthy-channel series for the plot.
  const channelsFromArrow = (
    arrow: Record<string, Float32Array> | undefined,
  ): { name: string; data: Float32Array }[] => {
    if (!arrow) return [];
    return Object.entries(arrow)
      .filter(([k]) => k !== "freqs" && !badChannels.has(k))
      .map(([name, data]) => ({ name, data }));
  };

  const previewChannels = channelsFromArrow(preview.data);
  const originalChannels = channelsFromArrow(original.data);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FilterField
          label="l_freq (Hz)"
          hint="high-pass cutoff"
          value={lFreq}
          onChange={setLFreq}
          step={0.1}
        />
        <FilterField
          label="h_freq (Hz)"
          hint="low-pass cutoff"
          value={hFreq}
          onChange={setHFreq}
          step={1}
        />
        <FilterField
          label="l_trans (Hz)"
          hint="high-pass transition width"
          value={lTrans}
          onChange={setLTrans}
          step={0.1}
        />
        <FilterField
          label="h_trans (Hz)"
          hint="low-pass transition width"
          value={hTrans}
          onChange={setHTrans}
          step={0.1}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onApply}
          disabled={append.isPending}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          {append.isPending ? "applying…" : `apply filter (${lFreq}–${hFreq} Hz)`}
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          <Info size={11} />
          what is this?
        </button>
        {preview.isFetching && <span className="text-xs text-zinc-500">preview updating…</span>}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 bg-zinc-500/50" />
            before
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 bg-violet-400/80" />
            after
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 border-t border-dashed border-emerald-400" />
            cutoffs
          </span>
          {badChannels.size > 0 && (
            <span className="text-zinc-600">· {badChannels.size} bad channels excluded</span>
          )}
        </div>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
        {preview.data ? (
          <PSDPlot
            freqs={preview.data.freqs ?? new Float32Array()}
            channels={previewChannels}
            referenceChannels={
              originalChannels.length > 0 &&
              original.data?.freqs &&
              preview.data.freqs &&
              original.data.freqs.length === preview.data.freqs.length
                ? originalChannels
                : undefined
            }
            verticalMarkers={[
              { freq: lFreq, label: `l_freq ${lFreq}` },
              { freq: hFreq, label: `h_freq ${hFreq}` },
            ]}
            height={PLOT_HEIGHT}
          />
        ) : (
          <Skeleton height={PLOT_HEIGHT} label={preview.isFetching ? "computing preview…" : "—"} />
        )}
      </div>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="filter parameters"
        maxWidthClass="max-w-2xl"
      >
        <div className="flex flex-col gap-4">
          <p className="text-zinc-300">
            This is a zero-phase FIR band-pass filter (MNE-Python's default). It attenuates
            frequencies outside <span className="font-mono text-zinc-100">[l_freq, h_freq]</span>{" "}
            without distorting the timing of remaining signals.
          </p>

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">
              cutoff frequencies
            </div>
            <ul className="flex flex-col gap-2">
              <li>
                <span className="font-mono text-zinc-100">l_freq</span>{" "}
                <span className="text-zinc-500">— high-pass cutoff (Hz).</span> Removes drift below
                this frequency. Typical resting EEG: <span className="font-mono">0.5</span>.
              </li>
              <li>
                <span className="font-mono text-zinc-100">h_freq</span>{" "}
                <span className="text-zinc-500">— low-pass cutoff (Hz).</span> Removes
                high-frequency noise above this. Typical resting EEG:{" "}
                <span className="font-mono">47</span> (just under 50 Hz line noise).
              </li>
            </ul>
          </div>

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">
              transition bandwidths
            </div>
            <p className="mb-2 text-zinc-400">
              An ideal filter would cut sharply at the cutoff. Real filters need a{" "}
              <span className="text-zinc-100">transition band</span> where attenuation goes from 0
              to −6 dB. The width of that band is what these knobs control.
            </p>
            <ul className="flex flex-col gap-2">
              <li>
                <span className="font-mono text-zinc-100">l_trans</span>{" "}
                <span className="text-zinc-500">— width of the high-pass transition (Hz).</span>{" "}
                Default <span className="font-mono">0.4</span>. With{" "}
                <span className="font-mono">l_freq=0.5</span>, the transition runs roughly from{" "}
                <span className="font-mono">0.3 Hz</span> to{" "}
                <span className="font-mono">0.7 Hz</span>.
              </li>
              <li>
                <span className="font-mono text-zinc-100">h_trans</span>{" "}
                <span className="text-zinc-500">— width of the low-pass transition (Hz).</span>{" "}
                Default <span className="font-mono">1.5</span>. With{" "}
                <span className="font-mono">h_freq=47</span>, the transition runs roughly from{" "}
                <span className="font-mono">46.25 Hz</span> to{" "}
                <span className="font-mono">47.75 Hz</span>.
              </li>
            </ul>
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-zinc-400">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">tradeoff</div>
            <p>
              Narrower transitions are more selective but introduce ringing artefacts in the time
              domain. Wider transitions are smoother but let more out-of-band content through. MNE's
              defaults are conservative and work well for typical resting-state analyses.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FilterField({
  label,
  hint,
  value,
  onChange,
  step,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-400">
      <span className="uppercase tracking-wider">{label}</span>
      {hint && <span className="text-[9px] normal-case text-zinc-600">{hint}</span>}
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
