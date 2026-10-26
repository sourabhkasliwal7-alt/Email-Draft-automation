"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, FormMessage, SelectInput, SubmitButton, inputClass, useActionForm } from "@/components/form";
import { createImport, startImport } from "./actions";

export function UploadForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const { state, onSubmit, pending } = useActionForm(createImport);
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-3 rounded-lg border p-4" noValidate>
      <h2 className="font-medium">Upload a lead file</h2>
      <p className="text-xs text-zinc-500">CSV, TSV or Excel (.xlsx), up to 25 MB and 50,000 rows. Apollo exports work as they are.</p>
      <Field label="Campaign" name="campaignId" error={err.campaignId}>
        <SelectInput name="campaignId" defaultValue="" options={[{ value: "", label: "(choose a campaign)" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]} />
      </Field>
      <Field label="File" name="file" error={err.file}>
        <input id="file" name="file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm" className={inputClass} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Upload and continue</SubmitButton>
    </form>
  );
}

/** Re-renders the server page every couple of seconds while a worker is processing the file. */
export function AutoRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}

export interface MappingFormProps {
  batchId: string;
  headers: string[];
  fieldDefs: { key: string; label: string }[];
  initial: Record<string, string>;
  autoMapping: Record<string, string>;
  apolloMapping: Record<string, string> | null;
  templates: { id: string; name: string; fields: Record<string, string> }[];
  sheetNames: string[];
  sheet: string;
  headerMode: "auto" | "yes" | "no";
  mode: string;
  dryRun: boolean;
  requireEmail: boolean;
}

const MODES = [
  { value: "add_new", label: "Add new only", hint: "New people are created. People who already exist elsewhere are added to this campaign unchanged." },
  { value: "update_existing", label: "Update existing", hint: "Like add new, but fills in changed details (title, company, country...) for people who already exist." },
  { value: "skip_duplicates", label: "Skip duplicates", hint: "Anyone who already exists in the system is left out completely." },
];

export function MappingForm(p: MappingFormProps) {
  const { state, onSubmit, pending } = useActionForm(startImport);
  const [fields, setFields] = useState<Record<string, string>>(p.initial);
  const [dryRun, setDryRun] = useState(p.dryRun);
  const [mode, setMode] = useState(p.mode);
  const err = state.fieldErrors ?? {};
  const options = [{ value: "", label: "(not mapped)" }, ...p.headers.map((h) => ({ value: h, label: h }))];

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <input type="hidden" name="batchId" value={p.batchId} />
      <input type="hidden" name="sheet" value={p.sheet} />
      <input type="hidden" name="header" value={p.headerMode} />

      <section className="space-y-3">
        <h2 className="font-medium">Map your columns</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" className="rounded-md border px-3 py-1.5" onClick={() => setFields(p.autoMapping)}>
            Auto-detect
          </button>
          {p.apolloMapping && (
            <button type="button" className="rounded-md border px-3 py-1.5" onClick={() => setFields(p.apolloMapping!)}>
              Apollo preset
            </button>
          )}
          {p.templates.map((t) => (
            <button key={t.id} type="button" className="rounded-md border px-3 py-1.5" onClick={() => setFields(t.fields)}>
              Template: {t.name}
            </button>
          ))}
        </div>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {p.fieldDefs.map((f) => (
            <Field key={f.key} label={f.label} name={`map_${f.key}`}>
              <select
                id={`map_${f.key}`}
                name={`map_${f.key}`}
                value={fields[f.key] && p.headers.includes(fields[f.key]!) ? fields[f.key] : ""}
                onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                className={inputClass}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        {err.mapping && <p role="alert" data-testid="error-mapping" className="text-sm font-medium text-red-600">{err.mapping}</p>}
        {!p.requireEmail && <p className="text-xs text-zinc-500">This campaign is research-first: rows without an email are allowed if they have a profile URL, or a name plus a company.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">How to treat people who already exist</h2>
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-1" />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-xs text-zinc-500">{m.hint}</span>
            </span>
          </label>
        ))}
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="dryRun" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="mt-1" />
          <span>
            <span className="font-medium">Dry run</span>
            <span className="block text-xs text-zinc-500">Checks every row and shows the summary, but writes nothing. Recommended before the first real import.</span>
          </span>
        </label>
      </section>

      <section className="max-w-sm">
        <Field label="Save this mapping as a template (optional)" name="templateName" error={err.templateName}>
          <input id="templateName" name="templateName" className={inputClass} placeholder="e.g. Apollo people export" />
        </Field>
      </section>

      <FormMessage state={state} />
      <SubmitButton pending={pending}>{dryRun ? "Start dry run" : "Start import"}</SubmitButton>
    </form>
  );
}
