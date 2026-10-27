"use client";

import { useState } from "react";
import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, TextArea, TextInput, useActionForm } from "@/components/form";
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
  leadSource: string;
  seniorities: string;
  hiringTitles: string;
  minOpenJobs: string;
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
  leadSource: "csv",
  seniorities: "",
  hiringTitles: "",
  minOpenJobs: "",
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
  status: "active",
};

/** Apollo's seniority levels, in plain words. */
const SENIORITIES: [string, string][] = [
  ["owner", "Owner"],
  ["founder", "Founder"],
  ["c_suite", "C-level (CEO, COO, CTO ...)"],
  ["partner", "Partner"],
  ["vp", "VP"],
  ["head", "Head of"],
  ["director", "Director"],
  ["manager", "Manager"],
  ["senior", "Senior"],
];

const SOURCE_HINT: Record<string, string> = {
  csv: "Each run works the leads you upload on the Leads page.",
  apollo: "Each run asks Apollo for people who match the target below (the search is free). Email addresses are unlocked later, only for leads that pass the checks.",
  both: "Each run works your uploaded leads first, then asks Apollo for more to reach the day's number.",
};

/** One page, five blocks. The scoring and send-window settings that no longer have a screen are kept as hidden values so nothing changes silently. */
export function CampaignForm({
  defaults,
  offers,
  inboxes,
}: {
  defaults: CampaignDefaults;
  offers: { id: string; name: string; caseStudies: string[] }[];
  inboxes: { id: string; email: string }[];
}) {
  const { state, onSubmit: action, pending } = useActionForm(saveCampaign);
  const [source, setSource] = useState(defaults.leadSource);
  const [offerId, setOfferId] = useState(defaults.offerId);
  const [seniority, setSeniority] = useState<string[]>(defaults.seniorities.split(",").map((s) => s.trim()).filter(Boolean));
  const err = state.fieldErrors ?? {};
  const usesApollo = source === "apollo" || source === "both";
  const studies = offers.find((o) => o.id === offerId)?.caseStudies ?? [];

  return (
    <form onSubmit={action} className="max-w-3xl space-y-8" noValidate data-testid="campaign-form">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      {/* kept as they are: scoring, depth and send window have no screen in the simple setup */}
      <input type="hidden" name="regions" value={defaults.regions} />
      <input type="hidden" name="scoreDraftMin" value={defaults.scoreDraftMin} />
      <input type="hidden" name="scoreReviewMin" value={defaults.scoreReviewMin} />
      <input type="hidden" name="researchDepth" value={defaults.researchDepth} />
      <input type="hidden" name="sendStart" value={defaults.sendStart} />
      <input type="hidden" name="sendEnd" value={defaults.sendEnd} />
      {defaults.sendDays.map((d) => (
        <input key={d} type="hidden" name="sendDays" value={d} />
      ))}
      <input type="hidden" name="seniorities" value={seniority.join(", ")} />

      <section className="space-y-4" data-testid="block-source">
        <h2 className="text-lg font-semibold">1. Name and where the leads come from</h2>
        <Field label="Campaign name" name="name" error={err.name}>
          <TextInput name="name" defaultValue={defaults.name} />
        </Field>
        <Field label="Leads come from" name="leadSource" error={err.leadSource} hint={SOURCE_HINT[source]}>
          <select
            id="leadSource"
            name="leadSource"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="csv">CSV file</option>
            <option value="apollo">Apollo</option>
            <option value="both">Both: CSV file first, then Apollo</option>
          </select>
        </Field>
        {source !== "apollo" && <Checkbox name="researchFirst" label="My CSV file has no email column (emails are found with Apollo later)" defaultChecked={defaults.researchFirst} />}
      </section>

      <section className="space-y-4" data-testid="block-target">
        <h2 className="text-lg font-semibold">2. Who to write to</h2>
        <Field label="Job titles" name="targetRoles" error={err.targetRoles} hint="For example: COO, Head of Operations">
          <TextArea name="targetRoles" rows={2} defaultValue={defaults.targetRoles} />
        </Field>
        <Field label="Industries" name="industries" error={err.industries} hint="Comma or line separated, for example: saas, logistics">
          <TextArea name="industries" rows={2} defaultValue={defaults.industries} />
        </Field>
        <Field label="Countries" name="countries" error={err.countries} hint="For example: IN, US">
          <TextInput name="countries" defaultValue={defaults.countries} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Smallest company (employees)" name="employeeMin" error={err.employeeMin}>
            <TextInput name="employeeMin" defaultValue={defaults.employeeMin} />
          </Field>
          <Field label="Largest company (employees)" name="employeeMax" error={err.employeeMax}>
            <TextInput name="employeeMax" defaultValue={defaults.employeeMax} />
          </Field>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">More ways to narrow it down (optional)</summary>
          <div className="mt-3 space-y-4">
            <Field label="Industries to leave out" name="excludeIndustries" error={err.excludeIndustries}>
              <TextArea name="excludeIndustries" rows={2} defaultValue={defaults.excludeIndustries} />
            </Field>
            <Field label="Words the company should mention" name="keywordsInclude" error={err.keywordsInclude}>
              <TextInput name="keywordsInclude" defaultValue={defaults.keywordsInclude} />
            </Field>
            <Field label="Words that rule a company out" name="keywordsExclude" error={err.keywordsExclude}>
              <TextInput name="keywordsExclude" defaultValue={defaults.keywordsExclude} />
            </Field>
          </div>
        </details>
      </section>

      <section className={`space-y-4 ${usesApollo ? "" : "opacity-60"}`} data-testid="block-apollo">
        <h2 className="text-lg font-semibold">3. Apollo search filters</h2>
        <p className="text-xs text-zinc-600">
          {usesApollo ? "Used when Apollo looks for people." : "Not used: this campaign does not use Apollo."} Job titles, industries, countries and company size come from the target above. Leave a field here blank to use only that.
        </p>
        <fieldset className="space-y-2" data-field="seniorities">
          <legend className="text-sm font-medium">Seniority</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2" data-testid="seniority-options">
            {SENIORITIES.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={seniority.includes(value)}
                  onChange={(e) => setSeniority(e.target.checked ? [...seniority, value] : seniority.filter((s) => s !== value))}
                  aria-label={label}
                  className="size-4 rounded border-zinc-300"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Companies hiring for" name="hiringTitles" error={err.hiringTitles} hint="Job titles in their open jobs, for example: developer, data engineer">
            <TextInput name="hiringTitles" defaultValue={defaults.hiringTitles} />
          </Field>
          <Field label="At least this many open jobs" name="minOpenJobs" error={err.minOpenJobs}>
            <TextInput name="minOpenJobs" defaultValue={defaults.minOpenJobs} />
          </Field>
        </div>
        <p className="text-xs text-zinc-500">The hiring filters only work if your Apollo plan allows them. If it does not, Apollo ignores or refuses them and the run says so.</p>
      </section>

      <section className="space-y-4" data-testid="block-offer">
        <h2 className="text-lg font-semibold">4. What you offer</h2>
        <Field label="Offer" name="offerId" error={err.offerId}>
          <select
            id="offerId"
            name="offerId"
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">No offer chosen</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-zinc-600" data-testid="offer-case-studies">
          {offerId ? (studies.length ? `Case studies the emails may quote: ${studies.join(", ")}.` : "This offer has no case study yet.") : "Choose an offer to see its case studies."}{" "}
          {offerId && (
            <a href={`/offers/${offerId}`} target="_blank" rel="noreferrer" className="underline">
              Add or edit case studies
            </a>
          )}
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Tone and call to action (optional)</summary>
          <div className="mt-3 space-y-4">
            <Field label="Tone" name="tone" error={err.tone} hint="For example: plain, specific, short">
              <TextInput name="tone" defaultValue={defaults.tone} />
            </Field>
            <Field label="Call to action" name="cta" error={err.cta}>
              <TextInput name="cta" defaultValue={defaults.cta} />
            </Field>
          </div>
        </details>
      </section>

      <section className="space-y-4" data-testid="block-mailbox">
        <h2 className="text-lg font-semibold">5. Where the drafts go</h2>
        <Field label="Gmail mailbox" name="inboxId" error={err.inboxId} hint="The drafts are saved here. Add and connect mailboxes in Setup.">
          <SelectInput name="inboxId" defaultValue={defaults.inboxId} options={[{ value: "", label: "No mailbox chosen" }, ...inboxes.map((i) => ({ value: i.id, label: i.email }))]} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Drafts per day (at most)" name="dailyCap" error={err.dailyCap}>
            <TextInput name="dailyCap" defaultValue={defaults.dailyCap} />
          </Field>
          <Field label="Status" name="status" error={err.status} hint="Only an Active campaign runs by itself on the schedule.">
            <SelectInput
              name="status"
              defaultValue={["paused", "draft", "completed"].includes(defaults.status) ? defaults.status : "active"}
              options={[
                { value: "active", label: "Active" },
                { value: "paused", label: "Paused" },
                { value: "draft", label: "Draft (not ready)" },
                ...(defaults.status === "completed" ? [{ value: "completed", label: "Finished" }] : []),
              ]}
            />
          </Field>
        </div>
      </section>

      <FormMessage state={state} />
      <SubmitButton pending={pending}>{defaults.id ? "Save campaign" : "Create campaign"}</SubmitButton>
    </form>
  );
}
