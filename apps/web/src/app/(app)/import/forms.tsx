"use client";

import { ArrowRight, Download, FileSpreadsheet, ScanSearch, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, FormMessage, SelectInput, SubmitButton, inputClass, useActionForm } from "@/components/form";
import { HelpTip } from "@/components/help-tip";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createImport, startImport } from "./actions";

export function UploadForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const { state, onSubmit, pending } = useActionForm(createImport);
  const err = state.fieldErrors ?? {};
  const [fileName, setFileName] = useState("");
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate data-testid="upload-form">
      <p className="text-sm text-muted-foreground">A CSV or Excel (.xlsx) file, up to 25 MB. Apollo exports work as they are. Next you check the columns, then press Import.</p>
      <Field label="Campaign" name="campaignId" error={err.campaignId} help="The campaign these people are added to. Its target and offer decide how they are checked and written to.">
        <SelectInput name="campaignId" defaultValue="" options={[{ value: "", label: "(choose a campaign)" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]} />
      </Field>
      <Field label="File" name="file" error={err.file}>
        <label
          htmlFor="file"
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-card px-4 py-4 text-sm transition-colors hover:border-brand hover:bg-brand-soft focus-within:ring-3 focus-within:ring-ring/30",
            fileName && "border-brand bg-brand-soft",
          )}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand" aria-hidden>
            <FileSpreadsheet className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{fileName || "Choose a file"}</span>
            <span className="block text-xs text-muted-foreground">{fileName ? "Press Upload and continue when ready." : ".csv, .tsv, .txt or .xlsx"}</span>
          </span>
          <input id="file" name="file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
        </label>
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} icon={<ArrowRight aria-hidden />}>
        Upload and continue
      </SubmitButton>
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
  /** the first row of the file, by column name, so each choice can show an example */
  samples?: Record<string, string>;
}

const MODES = [
  { value: "add_new", label: "Add new people only", hint: "New people are added. People we already know are added to this campaign without changing their details." },
  { value: "update_existing", label: "Add new people and update the ones we know", hint: "Also fills in changed details (title, company, country...) for people we already know." },
  { value: "skip_duplicates", label: "Leave out anyone we already know", hint: "Anyone already in the system is left out completely." },
];

export function MappingForm(p: MappingFormProps) {
  const { state, onSubmit, pending } = useActionForm(startImport);
  const [fields, setFields] = useState<Record<string, string>>(p.initial);
  const [dryRun, setDryRun] = useState(p.dryRun);
  const [mode, setMode] = useState(p.mode);
  const err = state.fieldErrors ?? {};
  const options = [{ value: "", label: "(not mapped)" }, ...p.headers.map((h) => ({ value: h, label: h }))];
  const chosen = (key: string) => (fields[key] && p.headers.includes(fields[key]!) ? fields[key]! : "");
  const mappedCount = p.fieldDefs.filter((f) => chosen(f.key)).length;

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate data-testid="mapping-form">
      <input type="hidden" name="batchId" value={p.batchId} />
      <input type="hidden" name="sheet" value={p.sheet} />
      <input type="hidden" name="header" value={p.headerMode} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Check the columns</CardTitle>
            <CardDescription>
              Tell us which column of your file holds what. {mappedCount} of {p.fieldDefs.length} are matched. Anything left as “not mapped” is simply not imported.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" icon={<Wand2 aria-hidden />} onClick={() => setFields(p.autoMapping)}>
              Auto-detect
            </Button>
            {p.apolloMapping && (
              <Button type="button" variant="outline" size="sm" icon={<Sparkles aria-hidden />} onClick={() => setFields(p.apolloMapping!)}>
                Apollo preset
              </Button>
            )}
            {p.templates.map((t) => (
              <Button key={t.id} type="button" variant="outline" size="sm" onClick={() => setFields(t.fields)}>
                Template: {t.name}
              </Button>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm" data-testid="mapping-table">
              <thead className="bg-muted/60 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2.5">
                    We need
                  </th>
                  <th scope="col" className="px-4 py-2.5">
                    Column in your file
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 md:table-cell">
                    Example from row 1
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {p.fieldDefs.map((f) => {
                  const col = chosen(f.key);
                  return (
                    <tr key={f.key} data-field={`map_${f.key}`} className="align-middle">
                      <td className="px-4 py-2.5">
                        <label htmlFor={`map_${f.key}`} className="font-medium">
                          {f.label}
                        </label>
                      </td>
                      <td className="px-4 py-2">
                        <select
                          id={`map_${f.key}`}
                          name={`map_${f.key}`}
                          value={col}
                          onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                          className={cn(inputClass, "py-2 pr-9", !col && "text-muted-foreground")}
                        >
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="hidden max-w-56 truncate px-4 py-2.5 text-xs text-muted-foreground md:table-cell">{col ? (p.samples?.[col] ?? "") || "(empty)" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err.mapping && (
            <p role="alert" data-testid="error-mapping" className="text-sm font-medium text-red-700">
              {err.mapping}
            </p>
          )}
          {!p.requireEmail && <p className="text-xs text-muted-foreground">This campaign does not need an email in the file: rows without one are allowed if they have a profile link, or a name plus a company. (Emails are found with Apollo.)</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div>
              <CardTitle>People we already know</CardTitle>
              <CardDescription>What to do when someone in the file is already in the system.</CardDescription>
            </div>
            <HelpTip label="People we already know">We recognise someone by their email address, or by their profile link when there is no email. Pick how those people are handled.</HelpTip>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <div role="radiogroup" className="space-y-2">
            {MODES.map((m) => (
              <label key={m.value} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm transition-colors", mode === m.value ? "border-brand bg-brand-soft" : "bg-card hover:border-zinc-400")}>
                <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-1 accent-[var(--brand)]" />
                <span>
                  <span className="font-medium">{m.label}</span>
                  <span className="block text-xs text-muted-foreground">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm transition-colors", dryRun ? "border-brand bg-brand-soft" : "bg-card hover:border-zinc-400")}>
            <input type="checkbox" name="dryRun" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="mt-1 accent-[var(--brand)]" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <ScanSearch className="size-4 text-brand" aria-hidden />
                Preview only
              </span>
              <span className="block text-xs text-muted-foreground">Checks every row and shows what would happen, but adds nothing. Optional.</span>
            </span>
          </label>
          <Field label="Remember these columns for next time (optional name)" name="templateName" error={err.templateName}>
            <input id="templateName" name="templateName" className={`${inputClass} max-w-sm`} placeholder="e.g. Apollo export" />
          </Field>
        </CardBody>
      </Card>

      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} icon={dryRun ? <ScanSearch aria-hidden /> : <Download aria-hidden />}>
          {dryRun ? "Preview only" : "Import"}
        </SubmitButton>
        <span className="text-xs text-muted-foreground">{dryRun ? "Nothing is added to your leads." : "People are added to the campaign. Nothing is sent."}</span>
      </div>
    </form>
  );
}
