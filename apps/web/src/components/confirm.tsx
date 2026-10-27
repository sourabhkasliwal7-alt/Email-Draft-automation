"use client";

import type { VariantProps } from "class-variance-authority";
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type buttonVariants } from "@/components/ui/button";

export interface ConfirmContent {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  /** "danger" for skip / delete / disconnect (red button, focus starts on Cancel), "primary" otherwise */
  tone?: "primary" | "danger";
}

/**
 * A button that asks first. It sits inside a form; pressing the confirm button in the dialog submits that form, so it works with
 * server-action forms and with forms that submit through a handler alike. The dialog is the browser's own dialog element:
 * focus stays inside it, Escape closes it, and a click outside closes it.
 */
export function ConfirmButton({
  confirm,
  children,
  variant,
  size,
  icon,
  className,
  disabled,
  pending: pendingProp,
  "data-testid": testId,
}: {
  confirm: ConfirmContent | ((form: HTMLFormElement | null) => ConfirmContent);
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  pending?: boolean;
  "data-testid"?: string;
} & VariantProps<typeof buttonVariants>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [content, setContent] = useState<ConfirmContent | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const status = useFormStatus();
  const danger = (content?.tone ?? "primary") === "danger";

  function open() {
    const form = trigger.current?.form ?? null;
    setContent(typeof confirm === "function" ? confirm(form) : confirm);
    dialog.current?.showModal();
  }
  function yes() {
    dialog.current?.close();
    trigger.current?.form?.requestSubmit();
  }

  return (
    <>
      <Button ref={trigger} type="button" variant={variant} size={size} icon={icon} className={className} disabled={disabled} pending={pendingProp ?? status.pending} onClick={open} data-testid={testId}>
        {children}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={content?.body ? bodyId : undefined}
        data-testid="confirm-dialog"
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border bg-card p-0 shadow-pop"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close(); // a click on the dim area around the card
        }}
      >
        <div className="space-y-3 p-6">
          <h2 id={titleId} className="text-xl font-semibold">
            {content?.title}
          </h2>
          {content?.body && (
            <div id={bodyId} className="space-y-2 text-sm text-muted-foreground">
              {content.body}
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t bg-muted/40 px-6 py-4">
          <Button type="button" variant="outline" autoFocus={danger} onClick={() => dialog.current?.close()} data-testid="confirm-cancel">
            Cancel
          </Button>
          <Button type="button" variant={danger ? "destructive" : "default"} autoFocus={!danger} onClick={yes} data-testid="confirm-yes">
            {content?.confirmLabel ?? "Yes"}
          </Button>
        </div>
      </dialog>
    </>
  );
}
