"use client";

import { X } from "lucide-react";
import { useId, useRef } from "react";
import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

/**
 * A panel that slides in from the right (built on the browser's dialog element: Escape and a click outside close it,
 * focus stays inside). `trigger` is the button's label.
 */
export function Sheet({
  title,
  trigger,
  icon,
  variant = "ghost",
  size,
  triggerClassName,
  children,
  "data-testid": testId,
}: {
  title: string;
  trigger: React.ReactNode;
  icon?: React.ReactNode;
  triggerClassName?: string;
  children: React.ReactNode;
  "data-testid"?: string;
} & VariantProps<typeof buttonVariants>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button type="button" variant={variant} size={size} icon={icon} className={triggerClassName} onClick={() => dialog.current?.showModal()} data-testid={testId}>
        {trigger}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        data-testid="sheet"
        className="m-0 ml-auto h-dvh max-h-none w-[min(94vw,28rem)] max-w-none rounded-l-2xl border-l bg-card p-0 shadow-pop open:flex open:flex-col"
        style={{ animation: "slide-in-right 0.22s ease-out both" }}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={() => dialog.current?.close()}>
            <X aria-hidden />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </dialog>
    </>
  );
}
