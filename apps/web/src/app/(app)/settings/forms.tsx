"use client";

import type { SettingsInput } from "@outreach/core";
import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, TextArea, TextInput, useActionForm } from "@/components/form";
import { addPrice, addSpendCap, saveSettings, saveWorkflowSettings } from "./actions";

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

export function WorkflowSettingsForm({ values, scheduleEnabled, dryRun, allowRisky }: { values: Record<string, string>; scheduleEnabled: boolean; dryRun: boolean; allowRisky: boolean }) {
  const { state, onSubmit: action, pending } = useActionForm(saveWorkflowSettings);
  const err = state.fieldErrors ?? {};
  const text = (name: string, label: string, hint?: string) => (
    <Field label={label} name={name} error={err[name]} hint={hint}>
      <TextInput name={name} defaultValue={values[name]} />
    </Field>
  );
  const area = (name: string, label: string, hint?: string, rows = 3) => (
    <Field label={label} name={name} error={err[name]} hint={hint}>
      <TextArea name={name} defaultValue={values[name]} rows={rows} />
    </Field>
  );
  return (
    <form onSubmit={action} className="max-w-2xl space-y-4 rounded-lg border p-4" noValidate data-testid="workflow-settings">
      <h2 className="font-medium">Daily run: schedule, limits and email text</h2>
      <div className="grid grid-cols-2 gap-3">
        {text("run_time_ist", "Daily start time (IST)", "Weekdays only, 24-hour HH:MM")}
        {text("approve_threshold", "Approval cut-off (0-100)", "Only leads at or above this score are approved")}
        {text("daily_reveal_cap", "Reveal credits per day")}
        {text("monthly_credit_cap", "Reveal credits per month")}
        {text("same_company_cooldown_days", "Same-company wait (days)")}
        {text("run_limit_minutes", "Run time limit (minutes)")}
      </div>
      <div className="space-y-2">
        <Checkbox name="schedule_enabled" label="Run automatically every weekday at the start time (campaigns that are Active)" defaultChecked={scheduleEnabled} />
        <Checkbox name="dry_run" label="Always dry run (no Apollo credits, no Gmail drafts)" defaultChecked={dryRun} />
        <Checkbox name="allow_risky" label="Also draft for risky or catch-all emails" defaultChecked={allowRisky} />
      </div>
      {area("postal_address", "Postal address (email footer)", "Required before real drafts are made", 2)}
      {area("optout_line", "Opt-out line (email footer)", "Required before real drafts are made", 2)}
      {area("white_label_line", "White-label line (used word for word)", undefined, 2)}
      {area("style_guide", "Writing style", undefined, 3)}
      {area("tools_by_industry", "Tools sentence by industry", "One line each: keyword: sentence. A line starting with default: is the fallback.", 3)}
      {area("reference_emails", "Example emails to copy the voice of", "Separate several with a line containing only ---", 5)}
      <div className="grid grid-cols-2 gap-3">
        {area("excluded_domains", "Excluded domains", "One per line")}
        {area("excluded_titles", "Excluded job titles", "One per line, part of a title is enough")}
        {area("banned_phrases", "Banned phrases", "One per line")}
        {area("countries_in_scope", "Countries in scope", "One per line. Empty means all.")}
        {area("holidays", "Holidays (no run)", "One date per line, YYYY-MM-DD")}
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Save run settings</SubmitButton>
    </form>
  );
}
