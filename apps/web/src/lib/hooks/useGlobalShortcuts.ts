"use client";

import { useEffect, useState } from "react";

/** Wires global keyboard shortcuts that don't depend on a specific page. */
export function useGlobalShortcuts() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      // Cmd+K / Ctrl+K → command palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // ? → shortcuts overlay (when not typing)
      if (!isInput && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    paletteOpen,
    setPaletteOpen,
    shortcutsOpen,
    setShortcutsOpen,
  };
}
