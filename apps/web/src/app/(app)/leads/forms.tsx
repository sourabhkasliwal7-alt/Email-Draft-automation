"use client";

import { Field, FormMessage, SubmitButton, inputClass, useActionForm } from "@/components/form";
import { findApolloLeads } from "./actions";

export function FindApolloForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const { state, onSubmit, pending } = useActionForm(findApolloLeads);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate data-testid="find-apollo-form">
      {/* its own id: the upload card on the same page has a field with the id campaignId */}
      <Field label="Campaign" name="apolloCampaignId" error={err.campaignId}>
        <select id="apolloCampaignId" name="campaignId" defaultValue={campaigns[0]?.id ?? ""} className={inputClass}>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending}>Preview Apollo leads (optional)</SubmitButton>
    </form>
  );
}
