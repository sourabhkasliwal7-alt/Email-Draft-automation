"use client";

import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, TextArea, TextInput, useActionForm } from "@/components/form";
import type { ActionState } from "@/lib/auth";
import { addPrice, addSpendCap, saveCredits, saveFooter, saveModels, saveRunRules, saveSchedule, saveWritingRules } from "./actions";

type SaveAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** A small settings form: fields in, one Save button, message below. */
function SettingsCard({ testId, title, hint, action, button, children }: { testId: string; title?: string; hint?: string; action: SaveAction; button: string; children: (err: Record<string, string>) => React.ReactNode }) {
  const { state, onSubmit, pending } = useActionForm(action);
  return (
    <form onSubmit={onSubmit} noValidate data-testid={testId} className="max-w-3xl space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      {title && <h3 className="font-medium">{title}</h3>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children(state.fieldErrors ?? {})}
      <FormMessage state={state} />
      <SubmitButton pending={pending}>{button}</SubmitButton>
    </form>
  );
}

export function FooterForm({ values }: { values: { postal_address: string; optout_line: string; white_label_line: string } }) {
  return (
    <SettingsCard testId="form-footer" action={saveFooter} button="Save footer" hint="Added to the bottom of every email. The postal address and the opt-out line are required before real drafts can be made.">
      {(err) => (
        <>
          <Field label="Postal address" name="postal_address" error={err.postal_address}>
            <TextArea name="postal_address" rows={2} defaultValue={values.postal_address} />
          </Field>
          <Field label="Opt-out line" name="optout_line" error={err.optout_line} hint="For example: Reply STOP and I will not write again.">
            <TextArea name="optout_line" rows={2} defaultValue={values.optout_line} />
          </Field>
          <Field label="White-label line" name="white_label_line" error={err.white_label_line} hint="Used word for word in every email.">
            <TextArea name="white_label_line" rows={2} defaultValue={values.white_label_line} />
          </Field>
        </>
      )}
    </SettingsCard>
  );
}

export function ScheduleForm({ values }: { values: { schedule_enabled: boolean; run_time_ist: string } }) {
  return (
    <SettingsCard testId="form-schedule" action={saveSchedule} button="Save schedule" hint="When on, a run starts by itself every weekday at this time for every campaign that is Active.">
      {(err) => (
        <>
          <Checkbox name="schedule_enabled" label="Run automatically every weekday" defaultChecked={values.schedule_enabled} />
          <Field label="Start time (India time, 24-hour)" name="run_time_ist" error={err.run_time_ist}>
            <TextInput name="run_time_ist" defaultValue={values.run_time_ist} placeholder="06:30" />
          </Field>
        </>
      )}
    </SettingsCard>
  );
}

export function ModelsForm({ values }: { values: { model_screen: string; model_extract: string; model_write: string } }) {
  return (
    <SettingsCard
      testId="form-models"
      title="Models"
      action={saveModels}
      button="Save models"
      hint="Anthropic ids such as claude-haiku-5-5. For OpenRouter the app sends anthropic/claude-haiku-5.5, or type an OpenRouter id with a slash."
    >
      {(err) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Quick-check model" name="model_screen" error={err.model_screen} hint="Also checks the written email.">
            <TextInput name="model_screen" defaultValue={values.model_screen} />
          </Field>
          <Field label="Facts model" name="model_extract" error={err.model_extract} hint="Reads the pages and quotes facts.">
            <TextInput name="model_extract" defaultValue={values.model_extract} />
          </Field>
          <Field label="Writing model" name="model_write" error={err.model_write} hint="Writes the email.">
            <TextInput name="model_write" defaultValue={values.model_write} />
          </Field>
        </div>
      )}
    </SettingsCard>
  );
}

export function CreditsForm({ values }: { values: { daily_reveal_cap: number; monthly_credit_cap: number } }) {
  return (
    <SettingsCard testId="form-credits" title="Apollo credit limits" action={saveCredits} button="Save credit limits" hint="Email addresses are unlocked (one credit each, approved leads only, never twice) up to these limits.">
      {(err) => (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Credits per day" name="daily_reveal_cap" error={err.daily_reveal_cap}>
            <TextInput name="daily_reveal_cap" defaultValue={values.daily_reveal_cap} />
          </Field>
          <Field label="Credits per month" name="monthly_credit_cap" error={err.monthly_credit_cap}>
            <TextInput name="monthly_credit_cap" defaultValue={values.monthly_credit_cap} />
          </Field>
        </div>
      )}
    </SettingsCard>
  );
}

