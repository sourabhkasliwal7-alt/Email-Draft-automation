"use client";

import type { SettingsInput } from "@outreach/core";
import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, TextInput, useActionForm } from "@/components/form";
import { addPrice, addSpendCap, saveSettings } from "./actions";

export function SettingsForm({ settings }: { settings: SettingsInput }) {
  const { state, onSubmit: action, pending } = useActionForm(saveSettings);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="max-w-xl space-y-4 rounded-lg border p-4" noValidate>
      <h2 className="font-medium">Models, research depth and feature flags</h2>
      <Field label="Extraction model" name="modelExtraction" error={err.modelExtraction}>
        <TextInput name="modelExtraction" defaultValue={settings.modelExtraction} />
      </Field>
      <Field label="Claim-check model" name="modelClaimCheck" error={err.modelClaimCheck}>
        <TextInput name="modelClaimCheck" defaultValue={settings.modelClaimCheck} />
      </Field>
      <Field label="Drafting model" name="modelDrafting" error={err.modelDrafting}>
        <TextInput name="modelDrafting" defaultValue={settings.modelDrafting} />
      </Field>
      <Field label="Default research depth" name="researchDepth" error={err.researchDepth}>
        <SelectInput
          name="researchDepth"
          defaultValue={settings.researchDepth}
          options={[
            { value: "light", label: "Light" },
            { value: "standard", label: "Standard" },
            { value: "deep", label: "Deep" },
          ]}
        />
      </Field>
      <div className="space-y-2">
        <Checkbox name="crunchbaseEnabled" label="CRUNCHBASE_ENABLED (needs a licensed API or CSV export)" defaultChecked={settings.crunchbaseEnabled} />
        <Checkbox name="replyTrackingEnabled" label="REPLY_TRACKING_ENABLED (reads Gmail threads)" defaultChecked={settings.replyTrackingEnabled} />
        <Checkbox name="sendingEnabled" label="SENDING_ENABLED (master switch: nothing is sent while this is off)" defaultChecked={settings.sendingEnabled} />
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Save settings</SubmitButton>
    </form>
  );
}

export function PriceForm() {
  const { state, onSubmit: action, pending } = useActionForm(addPrice);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="space-y-3 rounded-lg border p-4" noValidate>
      <h2 className="font-medium">Add a price</h2>
      <p className="text-xs text-zinc-500">Costs are computed from recorded usage x these prices. A new row applies from now on.</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Provider" name="provider" error={err.provider}>
          <TextInput name="provider" placeholder="anthropic" />
        </Field>
        <Field label="Unit" name="unit" error={err.unit}>
          <TextInput name="unit" placeholder="input_token" />
        </Field>
        <Field label="USD per unit" name="usdPerUnit" error={err.usdPerUnit}>
          <TextInput name="usdPerUnit" placeholder="0.000003" />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending}>Add price</SubmitButton>
    </form>
  );
}

export function SpendCapForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const { state, onSubmit: action, pending } = useActionForm(addSpendCap);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="space-y-3 rounded-lg border p-4" noValidate>
      <h2 className="font-medium">Add a spend cap</h2>
      <p className="text-xs text-zinc-500">No paid call is made once a cap that applies to it would be exceeded.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Scope" name="scope" error={err.scope}>
          <SelectInput name="scope" defaultValue="global" options={[{ value: "global", label: "Global" }, { value: "provider", label: "Provider" }, { value: "campaign", label: "Campaign" }]} />
        </Field>
        <Field label="Period" name="period" error={err.period}>
          <SelectInput name="period" defaultValue="daily" options={[{ value: "daily", label: "Daily" }, { value: "monthly", label: "Monthly" }, { value: "total", label: "Total" }]} />
        </Field>
        <Field label="Cap (USD)" name="capUsd" error={err.capUsd}>
          <TextInput name="capUsd" placeholder="5" />
        </Field>
        <Field label="Provider (if provider scope)" name="provider" error={err.provider}>
          <TextInput name="provider" />
        </Field>
        <Field label="Campaign (if campaign scope)" name="campaignId" error={err.campaignId}>
          <SelectInput name="campaignId" defaultValue="" options={[{ value: "", label: "(choose)" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]} />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pending={pending}>Add cap</SubmitButton>
    </form>
  );
}
