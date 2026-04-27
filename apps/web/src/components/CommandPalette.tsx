"use client";

import { api } from "@/lib/api/client";
import type { SessionRef } from "@eegwebpype/shared";
import { useQuery } from "@tanstack/react-query";
import { Layers, Search, Undo2, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Command =
  | { kind: "nav"; id: string; label: string; href: string; hint?: string; icon: typeof Layers }
  | {
      kind: "action";
      id: string;
      label: string;
      run: () => void;
      hint?: string;
      icon: typeof Undo2;
    };

type Props = {
  open: boolean;
  onClose: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  /** Optional callback used to switch tabs inside a session view. */
  onGoToTab?: (tab: string) => void;
  /** Tabs that are valid in the current view (so we only suggest reachable ones). */
  availableTabs?: string[];
};

export function CommandPalette({
  open,
  onClose,
  onUndo,
  canUndo = false,
  onGoToTab,
  availableTabs,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const ws = useQuery({
    queryKey: ["workspace"],
    queryFn: api.workspace,
    enabled: open,
    staleTime: 30_000,
  });

  // Reset state when opening.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        kind: "nav",
        id: "nav:workspace",
        label: "Go to workspace",
        href: "/",
        hint: "Home",
        icon: Workflow,
      },
      {
        kind: "nav",
        id: "nav:batch",
        label: "Go to batch processing",
        href: "/batch",
        hint: "Batch",
        icon: Layers,
      },
    ];

    if (canUndo && onUndo) {
      list.push({
        kind: "action",
        id: "action:undo",
        label: "Undo last event",
        run: () => {
          onUndo();
          onClose();
        },
        hint: "Cmd+Z",
        icon: Undo2,
      });
    }

    if (onGoToTab && availableTabs?.length) {
      for (const tab of availableTabs) {
        list.push({
          kind: "action",
          id: `tab:${tab}`,
          label: `Switch to ${tab}`,
          run: () => {
            onGoToTab(tab);
            onClose();
          },
          hint: "Tab",
          icon: Workflow,
        });
      }
    }

    for (const s of (ws.data?.sessions as SessionRef[] | undefined) ?? []) {
      list.push({
        kind: "nav",
        id: `session:${s.id}`,
        label: `${s.subject} ${s.session}`,
        href: `/session/${s.id}`,
        hint: s.status,
        icon: Workflow,
      });
    }

    const subjectsSeen = new Set<string>();
    for (const s of (ws.data?.sessions as SessionRef[] | undefined) ?? []) {
      if (subjectsSeen.has(s.subject)) continue;
      subjectsSeen.add(s.subject);
      list.push({
        kind: "nav",
        id: `compare:${s.subject}`,
        label: `Compare ${s.subject} D1 vs D2`,
        href: `/compare/${s.subject}`,
        hint: "Compare",
        icon: Workflow,
      });
    }

    return list;
  }, [ws.data, canUndo, onUndo, onClose, onGoToTab, availableTabs]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.trim().toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, []);

  // Lock scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Keyboard handlers inside the palette.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[activeIdx];
        if (!cmd) return;
        if (cmd.kind === "nav") {
          router.push(cmd.href);
          onClose();
        } else {
          cmd.run();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, filtered, activeIdx, onClose, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Search size={14} className="text-zinc-500" />
          <input
            // biome-ignore lint/a11y/noAutofocus: command palette UX
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Type a command or session id…"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
            esc
          </kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-zinc-600">no matches</li>
          )}
          {filtered.map((c, i) => {
            const Icon = c.icon;
            const active = i === activeIdx;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    if (c.kind === "nav") {
                      router.push(c.href);
                      onClose();
                    } else {
                      c.run();
                    }
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300"
                  }`}
                >
                  <Icon size={14} className="text-zinc-500" />
                  <span className="flex-1">{c.label}</span>
                  {c.hint && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {c.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
