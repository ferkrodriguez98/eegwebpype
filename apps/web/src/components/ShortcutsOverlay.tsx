"use client";

import { Keyboard } from "lucide-react";

type Shortcut = {
  keys: string[];
  description: string;
};

const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: "Global",
    items: [
      { keys: ["Cmd", "K"], description: "Open command palette" },
      { keys: ["?"], description: "Toggle this help" },
      { keys: ["Esc"], description: "Close overlay" },
    ],
  },
  {
    group: "Session view",
    items: [
      { keys: ["Cmd", "Z"], description: "Undo last event" },
      { keys: ["["], description: "Previous tab" },
      { keys: ["]"], description: "Next tab" },
    ],
  },
];

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "?") onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <Keyboard size={16} className="text-zinc-400" />
          <h2 className="text-sm uppercase tracking-wider text-zinc-300">keyboard shortcuts</h2>
        </div>
        <div className="flex flex-col gap-4">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                {g.group}
              </div>
              <ul className="flex flex-col gap-1">
                {g.items.map((s) => (
                  <li
                    key={s.description}
                    className="flex items-center justify-between gap-3 text-xs text-zinc-300"
                  >
                    <span>{s.description}</span>
                    <span className="flex gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-[24px] rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-center text-[10px] font-mono text-zinc-300"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
