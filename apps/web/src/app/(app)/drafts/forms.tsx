"use client";

import { FormMessage, useActionForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { markDncAction, skipLeadAction } from "../attention/actions";
import { retryLeadAction } from "./actions";

/** Retry / Skip / Do not contact for one lead in Needs attention. */
export function AttentionButtons({ leadId }: { leadId: string }) {
  const { state, onSubmit, pending } = useActionForm(retryLeadAction);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <form onSubmit={onSubmit}>
          <input type="hidden" name="id" value={leadId} />
          <Button type="submit" size="sm" disabled={pending} data-testid="retry-button">{pending ? "Working…" : "Retry"}</Button>
        </form>
        <form action={skipLeadAction}>
          <input type="hidden" name="id" value={leadId} />
          <Button type="submit" variant="outline" size="sm" data-testid="skip-button">Skip</Button>
        </form>
        <form action={markDncAction}>
          <input type="hidden" name="id" value={leadId} />
          <Button type="submit" variant="destructive" size="sm">Do not contact</Button>
        </form>
      </div>
      <div className="max-w-xs text-left text-xs"><FormMessage state={state} /></div>
    </div>
  );
}
