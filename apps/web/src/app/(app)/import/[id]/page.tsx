import { notFound } from "next/navigation";
import { formatKolkata } from "@outreach/core";
import {
  CANONICAL_FIELDS,
  applyPreset,
  autoDetectMapping,
  looksLikeApollo,
  readTable,
  type Mapping,
} from "@outreach/importer";
import { BackLink } from "@/components/bits";
import { Badge, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceDb } from "@/lib/supabase/service";
import { cancelImport, deleteTemplate } from "../actions";
import { AutoRefresh, MappingForm } from "../forms";

type Totals = {
  total?: number; imported?: number; updated?: number; duplicate?: number; invalid?: number; suppressed?: number; skipped?: number; failed?: number; blank?: number;
  processed?: number; headers?: string[]; parse_warnings?: string[]; encoding?: string | null; delimiter?: string | null; sheet?: string;
};
const RESULT_LABELS: [keyof Totals, string][] = [
  ["imported", "Imported"], ["updated", "Updated"], ["duplicate", "Duplicate"], ["invalid", "Invalid"], ["suppressed", "Suppressed"], ["skipped", "Skipped"], ["failed", "Failed"],
];

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sheet?: string; header?: string; status?: string }>;
}) {
  await requireUser("import.use");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: batch } = await supabase.from("import_batches").select("*, campaigns(name, icp)").eq("id", id).maybeSingle();
  if (!batch) notFound();

  const totals = (batch.totals ?? {}) as Totals;
  const running = batch.status === "mapped" || batch.status === "importing";
  const showMapping = batch.status === "uploaded" || batch.status === "failed" || (batch.status === "completed" && batch.dry_run);
  const requireEmail = (batch.campaigns?.icp as { requireEmail?: boolean } | null)?.requireEmail !== false;

  const { data: sameFile } = await supabase
    .from("import_batches")
    .select("id, created_at, status, dry_run")
    .eq("file_hash", batch.file_hash)
    .neq("id", batch.id)
    .order("created_at", { ascending: false })
    .limit(3);

  // Preview + mapping (only when the user can still change something)
  const loaded = showMapping && batch.storage_path ? await loadPreview(supabase, batch, sp) : null;
  const parseError = loaded && !loaded.ok ? loaded.error : null;
  const view = loaded && loaded.ok ? loaded : null;
  const preview = view ? (
      <section className="space-y-2">
        <h2 className="font-medium">First rows of your file (20 of {view.table.rows.length.toLocaleString("en-US")} rows)</h2>
        {view.table.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700">{w}</p>
        ))}
        <p className="text-xs text-zinc-500">
          {view.table.encoding ? `Encoding ${view.table.encoding}, delimiter ${view.table.delimiter === "\t" ? "tab" : view.table.delimiter}. ` : ""}
          {view.table.hasHeader ? "First row used as header." : "No header row: columns are named by position."}
        </p>
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          {view.table.sheetNames.length > 1 && (
            <label className="space-y-1">
              <span className="block text-xs font-medium">Worksheet</span>
              <select name="sheet" defaultValue={view.table.sheet} className="rounded-md border px-2 py-1.5">
                {view.table.sheetNames.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </label>
          )}
          <label className="space-y-1">
            <span className="block text-xs font-medium">First row is</span>
            <select name="header" defaultValue={view.headerMode} className="rounded-md border px-2 py-1.5">
              <option value="auto">Auto-detect</option>
              <option value="yes">A header</option>
              <option value="no">Data (no header)</option>
            </select>
          </label>
          <Button type="submit" variant="outline" size="sm">Reload preview</Button>
        </form>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs" data-testid="preview">
            <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
              <tr><th className="px-2 py-1">#</th>{view.table.headers.map((h) => (<th key={h} className="px-2 py-1">{h}</th>))}</tr>
            </thead>
            <tbody>
              {view.table.rows.slice(0, 20).map((r, i) => (
                <tr key={view.table.rowNumbers[i]} className="border-t">
                  <td className="px-2 py-1 text-zinc-400">{view.table.rowNumbers[i]}</td>
                  {r.map((c, k) => (<td key={k} className="max-w-48 truncate px-2 py-1">{c}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ) : null;
  const mapping = view ? (
      <MappingForm
        key={`${view.table.sheet}-${view.headerMode}`}
        batchId={batch.id}
        headers={view.table.headers}
        fieldDefs={CANONICAL_FIELDS.map((f) => ({ key: f.key, label: f.label }))}
        initial={view.initial as Record<string, string>}
        autoMapping={view.auto as Record<string, string>}
        apolloMapping={view.apollo as Record<string, string> | null}
        templates={view.templates.map((t) => ({ id: t.id, name: t.name, fields: ((t.mapping as unknown as Mapping).fields ?? {}) as Record<string, string> }))}
        sheetNames={view.table.sheetNames}
        sheet={view.table.sheet === "(csv)" ? "" : view.table.sheet}
        headerMode={view.headerMode}
        mode={batch.mode}
        dryRun={false}
        requireEmail={requireEmail}
      />
    ) : null;

  // Row results
  const statusFilter = sp.status && sp.status !== "all" ? sp.status : "problems";
  let rowsQuery = supabase.from("import_rows").select("row_number, status, errors, original").eq("batch_id", batch.id).order("row_number").limit(200);
  rowsQuery = statusFilter === "problems" ? rowsQuery.in("status", ["invalid", "duplicate", "suppressed", "skipped", "failed"]) : statusFilter === "all" ? rowsQuery : rowsQuery.eq("status", statusFilter);
  const { data: rows } = batch.status === "completed" ? await rowsQuery : { data: [] };
  const { data: templatesForDelete } = showMapping ? await supabase.from("import_templates").select("id, name").order("name") : { data: [] };

  const pct = totals.total ? Math.min(100, Math.round(((totals.processed ?? 0) / totals.total) * 100)) : 0;

  return (
    <>
      <BackLink href="/leads">Leads</BackLink>
      <PageHeader
        title={batch.file_name}
        description={`Campaign: ${batch.campaigns?.name ?? "-"} · uploaded ${formatKolkata(batch.created_at)}`}
        actions={<Badge tone={batch.status === "completed" ? "green" : batch.status === "failed" ? "red" : "amber"}>{batch.status === "completed" && batch.dry_run ? "preview done" : batch.status}</Badge>}
      />

      {sameFile && sameFile.length > 0 && (
        <p role="note" data-testid="same-file-warning" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This exact file was already uploaded on {formatKolkata(sameFile[0]!.created_at)} ({sameFile[0]!.status}). Importing it again is safe: people already in the campaign are reported as duplicates.
        </p>
      )}

      {batch.error && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{batch.error}</p>}
      {parseError && <p role="alert" data-testid="parse-error" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{parseError}</p>}

      {running && (
        <section data-testid="progress" className="mb-6 space-y-2 rounded-lg border p-4">
          <AutoRefresh />
          <p className="font-medium">{batch.status === "mapped" ? "Waiting for the background worker to pick this up…" : `${batch.dry_run ? "Preview" : "Import"} in progress`}</p>
          <div className="h-2 w-full overflow-hidden rounded bg-zinc-200"><div className="h-2 bg-zinc-900" style={{ width: `${pct}%` }} /></div>
          <p className="text-xs text-zinc-500">{(totals.processed ?? 0).toLocaleString("en-US")} of {(totals.total ?? 0).toLocaleString("en-US")} rows</p>
          {batch.status === "mapped" && <p className="text-xs text-zinc-500">The import runs in the background. If nothing happens after a minute, the background worker is not running (<code>pnpm dev</code> starts it).</p>}
          {batch.status === "mapped" && (
            <form action={cancelImport}><input type="hidden" name="id" value={batch.id} /><Button type="submit" variant="outline" size="sm">Cancel</Button></form>
          )}
        </section>
      )}

      {batch.status === "completed" && (
        <section className="mb-8 space-y-4">
          {batch.dry_run && (
            <p data-testid="dry-run-banner" className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
              Preview only: nothing was added. This is what would happen. Look at the rows below, then press Import in the form further down to add them.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" data-testid="summary">
            {RESULT_LABELS.map(([key, label]) => (
              <div key={key} className="rounded-lg border p-3">
                <div className="text-2xl font-semibold" data-testid={`total-${key}`}>{(totals[key] as number | undefined) ?? 0}</div>
                <div className="text-xs text-zinc-500">{label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            {totals.total} data rows{totals.blank ? ` (+ ${totals.blank} blank ignored)` : ""} · sheet {totals.sheet} · {batch.mode.replace("_", " ")}
          </p>
          {(totals.parse_warnings ?? []).map((w) => (<p key={w} className="text-xs text-amber-700">{w}</p>))}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Show:</span>
            {["problems", "all", "imported", "updated", "duplicate", "invalid", "suppressed", "skipped", "failed"].map((s) => (
              <a key={s} href={`?status=${s}`} className={statusFilter === s ? "font-semibold underline" : "text-zinc-600 underline-offset-2 hover:underline"}>{s}</a>
            ))}
            <a href={`/import/${batch.id}/errors`} data-testid="download-errors" className="ml-auto rounded-md border px-3 py-1.5">Download rows that were not imported (CSV)</a>
          </div>
          {!rows?.length ? (
            <p className="text-sm text-zinc-500">No rows with this status.</p>
          ) : (
            <table className="w-full text-sm" data-testid="rows">
              <thead className="text-left text-xs uppercase text-zinc-500"><tr><th className="py-2">Row</th><th>Status</th><th>Why</th><th>Original</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row_number} className="border-t align-top" data-testid="import-result-row">
                    <td className="py-2">{r.row_number}</td>
                    <td><Badge tone={r.status === "imported" || r.status === "updated" ? "green" : r.status === "invalid" || r.status === "failed" ? "red" : "amber"}>{r.status}</Badge></td>
                    <td>{(r.errors ?? []).filter((e: string) => !e.startsWith("Note:")).join(" ")}</td>
                    <td className="max-w-md truncate text-xs text-zinc-500">{(totals.headers ?? Object.keys(r.original as Record<string, string>)).map((h) => (r.original as Record<string, string>)[h]).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {showMapping && !parseError && (
        <div className="space-y-6">
          {batch.status === "completed" && <h2 className="text-lg font-semibold">Now import for real</h2>}
          {preview}
          {mapping}
          {!!templatesForDelete?.length && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Saved templates</summary>
              <ul className="mt-2 space-y-1">
                {templatesForDelete.map((t) => (
                  <li key={t.id} className="flex items-center gap-3">
                    {t.name}
                    <form action={deleteTemplate}><input type="hidden" name="id" value={t.id} /><Button type="submit" variant="destructive" size="xs">Delete</Button></form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}

type Preview = {
  ok: true;
  table: Awaited<ReturnType<typeof readTable>>;
  headerMode: "auto" | "yes" | "no";
  auto: Mapping["fields"];
  apollo: Mapping["fields"] | null;
  initial: Mapping["fields"];
  templates: { id: string; name: string; mapping: unknown }[];
};

/** Reads the uploaded file for the preview. Errors become a message for the page instead of a crash. */
async function loadPreview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  batch: { file_name: string; storage_path: string | null; mapping: unknown; sheet: string | null },
  sp: { sheet?: string; header?: string },
): Promise<Preview | { ok: false; error: string }> {
  try {
    const dl = await createServiceDb().storage.from("imports").download(batch.storage_path!);
    if (dl.error || !dl.data) throw new Error("The uploaded file could not be read from storage.");
    const stored = (batch.mapping ?? {}) as Mapping;
    const headerMode = sp.header === "yes" || sp.header === "no" ? sp.header : stored.firstRowIsHeader === undefined ? "auto" : stored.firstRowIsHeader ? "yes" : "no";
    const table = await readTable(
      { name: batch.file_name, bytes: new Uint8Array(await dl.data.arrayBuffer()) },
      { sheet: sp.sheet ?? batch.sheet ?? undefined, firstRowIsHeader: headerMode === "auto" ? undefined : headerMode === "yes" },
    );
    const auto = autoDetectMapping(table.headers).fields;
    const apollo = looksLikeApollo(table.headers) ? applyPreset(table.headers, "apollo").fields : null;
    const initial = stored.fields && Object.keys(stored.fields).length ? stored.fields : (apollo ?? auto);
    const { data: templates } = await supabase.from("import_templates").select("id, name, mapping").order("name");
    return { ok: true, table, headerMode, auto, apollo, initial, templates: templates ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The file could not be read." };
  }
}
