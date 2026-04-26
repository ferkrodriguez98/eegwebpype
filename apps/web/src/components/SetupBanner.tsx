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

  if (!hasMontagePending && !hasResamplePending && montage_already_applied && !suggested_sfreq) {
    return (
      <div className="flex items-center gap-2 rounded border border-emerald-900 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300">
        <CheckCircle2 size={14} />
        <span>setup ok · montage applied</span>
      </div>
    );
  }

  return (
    <section className="rounded border border-zinc-800 bg-zinc-950 p-3">
      <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">setup</h3>
      <div className="flex flex-wrap gap-2">
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
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            <MapPin size={14} />
            apply montage ({detected_montage})
          </button>
        )}
        {montage_already_applied && (
          <span className="flex items-center gap-1.5 rounded border border-zinc-800 px-3 py-1.5 text-xs text-emerald-400">
            <MapPin size={14} />
            montage applied
          </span>
        )}
        {hasResamplePending && suggested_sfreq && (
          <button
            type="button"
            onClick={() => append.mutate({ op: "resample", params: { sfreq: suggested_sfreq } })}
            disabled={append.isPending}
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-40"
          >
            <Hash size={14} />
            resample to {suggested_sfreq} Hz
          </button>
        )}
        {sfreq_already_resampled && (
          <span className="flex items-center gap-1.5 rounded border border-zinc-800 px-3 py-1.5 text-xs text-emerald-400">
            <Hash size={14} />
            resampled
          </span>
        )}
      </div>
    </section>
  );
}
