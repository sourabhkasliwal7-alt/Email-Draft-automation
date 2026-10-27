"use client";

import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, useActionForm } from "@/components/form";
import { startRunAction } from "./actions";

export function StartRunForm({ campaigns, estimate }: { campaigns: { id: string; name: string }[]; estimate: Record<string, string> }) {
  const { state, onSubmit, pending } = useActionForm(startRunAction);
  const err = state.fieldErrors ?? {};
  return (
    <form
      noValidate
      className="max-w-xl space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        const data = new FormData(e.currentTarget);
        const dry = data.has("dryRun");
        const line = estimate[String(data.get("campaignId") ?? "")] ?? "";
        const ok = window.confirm(`${dry ? "Dry run: nothing is spent and no Gmail drafts are made." : "This will create Gmail drafts (nothing is sent)."}\n\n${line}\n\nStart now?`);
        if (!ok) e.preventDefault();
        else onSubmit(e);
      }}
    >
      <h2 className="font-medium">Start a run</h2>
      <Field label="Campaign" name="campaignId" error={err.campaignId}>
        <SelectInput name="campaignId" defaultValue={campaigns[0]?.id ?? ""} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Checkbox name="dryRun" label="Dry run (search, check and score only: no Apollo credits, no Gmail drafts)" />
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Start</SubmitButton>
    </form>
  );
}
