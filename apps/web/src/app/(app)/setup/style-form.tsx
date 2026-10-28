"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Field, FormMessage, SubmitButton, TextArea, TextInput, inputClass, useActionForm } from "@/components/form";
import { HelpTip } from "@/components/help-tip";
import { Button } from "@/components/ui/button";
import {
  MAX_SAMPLES,
  joinSamples,
  matchToolRow,
  sampleCountNote,
  sampleStatus,
  splitSamples,
  toolRowProblems,
  toolRowsFromConfig,
  toolRowsToText,
  type ToolRow,
} from "@/lib/email-style";
import { parseTools } from "./schemas";
import { saveEmailStyle } from "./actions";

const card = "space-y-3 rounded-2xl border bg-card p-5 shadow-card";

function Heading({ title, help, children }: { title: string; help: string; children?: React.ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 font-medium">
        {title}
        <HelpTip label={title}>{help}</HelpTip>
      </h3>
      {children && <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>}
    </div>
  );
}

/** Setup > Email style: how the emails sound and how they are signed. One form, one Save button. */
export function EmailStyleForm({ values, canEdit }: { values: Record<string, string>; canEdit: boolean }) {
  const { state, onSubmit, pending } = useActionForm(saveEmailStyle);
  const err = state.fieldErrors ?? {};

  const initialTools = toolRowsFromConfig(parseTools(values.tools_by_industry ?? ""));
  const [rows, setRows] = useState<ToolRow[]>(initialTools.rows);
  const [fallback, setFallback] = useState(initialTools.fallback);
  const [samples, setSamples] = useState<string[]>(splitSamples(values.reference_emails ?? ""));
  const [business, setBusiness] = useState("");
  const [industry, setIndustry] = useState("");

  const problems = toolRowProblems(rows);
  const filled = samples.filter((s) => s.trim()).length;
  const status = sampleStatus(filled);
  const test = business.trim() || industry.trim() ? matchToolRow(business, industry, rows) : null;

  const setRow = (i: number, patch: Partial<ToolRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const disabled = !canEdit;

  return (
    <form onSubmit={onSubmit} noValidate data-testid="form-email-style" className="max-w-3xl space-y-6">
      {/* what the rows editors write, in the text format the settings already use */}
      <input type="hidden" name="tools_by_industry" value={toolRowsToText(rows, fallback)} />
      <input type="hidden" name="reference_emails" value={joinSamples(samples)} />

      {/* ------------------------------------------------ tools by industry */}
      <section className={card} data-testid="style-tools">
        <Heading
          title="Tools by industry"
          help="Each email names a few tools that fit the company's industry. The row is picked by the lead's industry or business type (for example 'healthtech'). If no row matches, the default row is used."
        >
          One row per industry. Type several keywords with commas (health, medical). The most specific keyword wins; the default row is used when nothing matches.
        </Heading>
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="grid gap-2 rounded-xl border bg-muted/40 p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]" data-testid="tools-row">
              <div>
                <label htmlFor={`tools-k-${i}`} className="mb-1 block text-xs font-medium">
                  Industry or keywords
                </label>
                <input id={`tools-k-${i}`} value={r.keywords} onChange={(e) => setRow(i, { keywords: e.target.value })} disabled={disabled} placeholder="health, medical" className={inputClass} />
              </div>
              <div>
                <label htmlFor={`tools-s-${i}`} className="mb-1 block text-xs font-medium">
                  Tools sentence
                </label>
                <textarea id={`tools-s-${i}`} rows={2} value={r.sentence} onChange={(e) => setRow(i, { sentence: e.target.value })} disabled={disabled} placeholder="We usually build those with FHIR-ready APIs and HIPAA-minded hosting." className={inputClass} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))} data-testid="tools-remove" aria-label={`Remove row ${i + 1}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              {problems[i] && (
                <p role="alert" className="text-xs font-medium text-amber-800 sm:col-span-3" data-testid="tools-row-problem">
                  {problems[i]}
                </p>
              )}
            </li>
          ))}
          <li className="grid gap-2 rounded-xl border border-brand/30 bg-brand-soft/50 p-3" data-testid="tools-default">
            <label htmlFor="tools-default" className="text-xs font-medium">
              Default (any other industry)
            </label>
            <textarea id="tools-default" rows={2} value={fallback} onChange={(e) => setFallback(e.target.value)} disabled={disabled} className={inputClass} />
            <p className="text-xs text-muted-foreground">This row stays. It is used when no other row matches.</p>
          </li>
        </ul>
        {err.tools_by_industry && (
          <p role="alert" className="text-xs font-medium text-red-700" data-testid="error-tools_by_industry">
            {err.tools_by_industry}
          </p>
        )}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setRows((cur) => [...cur, { keywords: "", sentence: "" }])} icon={<Plus aria-hidden />} data-testid="tools-add">
          Add an industry
        </Button>

        <div className="rounded-xl border bg-card p-3" data-testid="tools-tester">
          <p className="text-xs font-medium">Try it: which row would a lead use?</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="tools-test-business" className="mb-1 block text-xs text-muted-foreground">
                Business type (from the quick check)
              </label>
              <input id="tools-test-business" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="software agency" className={inputClass} />
            </div>
            <div>
              <label htmlFor="tools-test-industry" className="mb-1 block text-xs text-muted-foreground">
                Industry (from the company)
              </label>
              <input id="tools-test-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Hospital & Health Care" className={inputClass} />
            </div>
          </div>
          {test && (
            <p className="mt-2 text-sm" data-testid="tools-test-result" data-row={String(test.row)}>
              {test.row === "default" ? (
                <>
                  Uses the <strong>default</strong> row: {fallback}
                </>
              ) : (
                <>
                  Uses row <strong>{(test.row as number) + 1}</strong> ({rows[test.row as number]!.keywords}): {test.sentence}
                </>
              )}
            </p>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ sample emails */}
      <section className={card} data-testid="style-samples">
        <Heading
          title="Sample emails"
          help="Paste three to five of your best emails. The writer copies their voice and length, never their facts, names or numbers. They are sent to the writer with every email."
        >
          Your best emails, so new ones sound like you.
        </Heading>
        <ul className="space-y-3">
          {samples.map((s, i) => (
            <li key={i} className="space-y-1.5" data-testid="sample-row">
              <div className="flex items-center justify-between">
                <label htmlFor={`sample-${i}`} className="text-xs font-medium">
                  Sample {i + 1}
                </label>
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setSamples((cur) => cur.filter((_, j) => j !== i))} data-testid="sample-remove" aria-label={`Remove sample ${i + 1}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <textarea id={`sample-${i}`} rows={6} value={s} disabled={disabled} onChange={(e) => setSamples((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} className={inputClass} placeholder={"Hi Asha,\n\nI saw your team is hiring a React developer ..."} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" disabled={disabled || samples.length >= MAX_SAMPLES} onClick={() => setSamples((cur) => [...cur, ""])} icon={<Plus aria-hidden />} data-testid="sample-add">
            Add a sample
          </Button>
          <span className="text-sm text-muted-foreground" data-testid="sample-count">
            {sampleCountNote(filled)}
          </span>
        </div>
        {status.message && (
          <p
            role={status.level === "error" ? "alert" : "status"}
            data-testid={status.level === "error" ? "sample-error" : "sample-warning"}
            className={status.level === "error" ? "text-xs font-medium text-red-700" : "rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900"}
          >
            {status.message}
          </p>
        )}
        {err.reference_emails && (
          <p role="alert" className="text-xs font-medium text-red-700" data-testid="error-reference_emails">
            {err.reference_emails}
          </p>
        )}
      </section>

      {/* ------------------------------------------------ sign-off and rules */}
      <section className={card} data-testid="style-signoff">
        <Heading title="Sign-off and style" help="The email ends with the mailbox's display name (a person) and then your company, each written once.">
          Every email ends with a person&apos;s name, then the company.
        </Heading>
        <Field label="Sign-off company" name="sender_company" error={err.sender_company} hint="Written once, under the mailbox's display name (set on the Gmail tab).">
          <TextInput name="sender_company" defaultValue={values.sender_company} />
        </Field>
        <Field label="Writing style" name="style_guide" error={err.style_guide} hint="A few plain sentences about how the emails should sound.">
          <TextArea name="style_guide" rows={3} defaultValue={values.style_guide} />
        </Field>
        <Field label="Words and phrases never to use" name="banned_phrases" error={err.banned_phrases} hint="One per line.">
          <TextArea name="banned_phrases" rows={4} defaultValue={values.banned_phrases} />
        </Field>
        <ul className="space-y-1 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground" data-testid="style-fixed-rules">
          <li>
            <strong className="text-foreground">The ask is always a reply.</strong> The email ends with something like &quot;Happy to share a short example if useful, just reply.&quot; It never asks the lead to send, share or fill in anything.
          </li>
          <li>
            <strong className="text-foreground">The subject never names your offer.</strong> It says something about the lead&apos;s company, never &quot;web development for agencies&quot;.
          </li>
          <li>
            <strong className="text-foreground">The company name is written once</strong> in the sign-off.
          </li>
        </ul>
      </section>

      <FormMessage state={state} />
      {canEdit ? (
        <SubmitButton pending={pending}>Save email style</SubmitButton>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="style-readonly">
          An admin can change the email style.
        </p>
      )}
    </form>
  );
}
