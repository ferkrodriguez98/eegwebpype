"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Option<T extends string | number> = { value: T; label: string };

type Props<T extends string | number> = {
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
};

/** A small headless dropdown that styles consistently with the rest of the app.
 * Visually similar to shadcn/ui's Select but built on a single button + popover
 * so we don't pull in radix-ui just for this one control. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(options.length - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = options[highlight];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, options, highlight, onChange]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setHighlight(
            Math.max(
              0,
              options.findIndex((o) => o.value === value),
            ),
          );
        }}
        className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 hover:bg-zinc-800"
      >
        <span>{current?.label ?? placeholder ?? "—"}</span>
        <ChevronDown size={12} className="text-zinc-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-[8rem] overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-xl">
          <ul className="py-1">
            {options.map((opt, i) => {
              const selected = opt.value === value;
              const active = i === highlight;
              return (
                <li key={String(opt.value)}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-xs ${
                      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {selected && <Check size={12} className="text-emerald-400" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
