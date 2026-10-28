"use client";

import { Field, FormMessage, SubmitButton, inputClass, useActionForm } from "@/components/form";
import { findApolloLeads, findWebCompanies, recheckSkippedLeads } from "./actions";

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

export function FindWebForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const { state, onSubmit, pending } = useActionForm(findWebCompanies);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate data-testid="find-web-form">
      <Field label="Campaign" name="webCampaignId" error={err.campaignId}>
        <select id="webCampaignId" name="campaignId" defaultValue={campaigns[0]?.id ?? ""} className={inputClass}>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending} testId="find-web">Preview companies</SubmitButton>
    </form>
  );
}

/** One button for one campaign: runs the quick check again for its skipped leads. */
export function RecheckForm({ campaignId, count }: { campaignId: string; count: number }) {
  const { state, onSubmit, pending } = useActionForm(recheckSkippedLeads);
  return (
    <form onSubmit={onSubmit} noValidate data-testid={`recheck-form-${campaignId}`} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <SubmitButton variant="outline" size="sm" pending={pending} testId="recheck-skipped">
        Re-check {count} skipped {count === 1 ? "lead" : "leads"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
