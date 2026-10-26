"use client";

import { Field, FormMessage, SelectInput, SubmitButton, TextInput, useActionForm } from "@/components/form";
import { addInbox, saveInboxLimits } from "./actions";

export function AddInboxForm() {
  const { state, onSubmit: action, pending } = useActionForm(addInbox);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="max-w-xl space-y-3 rounded-lg border p-4" noValidate>
      <h2 className="font-medium">Add an inbox</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" name="email" error={err.email}>
          <TextInput name="email" type="email" />
        </Field>
        <Field label="Display name" name="displayName" error={err.displayName}>
          <TextInput name="displayName" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending}>Add inbox</SubmitButton>
    </form>
  );
}

export function InboxLimitsForm({
  inbox,
}: {
  inbox: { id: string; display_name: string | null; status: string; daily_draft_cap: number; daily_send_cap: number; min_seconds_between_sends: number };
}) {
  const { state, onSubmit: action, pending } = useActionForm(saveInboxLimits);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={inbox.id} />
      <div className="grid grid-cols-5 gap-3">
        <Field label="Display name" name={`displayName-${inbox.id}`} error={err.displayName}>
          <input id={`displayName-${inbox.id}`} name="displayName" defaultValue={inbox.display_name ?? ""} className="w-full rounded-md border px-3 py-2 text-sm" />
        </Field>
        <Field label="Status" name={`status-${inbox.id}`} error={err.status}>
          <select id={`status-${inbox.id}`} name="status" defaultValue={inbox.status} className="w-full rounded-md border px-3 py-2 text-sm">
            {["disconnected", "active", "paused", "error"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Draft cap / day" name={`dailyDraftCap-${inbox.id}`} error={err.dailyDraftCap}>
          <input id={`dailyDraftCap-${inbox.id}`} name="dailyDraftCap" defaultValue={inbox.daily_draft_cap} className="w-full rounded-md border px-3 py-2 text-sm" />
        </Field>
        <Field label="Send cap / day" name={`dailySendCap-${inbox.id}`} error={err.dailySendCap}>
          <input id={`dailySendCap-${inbox.id}`} name="dailySendCap" defaultValue={inbox.daily_send_cap} className="w-full rounded-md border px-3 py-2 text-sm" />
        </Field>
        <Field label="Seconds between sends" name={`minSecondsBetweenSends-${inbox.id}`} error={err.minSecondsBetweenSends}>
          <input id={`minSecondsBetweenSends-${inbox.id}`} name="minSecondsBetweenSends" defaultValue={inbox.min_seconds_between_sends} className="w-full rounded-md border px-3 py-2 text-sm" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending}>Save limits</SubmitButton>
    </form>
  );
}

export { SelectInput };
