"use client";

import { Ban, RotateCcw, SkipForward, Wand2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm";
import { FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { markDncAction, skipLeadAction } from "../attention/actions";
import { retryFailedDraftsAction, retryLeadAction } from "./actions";

/** Retry / Skip / Do not contact for one lead in Needs attention. Skip and Do not contact ask first. */
export function AttentionButtons({ leadId, company, noContact = false }: { leadId: string; company?: string | null; noContact?: boolean }) {
  const { state, onSubmit, pending } = useActionForm(retryLeadAction);
  const who = company ? `this lead at ${company}` : "this lead";
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {!noContact && (
          <form onSubmit={onSubmit}>
            <input type="hidden" name="id" value={leadId} />
            <SubmitButton size="sm" pending={pending} icon={<RotateCcw aria-hidden />}>
              Retry
            </SubmitButton>
          </form>
        )}
        <ActionForm action={skipLeadAction} success="The lead was skipped. It will not be written to in this campaign.">
          <input type="hidden" name="id" value={leadId} />
          <ConfirmButton
            variant="outline"
            size="sm"
            icon={<SkipForward aria-hidden />}
            data-testid="skip-button"
            confirm={{ title: "Skip this lead?", confirmLabel: "Skip lead", tone: "danger", body: <p>No email is written for {who}. You can still find it in Leads.</p> }}
          >
            Skip
          </ConfirmButton>
        </ActionForm>
        <ActionForm action={markDncAction} success="Added to your do-not-contact list. They will never be written to again.">
          <input type="hidden" name="id" value={leadId} />
          <ConfirmButton
            variant="destructive"
            size="sm"
            icon={<Ban aria-hidden />}
            data-testid="dnc-button"
            confirm={{
              title: "Never contact this person?",
              confirmLabel: "Do not contact",
              tone: "danger",
              body: <p>They go on your do-not-contact list for every campaign. No email will be written for them again.</p>,
            }}
          >
            Do not contact
          </ConfirmButton>
        </ActionForm>
      </div>
      <div className="max-w-xs text-left text-xs">
        <FormMessage state={state} />
      </div>
    </div>
  );
}

/** One button for every email that failed its checks: only the writing step runs again. */
export function RetryFailedDraftsButton({ count }: { count: number }) {
  const { state, onSubmit, pending } = useActionForm(() => retryFailedDraftsAction());
  return (
    <div className="space-y-2" data-testid="retry-failed-box">
      <form onSubmit={onSubmit}>
        <ConfirmButton
          pending={pending}
          icon={<Wand2 aria-hidden />}
          data-testid="retry-failed-drafts"
          confirm={{
            title: `Write these ${count} email${count === 1 ? "" : "s"} again?`,
            confirmLabel: "Write again",
            tone: "primary",
            body: <p>Write these {count} emails again? Only the writing step runs. The research, the approval and the email addresses are kept, and no credit is used again.</p>,
          }}
        >
          Retry all {count} failed draft{count === 1 ? "" : "s"}
        </ConfirmButton>
      </form>
      <FormMessage state={state} />
    </div>
  );
}
