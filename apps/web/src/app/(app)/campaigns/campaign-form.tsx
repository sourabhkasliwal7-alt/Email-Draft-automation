"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { DEFAULT_WEB_MAX_QUERIES, DEFAULT_WEB_MAX_RESULTS, LEAD_SOURCES, LEAD_SOURCE_LABELS, type LeadSource } from "@outreach/core";
import { Checkbox, Field, FormMessage, SelectInput, SubmitButton, TextArea, TextInput, inputClass, useActionForm } from "@/components/form";
import { HelpTip } from "@/components/help-tip";
import { LinkButton } from "@/components/link-button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { orderSources, previewWebQueries } from "@/lib/web-queries";
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
  /** csv, apollo and/or web */
  leadSources: string[];
  /** one search query per line; empty = built from the target */
  webQueries: string;
  webMaxQueries: string;
  webMaxResults: string;
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
  leadSources: ["csv"],
  webQueries: "",
  webMaxQueries: String(DEFAULT_WEB_MAX_QUERIES),
  webMaxResults: String(DEFAULT_WEB_MAX_RESULTS),
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

const SOURCE_INFO: Record<LeadSource, { text: string; help: string }> = {
  csv: { text: "The leads you upload on the Leads page are used first.", help: "A CSV file is a spreadsheet of people you already have. You upload it on the Leads page." },
  apollo: { text: "Apollo finds people who match the target below. The search is free; email addresses are unlocked later, only for leads that pass the checks.", help: "Apollo is a service that finds people for you. Add your key in Setup > Apollo." },
  web: {
    text: "Searches Google for company websites that match the target, checks each one, then asks Apollo (a free search) for the right person there.",
    help: "Only public company websites are read. Nothing is logged into, LinkedIn is never used, and a site that blocks robots is left alone. If Apollo finds nobody, the company waits under Drafts > Needs attention.",
  },
};

/** Two fields side by side on a laptop, stacked on a phone. */
const TWO = "grid gap-5 sm:grid-cols-2";

