"use client";

import { api } from "@/lib/api/client";
import { useAppendEvent } from "@/lib/hooks/useEventLog";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Hash, MapPin } from "lucide-react";

export function SetupBanner({ sessionId }: { sessionId: string }) {
  const setup = useQuery({
    queryKey: ["setup", sessionId],
    queryFn: () => api.setupSuggestions(sessionId),
  });
  const append = useAppendEvent(sessionId);

  if (!setup.data) return null;
  const { detected_montage, montage_already_applied, suggested_sfreq, sfreq_already_resampled } =
    setup.data;

  const hasMontagePending = !!detected_montage && !montage_already_applied;
  const hasResamplePending = !!suggested_sfreq && !sfreq_already_resampled;
  const allDone = !hasMontagePending && !hasResamplePending;

  return (
    <div className="border-b border-zinc-800 px-3 py-2">
      <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">setup</h3>
      <div className="flex flex-col gap-1">
        {hasMontagePending && (
          <button
            type="button"
            onClick={() =>
              append.mutate({
                op: "set_montage",
                params: { montage: detected_montage },
              })
            }
            disabled={append.isPending}
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] hover:bg-zinc-800 disabled:opacity-40"
          >
            <MapPin size={11} className="shrink-0" />
            <span className="truncate">apply {detected_montage}</span>
          </button>
        )}
        {montage_already_applied && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-emerald-400">
            <MapPin size={10} className="shrink-0" />
            <span className="truncate">montage applied</span>
          </span>
        )}
        {hasResamplePending && suggested_sfreq && (
          <button
            type="button"
            onClick={() => append.mutate({ op: "resample", params: { sfreq: suggested_sfreq } })}
            disabled={append.isPending}
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] hover:bg-zinc-800 disabled:opacity-40"
          >
            <Hash size={11} className="shrink-0" />
            <span className="truncate">resample {suggested_sfreq} Hz</span>
          </button>
        )}
        {sfreq_already_resampled && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-emerald-400">
            <Hash size={10} className="shrink-0" />
            <span className="truncate">resampled</span>
          </span>
        )}
        {allDone && montage_already_applied && (
          <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-emerald-400">
            <CheckCircle2 size={10} className="shrink-0" />
            <span>setup ok</span>
          </span>
        )}
      </div>
    </div>
  );
}
