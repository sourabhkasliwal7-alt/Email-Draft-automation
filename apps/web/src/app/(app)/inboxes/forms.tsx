"use client";

import { Field, FormMessage, SelectInput, SubmitButton, TextInput, inputClass, useActionForm } from "@/components/form";
import { Card } from "@/components/ui/card";
import { addInbox, saveInboxLimits } from "./actions";

/** The small "Add mailbox" form. It appears when you press Add mailbox (or when there is no mailbox yet). */
export function AddInboxForm() {
  const { state, onSubmit: action, pending } = useActionForm(addInbox);
  const err = state.fieldErrors ?? {};
  return (
    <Card id="add-mailbox" className="max-w-xl p-5">
      <form onSubmit={action} className="space-y-4" noValidate data-testid="form-add-mailbox">
        <h2 className="text-lg font-semibold">Add a mailbox</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gmail address" name="email" error={err.email}>
            <TextInput name="email" type="email" />
          </Field>
          <Field label="Display name" name="displayName" error={err.displayName} hint="Optional. Shown in your drafts.">
            <TextInput name="displayName" />
          </Field>
        </div>
        <FormMessage state={state} />
        <SubmitButton pending={pending}>Add mailbox</SubmitButton>
      </form>
    </Card>
  );
}

export function InboxLimitsForm({
  inbox,
}: {
  inbox: { id: string; display_name: string | null; status: string; daily_draft_cap: number; daily_send_cap: number; min_seconds_between_sends: number };
}) {
  const { state, onSubmit: action, pending } = useActionForm(saveInboxLimits);
  const err = state.fieldErrors ?? {};
  const switchable = inbox.status === "active" || inbox.status === "paused" || inbox.status === "error";
  return (
    <form onSubmit={action} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={inbox.id} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Display name" name={`displayName-${inbox.id}`} error={err.displayName}>
          <input id={`displayName-${inbox.id}`} name="displayName" defaultValue={inbox.display_name ?? ""} className={inputClass} />
        </Field>
        <Field label="Status" name={`status-${inbox.id}`} error={err.status} hint={switchable ? undefined : "Set by the Google connection"}>
          {switchable ? (
            <select id={`status-${inbox.id}`} name="status" defaultValue={inbox.status === "paused" ? "paused" : "active"} className={`${inputClass} pr-9`}>
              <option value="active">active</option>
              <option value="paused">paused</option>
            </select>
          ) : (
            <>
              <input type="hidden" name="status" value={inbox.status} />
              <p className="rounded-lg border bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">{inbox.status.replace("_", " ")}</p>
            </>
          )}
        </Field>
        <Field label="Drafts per day (limit)" name={`dailyDraftCap-${inbox.id}`} error={err.dailyDraftCap}>
          <input id={`dailyDraftCap-${inbox.id}`} name="dailyDraftCap" defaultValue={inbox.daily_draft_cap} className={inputClass} />
        </Field>
        {/* sending is not part of this tool: these two keep their saved values */}
        <input type="hidden" name="dailySendCap" value={inbox.daily_send_cap} />
        <input type="hidden" name="minSecondsBetweenSends" value={inbox.min_seconds_between_sends} />
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending}>
        Save limits
      </SubmitButton>
    </form>
  );
}

export { SelectInput };