/** One numbered block of the form: a card with a title, one sentence about it, and its fields. */
function Block({ testId, title, description, dim, children }: { testId: string; title: string; description: string; dim?: boolean; children: React.ReactNode }) {
  return (
    <Card data-testid={testId} className={cn("transition-opacity", dim && "opacity-60")}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">{children}</CardBody>
    </Card>
  );
}

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
  const [sources, setSources] = useState<LeadSource[]>(orderSources(defaults.leadSources));
  const [sourceError, setSourceError] = useState("");
  // the web-query preview follows what is typed in the target fields
  const [target, setTarget] = useState({ industries: defaults.industries, countries: defaults.countries, keywordsInclude: defaults.keywordsInclude, webQueries: defaults.webQueries, maxQueries: defaults.webMaxQueries });
  const [offerId, setOfferId] = useState(defaults.offerId);
  const [seniority, setSeniority] = useState<string[]>(defaults.seniorities.split(",").map((s) => s.trim()).filter(Boolean));
  const err = state.fieldErrors ?? {};
  const usesCsv = sources.includes("csv");
  const usesApollo = sources.includes("apollo");
  const usesWeb = sources.includes("web");
  const queries = previewWebQueries(target);
  const toggle = (s: LeadSource, on: boolean) => {
    setSources((cur) => orderSources(on ? [...cur, s] : cur.filter((x) => x !== s)));
    setSourceError("");
  };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    if (sources.length === 0) {
      e.preventDefault();
      setSourceError("Tick at least one: CSV file, Apollo search or Web discovery.");
      return;
    }
    action(e);
  };
  // Only the fields the preview reads. Re-rendering on the input event of ANY field would make React reset a controlled <select>
  // (the offer) to its old value before its change event arrives, so the choice would jump back.
  const track = (e: React.FormEvent<HTMLFormElement>) => {
    const field = (e.target as { name?: string }).name ?? "";
    if (!["industries", "countries", "keywordsInclude", "webQueries", "webMaxQueries"].includes(field)) return;
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    setTarget({ industries: get("industries"), countries: get("countries"), keywordsInclude: get("keywordsInclude"), webQueries: get("webQueries"), maxQueries: get("webMaxQueries") });
  };
  const studies = offers.find((o) => o.id === offerId)?.caseStudies ?? [];

  return (
    <form onSubmit={submit} onInput={track} className="max-w-3xl space-y-6" noValidate data-testid="campaign-form">
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

      <Block testId="block-source" title="1. Name and where the leads come from" description="Give the campaign a name you will recognise, and tick where its leads come from. You can use more than one.">
        <Field label="Campaign name" name="name" error={err.name}>
          <TextInput name="name" defaultValue={defaults.name} placeholder="For example: Logistics companies in India" />
        </Field>
        <fieldset className="space-y-2.5" data-field="leadSources" data-testid="lead-sources">
          <legend className="flex items-center gap-1.5 text-sm font-medium">
            Where the leads come from
            <HelpTip label="Where the leads come from">Tick every source this campaign may use. A run works your uploaded CSV leads first, then asks Apollo and Google for more until it reaches the day&apos;s number.</HelpTip>
          </legend>
          <div className="grid gap-2.5">
            {LEAD_SOURCES.map((s) => {
              const on = sources.includes(s);
              return (
                <div key={s} className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 transition-colors focus-within:ring-3 focus-within:ring-ring/30", on ? "border-brand bg-brand-tint" : "bg-card hover:border-zinc-400")}>
                  <label className="flex flex-1 cursor-pointer items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      name="leadSources"
                      value={s}
                      checked={on}
                      onChange={(e) => toggle(s, e.target.checked)}
                      data-testid={`source-${s}`}
                      className="mt-0.5 size-[1.1rem] shrink-0 rounded border-input accent-[var(--brand)]"
                    />
                    <span>
                      <span className="font-medium text-foreground">{LEAD_SOURCE_LABELS[s]}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{SOURCE_INFO[s].text}</span>
                    </span>
                  </label>
                  <HelpTip label={LEAD_SOURCE_LABELS[s]}>{SOURCE_INFO[s].help}</HelpTip>
                </div>
              );
            })}
          </div>
          {(sourceError || err.leadSources) && (
            <p role="alert" data-testid="error-leadSources" className="text-xs font-medium text-red-700">
              {sourceError || err.leadSources}
            </p>
          )}
        </fieldset>
        {usesCsv && <Checkbox name="researchFirst" label="My CSV file has no email column (emails are found with Apollo later)" defaultChecked={defaults.researchFirst} />}
      </Block>

      <Block testId="block-target" title="2. Who to write to" description="The kind of person and company. Apollo uses this to search, and the checks use it to decide if a lead fits.">
        <Field label="Job titles" name="targetRoles" error={err.targetRoles} hint="For example: COO, Head of Operations" help="The job titles of the people you want to reach. Separate several with commas. Similar titles match too.">
          <TextArea name="targetRoles" rows={2} defaultValue={defaults.targetRoles} />
        </Field>
        <Field label="Industries" name="industries" error={err.industries} hint="Comma or line separated, for example: saas, logistics" help="The kind of business, in a word or two. Apollo searches companies tagged with these words, and the quick check compares each company to them.">
          <TextArea name="industries" rows={2} defaultValue={defaults.industries} />
        </Field>
        <Field label="Countries" name="countries" error={err.countries} hint="For example: IN, US" help="Only companies based in these countries. Leave it empty for anywhere. Use country names or two-letter codes.">
          <TextInput name="countries" defaultValue={defaults.countries} />
        </Field>
        <div className={TWO}>
          <Field label="Smallest company (employees)" name="employeeMin" error={err.employeeMin} help="The fewest employees a company may have. Leave empty for no minimum.">
            <TextInput name="employeeMin" defaultValue={defaults.employeeMin} />
          </Field>
          <Field label="Largest company (employees)" name="employeeMax" error={err.employeeMax} help="The most employees a company may have. Leave empty for no maximum.">
            <TextInput name="employeeMax" defaultValue={defaults.employeeMax} />
          </Field>
        </div>
        <details className="rounded-xl border bg-brand-soft/50 p-4 text-sm open:bg-card">
          <summary className="cursor-pointer font-medium">More ways to narrow it down (optional)</summary>
          <div className="mt-4 space-y-5">
            <Field label="Industries to leave out" name="excludeIndustries" error={err.excludeIndustries} help="Companies in these industries are skipped.">
              <TextArea name="excludeIndustries" rows={2} defaultValue={defaults.excludeIndustries} />
            </Field>
            <div className={TWO}>
              <Field label="Words the company should mention" name="keywordsInclude" error={err.keywordsInclude} help="Companies whose pages mention these words fit better. Separate with commas.">
                <TextInput name="keywordsInclude" defaultValue={defaults.keywordsInclude} />
              </Field>
              <Field label="Words that rule a company out" name="keywordsExclude" error={err.keywordsExclude} help="A company whose pages mention these words is skipped.">
                <TextInput name="keywordsExclude" defaultValue={defaults.keywordsExclude} />
              </Field>
            </div>
          </div>
        </details>
      </Block>

      <Block
        testId="block-apollo"
        title="3. Apollo search filters"
        dim={!usesApollo}
        description={
          usesApollo
            ? "Used when Apollo looks for people. Job titles, industries, countries and company size come from the target above. Leave a field here blank to use only that."
            : usesWeb
              ? "Not used to search: with Web discovery Apollo only looks up the person at each company, by the job titles above (free). Tick Apollo search in step 1 to also search Apollo for people."
              : "Not used: this campaign does not use Apollo. Tick Apollo search in step 1 to turn these on."
        }
      >
        {usesWeb && (
          <p data-testid="apollo-with-web-note" className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900">
            With Web discovery selected, Apollo is also used to find the person at each company the Google search finds. That search is free and uses no email credits.
          </p>
        )}
        <fieldset className="space-y-2.5" data-field="seniorities">
          <legend className="flex items-center gap-1.5 text-sm font-medium">
            Seniority
            <HelpTip label="Seniority">How senior the person is. Tick the levels you want to write to. Leave all empty for any level.</HelpTip>
          </legend>
          <div className="flex flex-wrap gap-2" data-testid="seniority-options">
            {SENIORITIES.map(([value, label]) => {
              const on = seniority.includes(value);
              return (
                <label
                  key={value}
                  className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/30", on ? "border-brand bg-brand-tint text-brand-strong" : "bg-card hover:border-zinc-400")}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setSeniority(e.target.checked ? [...seniority, value] : seniority.filter((s) => s !== value))}
                    aria-label={label}
                    className="size-4 rounded accent-[var(--brand)]"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className={TWO}>
          <Field
            label="Companies hiring for"
            name="hiringTitles"
            error={err.hiringTitles}
            hint="Job titles in their open jobs, for example: developer, data engineer"
            help="Only companies that are advertising a job with one of these titles. A company that is hiring developers may need extra development help."
          >
            <TextInput name="hiringTitles" defaultValue={defaults.hiringTitles} />
          </Field>
          <Field label="At least this many open jobs" name="minOpenJobs" error={err.minOpenJobs} help="Only companies with at least this many open jobs. Leave empty for no minimum.">
            <TextInput name="minOpenJobs" defaultValue={defaults.minOpenJobs} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">The hiring filters only work if your Apollo plan allows them. If it does not, Apollo ignores or refuses them and the run says so.</p>
      </Block>

      <Block
        testId="block-web"
        title="4. Web discovery (Google)"
        dim={!usesWeb}
        description={usesWeb ? "How the Google search finds company websites. Only real company sites are kept: directories, job boards, social sites and news are left out." : "Not used: tick Web discovery (Google) in step 1 to turn this on."}
      >
        <Field
          label="Search queries (one per line)"
          name="webQueries"
          error={err.webQueries}
          hint="Leave empty and we build them from your target, for example: <industry> agency <country>; <industry> agency hiring react; <industry> agency careers react developer"
          help="Each line is one Google search. Leave the box empty and the app builds queries from your industries and countries above."
        >
          <TextArea name="webQueries" rows={4} defaultValue={defaults.webQueries} placeholder="saas agency india&#10;saas agency hiring react" />
        </Field>
        <div data-testid="web-query-preview" className="rounded-xl border bg-brand-soft/60 p-3.5 text-sm">
          <p className="font-medium">Queries that will be used ({queries.length})</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            {queries.map((q) => (
              <li key={q} data-testid="web-query">
                {q}
              </li>
            ))}
          </ol>
        </div>
        <div className={TWO}>
          <Field label="Max queries per run" name="webMaxQueries" error={err.webMaxQueries} hint="Default 10, at most 50." help="The most Google searches one run may make. Each query costs one Serper search, so this caps the cost.">
            <TextInput name="webMaxQueries" defaultValue={defaults.webMaxQueries} />
          </Field>
          <Field label="Max results per query" name="webMaxResults" error={err.webMaxResults} hint="Default 10, at most 20." help="How many search results are read for each query. Each query costs one Serper search however many results it returns.">
            <TextInput name="webMaxResults" defaultValue={defaults.webMaxResults} />
          </Field>
        </div>
      </Block>

      <Block testId="block-offer" title="5. What you offer" description="The offer the emails talk about. Emails may only make the claims and quote the numbers you list on the offer.">
        <Field label="Offer" name="offerId" error={err.offerId} help="What you are offering these companies. It is set up under Setup, Offers. The emails only use the claims and case-study numbers listed there.">
          <select id="offerId" name="offerId" value={offerId} onChange={(e) => setOfferId(e.target.value)} className={`${inputClass} pr-9`}>
            <option value="">No offer chosen</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-muted-foreground" data-testid="offer-case-studies">
          {offerId ? (studies.length ? `Case studies the emails may quote: ${studies.join(", ")}.` : "This offer has no case study yet.") : "Choose an offer to see its case studies."}{" "}
          {offerId && (
            <a href={`/offers/${offerId}`} target="_blank" rel="noreferrer" className="font-medium text-brand underline underline-offset-2">
              Add or edit case studies
            </a>
          )}
        </p>
        <details className="rounded-xl border bg-brand-soft/50 p-4 text-sm open:bg-card">
          <summary className="cursor-pointer font-medium">Tone and call to action (optional)</summary>
          <div className="mt-4 space-y-5">
            <Field label="Tone" name="tone" error={err.tone} hint="For example: plain, specific, short" help="How the email should sound. A few plain words are enough.">
              <TextInput name="tone" defaultValue={defaults.tone} />
            </Field>
            <Field label="Call to action" name="cta" error={err.cta} help="The one thing you ask for at the end, for example a short call next week.">
              <TextInput name="cta" defaultValue={defaults.cta} />
            </Field>
          </div>
        </details>
      </Block>

      <Block testId="block-mailbox" title="6. Where the drafts go" description="The Gmail mailbox that saves the drafts, and how many it may save a day.">
        <Field label="Gmail mailbox" name="inboxId" error={err.inboxId} hint="The drafts are saved here. Add and connect mailboxes in Setup." help="The Gmail account where the drafts appear. You read them there and press Send yourself.">
          <SelectInput name="inboxId" defaultValue={defaults.inboxId} options={[{ value: "", label: "No mailbox chosen" }, ...inboxes.map((i) => ({ value: i.id, label: i.email }))]} />
        </Field>
        <div className={TWO}>
          <Field label="Drafts per day (at most)" name="dailyCap" error={err.dailyCap} help="The most drafts this campaign saves in one day. A run stops when it reaches this number. Start small, for example 20.">
            <TextInput name="dailyCap" defaultValue={defaults.dailyCap} />
          </Field>
          <Field label="Status" name="status" error={err.status} hint="Only an Active campaign runs by itself on the schedule." help="Active campaigns can run on the schedule. Paused and Draft ones only run when you press Start run.">
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
      </Block>

      <FormMessage state={state} />

      {/* the one main action stays in reach however long the form is */}
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-card backdrop-blur">
        <SubmitButton pending={pending} icon={<Save aria-hidden />}>
          {defaults.id ? "Save campaign" : "Create campaign"}
        </SubmitButton>
        <LinkButton href="/setup?tab=campaigns" variant="outline">
          Cancel
        </LinkButton>
        <span className="text-xs text-muted-foreground">Nothing is sent. Runs only create Gmail drafts.</span>
      </div>
    </form>
  );
}
