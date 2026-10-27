"use client";

import { HelpCircle } from "lucide-react";
import { useId, useState } from "react";

/**
 * A small (?) next to a word a non-technical person may not know. Opens on hover, keyboard focus or tap, closes on Escape.
 * The explanation is announced through aria-describedby. The button is named "More information" on purpose: a name that repeated the field label
 * would make the label and its (?) button answer to the same name (confusing for screen readers and for tests that look a field up by its label).
 */
export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label="More information"
        data-topic={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="inline-grid size-5 place-items-center rounded-full text-zinc-400 transition-colors hover:text-brand focus-visible:text-brand"
      >
        <HelpCircle className="size-4" aria-hidden />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute top-full left-1/2 z-40 mt-2 w-64 max-w-[78vw] -translate-x-1/2 rounded-xl border bg-card p-3 text-left text-xs leading-relaxed font-normal text-foreground shadow-pop">
          {children}
        </span>
      )}
    </span>
  );
}
