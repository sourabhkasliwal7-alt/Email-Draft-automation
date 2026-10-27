"use client";

import { Field, FormMessage, SelectInput, SubmitButton, TextInput, inputClass, useActionForm } from "@/components/form";
import { addSuppression, uploadSuppressionCsv } from "./actions";

type Campaign = { id: string; name: string };

function campaignOptions(campaigns: Campaign[]) {
  return [{ value: "", label: "(choose a campaign)" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))];
}

export function AddSuppressionForm({ campaigns }: { campaigns: Campaign[] }) {
  const { state, onSubmit: action, pending } = useActionForm(addSuppression);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="space-y-3 rounded-xl border bg-card p-4 shadow-card" noValidate>
      <h2 className="font-medium">Add an email or domain</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" name="kind" error={err.kind}>
          <SelectInput name="kind" defaultValue="email" options={[{ value: "email", label: "Email address" }, { value: "domain", label: "Domain" }]} />
        </Field>
        <Field label="Value" name="value" error={err.value}>
          <TextInput name="value" placeholder="person@example.com or example.com" />
        </Field>
        <Field label="Scope" name="scope" error={err.scope}>
          <SelectInput name="scope" defaultValue="global" options={[{ value: "global", label: "Global (all campaigns)" }, { value: "campaign", label: "One campaign" }]} />
        </Field>
        <Field label="Campaign (if scoped)" name="campaignId" error={err.campaignId}>
          <SelectInput name="campaignId" defaultValue="" options={campaignOptions(campaigns)} />
        </Field>
      </div>
      <Field label="Reason" name="reason" error={err.reason}>
        <TextInput name="reason" placeholder="e.g. replied: unsubscribe" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Add to list</SubmitButton>
    </form>
  );
}

export function UploadSuppressionForm({ campaigns }: { campaigns: Campaign[] }) {
  const { state, onSubmit: action, pending } = useActionForm(uploadSuppressionCsv);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="space-y-3 rounded-xl border bg-card p-4 shadow-card" noValidate>
      <h2 className="font-medium">Upload a CSV</h2>
      <p className="text-xs text-zinc-500">
        One column of emails/domains, or a header row with <code>email</code>, <code>domain</code> and optional <code>reason</code>. Max 2 MB / 20,000 rows. Bad rows are reported, never fatal.
      </p>
      <Field label="CSV file" name="file" error={err.file}>
        <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Scope" name="upload-scope" error={err.scope}>
          <select id="upload-scope" name="scope" defaultValue="global" className={inputClass}>
            <option value="global">Global (all campaigns)</option>
            <option value="campaign">One campaign</option>
          </select>
        </Field>
        <Field label="Campaign (if scoped)" name="upload-campaign" error={err.campaignId}>
          <select id="upload-campaign" name="campaignId" defaultValue="" className={inputClass}>
            {campaignOptions(campaigns).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending}>Upload</SubmitButton>
    </form>
  );
}