export function RunRulesForm({
  values,
}: {
  values: { approve_threshold: number; same_company_cooldown_days: number; run_limit_minutes: number; dry_run: boolean; allow_risky: boolean; skip_verification: boolean };
}) {
  return (
    <SettingsCard testId="form-run-rules" title="Run rules" action={saveRunRules} button="Save run rules">
      {(err) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Approval cut-off (0-100)" name="approve_threshold" error={err.approve_threshold} hint="Only leads at or above this score get an email.">
              <TextInput name="approve_threshold" defaultValue={values.approve_threshold} />
            </Field>
            <Field label="Same-company wait (days)" name="same_company_cooldown_days" error={err.same_company_cooldown_days}>
              <TextInput name="same_company_cooldown_days" defaultValue={values.same_company_cooldown_days} />
            </Field>
            <Field label="Run time limit (minutes)" name="run_limit_minutes" error={err.run_limit_minutes}>
              <TextInput name="run_limit_minutes" defaultValue={values.run_limit_minutes} />
            </Field>
          </div>
          <div className="space-y-2">
            <Checkbox name="dry_run" label="Always run as a test run (no drafts, no credits)" defaultChecked={values.dry_run} />
            <Checkbox name="allow_risky" label="Also write to risky or catch-all email addresses" defaultChecked={values.allow_risky} />
            <Checkbox name="skip_verification" label="Skip email verification (testing only)" defaultChecked={values.skip_verification} />
            <p className="rounded-md border border-yellow-400 bg-yellow-50 p-2 text-xs text-yellow-900" data-testid="skip-verification-warning">
              Testing only. With this on, addresses are not checked before an email is written, so some may bounce and hurt your sender reputation. Home shows a yellow warning while it is on. Keep it OFF for real work.
            </p>
          </div>
        </>
      )}
    </SettingsCard>
  );
}

export function WritingRulesForm({ values }: { values: Record<string, string> }) {
  const area = (err: Record<string, string>, name: string, label: string, hint?: string, rows = 3) => (
    <Field label={label} name={name} error={err[name]} hint={hint}>
      <TextArea name={name} rows={rows} defaultValue={values[name]} />
    </Field>
  );
  return (
    <SettingsCard testId="form-writing-rules" title="Writing and filtering rules" action={saveWritingRules} button="Save writing rules">
      {(err) => (
        <>
          {area(err, "style_guide", "Writing style", undefined, 3)}
          {area(err, "tools_by_industry", "Tools sentence by industry", "One line each: keyword: sentence. A line starting with default: is the fallback.", 3)}
          {area(err, "reference_emails", "Example emails to copy the voice of", "Separate several with a line containing only ---", 5)}
          <div className="grid gap-3 sm:grid-cols-2">
            {area(err, "excluded_domains", "Never write to these domains", "One per line")}
            {area(err, "excluded_titles", "Never write to these job titles", "One per line, part of a title is enough")}
            {area(err, "banned_phrases", "Words and phrases never to use", "One per line")}
            {area(err, "countries_in_scope", "Only these countries", "One per line. Empty means all.")}
            {area(err, "holidays", "Days with no automatic run", "One date per line, YYYY-MM-DD")}
          </div>
        </>
      )}
    </SettingsCard>
  );
}

export function PriceForm() {
  const { state, onSubmit: action, pending } = useActionForm(addPrice);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={action} className="space-y-3 rounded-lg border p-4" noValidate>
      <h3 className="font-medium">Add a price</h3>
      <p className="text-xs text-muted-foreground">Costs are computed from recorded usage x these prices. A new row applies from now on.</p>
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
      <h3 className="font-medium">Add a spend cap</h3>
      <p className="text-xs text-muted-foreground">No paid call is made once a cap that applies to it would be exceeded.</p>
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
