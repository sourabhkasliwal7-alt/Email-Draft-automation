"use client";

import { useState } from "react";
import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, TextArea, TextInput, useActionForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { saveCampaign } from "./actions";

export interface CampaignDefaults {
  id?: string;
  name: string;
  industries: string;
  excludeIndustries: string;
  countries: string;
  employeeMin: string;
  employeeMax: string;
  keywordsInclude: string;
  keywordsExclude: string;
  researchFirst: boolean;
  targetRoles: string;
  regions: string;
  scoreDraftMin: number;
  scoreReviewMin: number;
  dailyCap: number;
  offerId: string;
  tone: string;
  cta: string;
  inboxId: string;
  researchDepth: string;
  sendDays: number[];
  sendStart: string;
  sendEnd: string;
  status: string;
}

export const NEW_CAMPAIGN: CampaignDefaults = {
  name: "",
  industries: "",
  excludeIndustries: "",
  countries: "",
  employeeMin: "",
  employeeMax: "",
  keywordsInclude: "",
  keywordsExclude: "",
  researchFirst: false,
  targetRoles: "",
  regions: "",
  scoreDraftMin: 70,
  scoreReviewMin: 50,
  dailyCap: 20,
  offerId: "",
  tone: "",
  cta: "",
  inboxId: "",
  researchDepth: "standard",
  sendDays: [1, 2, 3, 4, 5],
  sendStart: "10:00",
  sendEnd: "17:00",
  status: "draft",
};

