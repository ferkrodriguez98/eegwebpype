"use client";

import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutsOverlay } from "@/components/ShortcutsOverlay";
import { useGlobalShortcuts } from "@/lib/hooks/useGlobalShortcuts";
import { Command, Keyboard } from "lucide-react";

/** Mounts globally-available UI: command palette + shortcuts overlay + a small
 * floating dock that hints at keyboard discoverability. */
export function GlobalChrome() {
  const { paletteOpen, setPaletteOpen, shortcutsOpen, setShortcutsOpen } = useGlobalShortcuts();
  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <div className="pointer-events-none fixed bottom-3 right-3 z-30 flex gap-2">
        <button
          type="button"
          aria-label="Open command palette"
          onClick={() => setPaletteOpen(true)}
          className="pointer-events-auto flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950/90 px-2.5 py-1.5 text-[11px] text-zinc-400 shadow-lg backdrop-blur hover:text-zinc-200"
        >
          <Command size={12} />
          <span className="font-mono">⌘K</span>
        </button>
        <button
          type="button"
          aria-label="Show keyboard shortcuts"
          onClick={() => setShortcutsOpen(true)}
          className="pointer-events-auto flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950/90 px-2.5 py-1.5 text-[11px] text-zinc-400 shadow-lg backdrop-blur hover:text-zinc-200"
        >
          <Keyboard size={12} />
          <span className="font-mono">?</span>
        </button>
      </div>
    </>
  );
}
