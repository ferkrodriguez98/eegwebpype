"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Optional max-width override (Tailwind class name). */
  maxWidthClass?: string;
};

/** Lightweight modal: backdrop dims the rest of the page, ESC and
 * backdrop click close it. No focus trap or portal — kept simple, since
 * the pages it lives in already use a single dark theme and a single
 * scroll container. */
export function Modal({ open, onClose, title, children, maxWidthClass = "max-w-lg" }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    // Prevent the underlying page from scrolling while the modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> conflicts with React state-driven open/close
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop: clicking it closes. */}
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div
        className={`relative w-full ${maxWidthClass} rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm uppercase tracking-wider text-zinc-300">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 text-sm text-zinc-300">{children}</div>
      </div>
    </div>
  );
}