const STEPS = ["Audience (ICP)", "Roles & scoring", "Offer & message", "Sending"] as const;
/** which step each field lives on, so validation errors can jump to the right page */
const FIELD_STEP: Record<string, number> = {
  name: 0, industries: 0, excludeIndustries: 0, countries: 0, employeeMin: 0, employeeMax: 0, keywordsInclude: 0, keywordsExclude: 0, researchFirst: 0,
  targetRoles: 1, regions: 1, scoreDraftMin: 1, scoreReviewMin: 1, dailyCap: 1,
  offerId: 2, tone: 2, cta: 2,
  inboxId: 3, researchDepth: 3, sendDays: 3, sendStart: 3, sendEnd: 3, status: 3,
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function CampaignForm({
  defaults,
  offers,
  inboxes,
}: {
  defaults: CampaignDefaults;
  offers: { id: string; name: string }[];
  inboxes: { id: string; email: string }[];
}) {
  const { state, onSubmit: action, pending } = useActionForm(saveCampaign);
  const [step, setStep] = useState(0);
  const [seenState, setSeenState] = useState(state);

  // When the server returns field errors, jump to the earliest step that has one (state-derived, no effect needed).
  if (state !== seenState) {
    setSeenState(state);
    const steps = Object.keys(state.fieldErrors ?? {}).map((k) => FIELD_STEP[k] ?? 0);
    if (steps.length) setStep(Math.min(...steps));
  }

  const err = state.fieldErrors ?? {};
  const show = (i: number) => (step === i ? "space-y-4" : "hidden");
  const errorSteps = new Set(Object.keys(err).map((k) => FIELD_STEP[k] ?? 0));

  return (
    <form
      onSubmit={action}
      onKeyDown={(e) => {
        // Enter in a text field would submit the whole wizard from step 1; only the last step may submit.
        if (e.key === "Enter" && step < STEPS.length - 1 && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
      className="max-w-2xl space-y-6"
      noValidate
    >
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={step === i ? "step" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${step === i ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""} ${errorSteps.has(i) ? "border-red-500 text-red-700" : ""}`}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      <section className={show(0)}>
        <Field label="Campaign name" name="name" error={err.name}>
          <TextInput name="name" defaultValue={defaults.name} />
        </Field>
        <Field label="Target industries" name="industries" error={err.industries} hint="Comma or line separated, e.g. saas, logistics">
          <TextArea name="industries" rows={2} defaultValue={defaults.industries} />
        </Field>
        <Field label="Exclude industries" name="excludeIndustries" error={err.excludeIndustries}>
          <TextArea name="excludeIndustries" rows={2} defaultValue={defaults.excludeIndustries} />
        </Field>
        <Field label="Countries" name="countries" error={err.countries} hint="ISO codes or names, e.g. IN, US">
          <TextInput name="countries" defaultValue={defaults.countries} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min employees" name="employeeMin" error={err.employeeMin}>
            <TextInput name="employeeMin" defaultValue={defaults.employeeMin} />
          </Field>
          <Field label="Max employees" name="employeeMax" error={err.employeeMax}>
            <TextInput name="employeeMax" defaultValue={defaults.employeeMax} />
          </Field>
        </div>
        <Field label="Keywords that must appear" name="keywordsInclude" error={err.keywordsInclude}>
          <TextInput name="keywordsInclude" defaultValue={defaults.keywordsInclude} />
        </Field>
        <Field label="Keywords that disqualify" name="keywordsExclude" error={err.keywordsExclude}>
          <TextInput name="keywordsExclude" defaultValue={defaults.keywordsExclude} />
        </Field>
        <Checkbox name="researchFirst" label="Research-first: allow leads without an email (email is revealed after qualification)" defaultChecked={defaults.researchFirst} />
      </section>

      <section className={show(1)}>
        <Field label="Target roles" name="targetRoles" error={err.targetRoles} hint="e.g. COO, Head of Operations">
          <TextArea name="targetRoles" rows={2} defaultValue={defaults.targetRoles} />
        </Field>
        <Field label="Regions" name="regions" error={err.regions}>
          <TextInput name="regions" defaultValue={defaults.regions} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Draft threshold (0-100)" name="scoreDraftMin" error={err.scoreDraftMin} hint="Score at or above this gets a draft">
            <TextInput name="scoreDraftMin" defaultValue={defaults.scoreDraftMin} />
          </Field>
          <Field label="Review threshold (0-100)" name="scoreReviewMin" error={err.scoreReviewMin} hint="Between the two: held for review">
            <TextInput name="scoreReviewMin" defaultValue={defaults.scoreReviewMin} />
          </Field>
          <Field label="Daily draft cap" name="dailyCap" error={err.dailyCap}>
            <TextInput name="dailyCap" defaultValue={defaults.dailyCap} />
          </Field>
        </div>
      </section>

      <section className={show(2)}>
        <Field label="Offer" name="offerId" error={err.offerId}>
          <SelectInput name="offerId" defaultValue={defaults.offerId} options={[{ value: "", label: "No offer selected" }, ...offers.map((o) => ({ value: o.id, label: o.name }))]} />
        </Field>
        <Field label="Tone" name="tone" error={err.tone} hint="e.g. plain, specific, short">
          <TextInput name="tone" defaultValue={defaults.tone} />
        </Field>
        <Field label="Call to action" name="cta" error={err.cta}>
          <TextInput name="cta" defaultValue={defaults.cta} />
        </Field>
      </section>

      <section className={show(3)}>
        <Field label="Sender inbox" name="inboxId" error={err.inboxId}>
          <SelectInput name="inboxId" defaultValue={defaults.inboxId} options={[{ value: "", label: "No inbox selected" }, ...inboxes.map((i) => ({ value: i.id, label: i.email }))]} />
        </Field>
        <Field label="Research depth" name="researchDepth" error={err.researchDepth}>
          <SelectInput
            name="researchDepth"
            defaultValue={defaults.researchDepth}
            options={[
              { value: "light", label: "Light" },
              { value: "standard", label: "Standard" },
              { value: "deep", label: "Deep" },
            ]}
          />
        </Field>
        <fieldset className="space-y-2" data-field="sendDays">
          <legend className="text-sm font-medium">Send days (Asia/Kolkata)</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => (
              <Checkbox key={d} name="sendDays" value={String(i)} label={d} defaultChecked={defaults.sendDays.includes(i)} />
            ))}
          </div>
          {err.sendDays && <p role="alert" className="text-xs font-medium text-red-600">{err.sendDays}</p>}
        </fieldset>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Window start" name="sendStart" error={err.sendStart}>
            <TextInput name="sendStart" defaultValue={defaults.sendStart} placeholder="10:00" />
          </Field>
          <Field label="Window end" name="sendEnd" error={err.sendEnd}>
            <TextInput name="sendEnd" defaultValue={defaults.sendEnd} placeholder="17:00" />
          </Field>
        </div>
        <Field label="Status" name="status" error={err.status}>
          <SelectInput
            name="status"
            defaultValue={defaults.status}
            options={["draft", "active", "paused", "completed"].map((s) => ({ value: s, label: s }))}
          />
        </Field>
      </section>

      <FormMessage state={state} />
      <div className="flex gap-3">
        {step > 0 && (
          <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 && (
          <Button type="button" onClick={() => setStep(step + 1)}>
            Next
          </Button>
        )}
        {/* Always rendered so every step's fields are submitted; it is only focusable on the last step. */}
        <span className={step === STEPS.length - 1 ? "" : "hidden"}>
          <SubmitButton pending={pending}>{defaults.id ? "Save campaign" : "Create campaign"}</SubmitButton>
        </span>
      </div>
    </form>
  );
}
