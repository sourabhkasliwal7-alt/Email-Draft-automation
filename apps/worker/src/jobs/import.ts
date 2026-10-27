import type { DbClient, Json, Tables, TablesUpdate } from "@outreach/db";
import {
  KeyIndex,
  classifyRow,
  dedupeKeys,
  emptyTotals,
  foldName,
  normalizeRow,
  readTable,
  type ExistingContact,
  type ImportMode,
  type ImportTotals,
  type Mapping,
  type NormalizedRow,
  type ParsedTable,
  type RowOutcome,
  type RowStatus,
  type SuppressionIndex,
} from "@outreach/importer";

const CHUNK = 500;
const IN_BATCH = 100;

export interface ImportJobPayload {
  batchId: string;
  /** import_batches.runs at enqueue time; lets a retry of the same run resume instead of starting over */
  run: number;
}

type ExistingHit = ExistingContact & { contactId: string; companyId: string | null };
type Item = { rowNumber: number; original: Record<string, string>; n: NormalizedRow; outcome: RowOutcome };
type Final = { status: RowStatus | "failed"; messages: string[]; contactId: string | null };

const unique = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined && (x as unknown) !== ""))];
const batches = <T>(xs: T[], size = IN_BATCH): T[][] => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

function must<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as NonNullable<T>;
}

/** All global suppression rows + the ones for this campaign, as lookup sets (checked at import). */
export async function loadSuppression(db: DbClient, campaignId: string): Promise<SuppressionIndex> {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const rows = must(
      await db
        .from("suppression")
        .select("email_lower, domain, scope, campaign_id")
        .or(`scope.eq.global,campaign_id.eq.${campaignId}`)
        .order("id")
        .range(from, from + 999),
      "load suppression",
    );
    for (const r of rows) {
      // A row with both an email and a domain only matches when both match; the importer treats each side on its own,
      // which is the conservative (more suppressing) reading.
      if (r.email_lower) emails.add(r.email_lower);
      if (r.domain) domains.add(r.domain);
    }
    if (rows.length < 1000) break;
  }
  return { emails, domains };
}

/** Contacts that already exist for this chunk, found by email, profile URL, or company domain (+ name match). */
export async function findExisting(db: DbClient, rows: NormalizedRow[], campaignId: string): Promise<KeyIndex<ExistingHit>> {
  const cols = "id, full_name, email_lower, profile_url, dnc, company_id, companies(domain)";
  const found = new Map<string, Awaited<ReturnType<typeof fetchContacts>>[number]>();
  async function fetchContacts(column: "email_lower" | "profile_url" | "company_id", values: string[]) {
    const out: {
      id: string; full_name: string | null; email_lower: string | null; profile_url: string | null; dnc: boolean; company_id: string | null; companies: { domain: string } | null;
    }[] = [];
    for (const b of batches(values)) out.push(...must(await db.from("contacts").select(cols).in(column, b), `find contacts by ${column}`));
    return out;
  }
  for (const c of await fetchContacts("email_lower", unique(rows.map((r) => r.email_lower)))) found.set(c.id, c);
  for (const c of await fetchContacts("profile_url", unique(rows.map((r) => r.profile_url)))) found.set(c.id, c);

  const domains = unique(rows.filter((r) => r.full_name).map((r) => r.company_domain));
  const companyIds: string[] = [];
  for (const b of batches(domains)) companyIds.push(...must(await db.from("companies").select("id").in("domain", b), "find companies").map((c) => c.id));
  for (const c of await fetchContacts("company_id", companyIds)) found.set(c.id, c);

  const member = new Set<string>();
  for (const b of batches([...found.keys()])) {
    for (const l of must(await db.from("campaign_leads").select("contact_id").eq("campaign_id", campaignId).in("contact_id", b), "find memberships")) member.add(l.contact_id);
  }

  const index = new KeyIndex<ExistingHit>();
  for (const c of found.values()) {
    const domain = c.companies?.domain ?? null;
    index.add(
      { email: c.email_lower, profile: c.profile_url, nameCompany: domain && c.full_name ? `${domain}|${foldName(c.full_name)}` : null },
      { id: c.id, contactId: c.id, companyId: c.company_id, dnc: c.dnc, inCampaign: member.has(c.id) },
    );
  }
  return index;
}

function contactPatch(n: NormalizedRow, companyId: string | null): TablesUpdate<"contacts"> {
  const patch: Record<string, string | null> = {
    full_name: n.full_name, first_name: n.first_name, last_name: n.last_name, job_title: n.job_title, country: n.country,
    company_name: n.company_name, profile_url: n.profile_url,
  };
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== ""));
  if (companyId) clean.company_id = companyId;
  if (n.email_status !== "unknown") clean.email_status = n.email_status;
  return clean as TablesUpdate<"contacts">;
}

/** Writes one chunk. Idempotent: contacts/companies/leads are looked up or inserted with conflict handling. */
async function writeChunk(
  db: DbClient,
  items: Item[],
  ctx: { campaignId: string; batchId: string; mode: ImportMode; leadSourceDefault: string },
): Promise<Map<number, Final>> {
  const finals = new Map<number, Final>();
  const live = items.filter((i) => ["imported", "updated"].includes(i.outcome.status));

  // 1. companies by domain
  const wanted = new Map<string, NormalizedRow>();
  for (const i of live) if (i.n.company_domain && !wanted.has(i.n.company_domain)) wanted.set(i.n.company_domain, i.n);
  const companyIds = new Map<string, string>();
  const domains = [...wanted.keys()];
  const loadCompanies = async () => {
    for (const b of batches(domains)) for (const c of must(await db.from("companies").select("id, domain").in("domain", b), "load companies")) companyIds.set(c.domain, c.id);
  };
  await loadCompanies();
  const missing = domains.filter((d) => !companyIds.has(d));
  if (missing.length) {
    const rows = missing.map((d) => {
      const n = wanted.get(d)!;
      return { domain: d, name: n.company_name, country: n.country, industry: n.industry, employee_count: n.employee_count, website: `https://${d}` };
    });
    must(await db.from("companies").upsert(rows, { onConflict: "domain", ignoreDuplicates: true }), "insert companies");
    await loadCompanies();
  }
  if (ctx.mode === "update_existing") {
    for (const d of domains.filter((x) => !missing.includes(x))) {
      const n = wanted.get(d)!;
      const patch = Object.fromEntries(
        Object.entries({ name: n.company_name, country: n.country, industry: n.industry, employee_count: n.employee_count }).filter(([, v]) => v !== null && v !== ""),
      ) as TablesUpdate<"companies">;
      if (Object.keys(patch).length) must(await db.from("companies").update(patch).eq("domain", d), "update company");
    }
  }
  const companyOf = (n: NormalizedRow) => (n.company_domain ? (companyIds.get(n.company_domain) ?? null) : null);

  // 2. new contacts (bulk first, row by row if anything conflicts)
  const fresh = live.filter((i) => i.outcome.createContact);
  const payload = (i: Item) => ({
    full_name: i.n.full_name, first_name: i.n.first_name, last_name: i.n.last_name, job_title: i.n.job_title, email: i.n.email,
    email_status: i.n.email_status, profile_url: i.n.profile_url, company_id: companyOf(i.n), company_name: i.n.company_name, country: i.n.country,
  });
  const contactIdOf = new Map<number, string>();
  if (fresh.length) {
    const bulk = await db.from("contacts").insert(fresh.map(payload)).select("id");
    if (!bulk.error && bulk.data?.length === fresh.length) {
      fresh.forEach((i, k) => contactIdOf.set(i.rowNumber, bulk.data![k]!.id));
    } else {
      for (const i of fresh) {
        const one = await db.from("contacts").insert(payload(i)).select("id").single();
        if (one.error) finals.set(i.rowNumber, { status: "failed", messages: [`Could not save this contact: ${one.error.message}`], contactId: null });
        else contactIdOf.set(i.rowNumber, one.data.id);
      }
    }
  }

  // 3. existing contacts: link, and update fields in update_existing mode
  for (const i of live) {
    const ex = i.outcome.existing as ExistingHit | undefined;
    if (!ex) continue;
    if (i.outcome.status === "updated") {
      const patch = contactPatch(i.n, companyOf(i.n));
      const r = await db.from("contacts").update(patch).eq("id", ex.contactId);
      if (r.error) {
        finals.set(i.rowNumber, { status: "failed", messages: [`Could not update this contact: ${r.error.message}`], contactId: ex.contactId });
        continue;
      }
    }
    contactIdOf.set(i.rowNumber, ex.contactId);
  }

  // 4. campaign leads (never resets an existing lead) + history events
  const leadRows = live.filter((i) => contactIdOf.has(i.rowNumber)).map((i) => ({
    campaign_id: ctx.campaignId, contact_id: contactIdOf.get(i.rowNumber)!, lead_source: i.n.lead_source ?? ctx.leadSourceDefault, status: "imported",
  }));
  if (leadRows.length) {
    must(await db.from("campaign_leads").upsert(leadRows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true }), "insert leads");
    const leadIds = new Map<string, string>();
    for (const b of batches(leadRows.map((l) => l.contact_id))) {
      for (const l of must(await db.from("campaign_leads").select("id, contact_id").eq("campaign_id", ctx.campaignId).in("contact_id", b), "load leads")) leadIds.set(l.contact_id, l.id);
    }
    const events = live
      .filter((i) => contactIdOf.has(i.rowNumber) && !finals.has(i.rowNumber))
      .map((i) => ({
        campaign_lead_id: leadIds.get(contactIdOf.get(i.rowNumber)!) ?? null,
        contact_id: contactIdOf.get(i.rowNumber)!,
        type: i.outcome.status === "updated" ? "import_updated" : "imported",
        payload: { batch_id: ctx.batchId, row_number: i.rowNumber, mode: ctx.mode, matched_by: i.outcome.matchedBy ?? null } as Json,
        actor: "import",
      }));
    if (events.length) must(await db.from("lead_events").insert(events), "insert lead events");
  }

  for (const i of live) {
    if (finals.has(i.rowNumber)) continue;
    finals.set(i.rowNumber, { status: i.outcome.status, messages: i.outcome.messages, contactId: contactIdOf.get(i.rowNumber) ?? null });
  }
  return finals;
}

const asJson = (v: unknown) => v as Json;

/**
 * Runs (or resumes) an import batch. Safe to run twice: import_rows are keyed (batch_id, row_number), contacts and
 * leads are unique, and a retry of the same run skips the rows already recorded.
 */
export async function runImportJob(db: DbClient, payload: ImportJobPayload, log: (m: string) => void = () => {}): Promise<ImportTotals> {
  const batch = must(await db.from("import_batches").select("*").eq("id", payload.batchId).single(), "load batch");
  if (!batch.campaign_id) throw new Error("This import has no campaign.");
  if (!batch.storage_path) throw new Error("This import has no uploaded file.");
  const campaign = must(await db.from("campaigns").select("id, icp").eq("id", batch.campaign_id).single(), "load campaign");
  const requireEmail = (campaign.icp as { requireEmail?: boolean } | null)?.requireEmail !== false;
  const stored = batch.mapping as unknown as Mapping;
  const file = await db.storage.from("imports").download(batch.storage_path);
  if (file.error || !file.data) throw new Error(`Could not read the uploaded file: ${file.error?.message ?? "missing"}`);
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const table = await readTable({ name: batch.file_name, bytes }, { sheet: batch.sheet ?? undefined, firstRowIsHeader: stored.firstRowIsHeader });

  return importTable(db, batch, { requireEmail, stored, run: payload.run }, table, log);
}

/** The shared import engine: normalise, validate, dedupe, suppression/DNC check and write. Used by CSV/XLSX files and by the Apollo pull. */
export async function importTable(
  db: DbClient,
  batch: Tables<"import_batches">,
  opts: { requireEmail: boolean; stored: Mapping; run: number },
  table: ParsedTable,
  log: (m: string) => void = () => {},
): Promise<ImportTotals> {
  if (!batch.campaign_id) throw new Error("This import has no campaign.");
  const { requireEmail, stored, run } = opts;
  const mode = batch.mode as ImportMode;
  const dryRun = batch.dry_run;

  const prevTotals = (batch.totals ?? {}) as Record<string, unknown>;
  const resume = prevTotals.current_run === run && batch.status === "importing";
  if (!resume) must(await db.from("import_rows").delete().eq("batch_id", batch.id).select("id"), "clear previous rows");

  const totals = emptyTotals();
  totals.total = table.rows.length;
  totals.blank = table.blankRows;
  const suppression = await loadSuppression(db, batch.campaign_id);
  const seen = new KeyIndex<number>();
  const done = new Set<number>();

  if (resume) {
    for (let from = 0; ; from += 1000) {
      const rows = must(await db.from("import_rows").select("row_number, status, normalized").eq("batch_id", batch.id).order("row_number").range(from, from + 999), "load finished rows");
      for (const r of rows) {
        done.add(r.row_number);
        totals[r.status as keyof ImportTotals] += 1;
        if ((r.status === "imported" || r.status === "updated") && r.normalized) seen.add(dedupeKeys(r.normalized as unknown as NormalizedRow), r.row_number);
      }
      if (rows.length < 1000) break;
    }
  }

  const base = { headers: table.headers, current_run: run, sheet: table.sheet, encoding: table.encoding, delimiter: table.delimiter, parse_warnings: table.warnings, dry_run: dryRun };
  const progress = async (processed: number) =>
    must(await db.from("import_batches").update({ status: "importing", totals: asJson({ ...totals, ...base, processed, phase: "processing" }) }).eq("id", batch.id), "save progress");
  await progress(done.size);
  log(`import ${batch.id}: ${table.rows.length} rows, mode=${mode}, dryRun=${dryRun}, resume=${resume}`);

  const leadSourceDefault = `import:${batch.file_name}`;
  for (let start = 0; start < table.rows.length; start += CHUNK) {
    const idxs = Array.from({ length: Math.min(CHUNK, table.rows.length - start) }, (_, k) => start + k).filter((i) => !done.has(table.rowNumbers[i]!));
    if (idxs.length === 0) continue;

    const parsed = idxs.map((i) => {
      const original = Object.fromEntries(table.headers.map((h, c) => [h, table.rows[i]![c] ?? ""]));
      return { rowNumber: table.rowNumbers[i]!, original, n: normalizeRow(original, stored, { leadSource: leadSourceDefault }) };
    });
    const existing = await findExisting(db, parsed.map((p) => p.n), batch.campaign_id);
    const ctx = { mode, rules: { requireEmail }, suppression, seen, existing };
    const items: Item[] = parsed.map((p) => ({ ...p, outcome: classifyRow(p.n, p.rowNumber, ctx) }));

    const finals = dryRun
      ? new Map<number, Final>(items.map((i) => [i.rowNumber, { status: i.outcome.status, messages: i.outcome.messages, contactId: null }]))
      : await writeChunk(db, items, { campaignId: batch.campaign_id, batchId: batch.id, mode, leadSourceDefault });

    const records = items.map((i) => {
      const f = finals.get(i.rowNumber) ?? { status: i.outcome.status, messages: i.outcome.messages, contactId: null };
      totals[f.status] += 1;
      const notes = [...f.messages, ...i.n.warnings.map((w) => `Note: ${w}`)];
      return { batch_id: batch.id, row_number: i.rowNumber, original: asJson(i.original), normalized: asJson(i.n), status: f.status, errors: notes, contact_id: f.contactId };
    });
    must(await db.from("import_rows").upsert(records, { onConflict: "batch_id,row_number" }), "save row results");
    await progress(totals.imported + totals.updated + totals.duplicate + totals.invalid + totals.suppressed + totals.skipped + totals.failed);
  }

  must(
    await db
      .from("import_batches")
      .update({ status: "completed", error: null, totals: asJson({ ...totals, ...base, processed: table.rows.length, phase: "done" }) })
      .eq("id", batch.id),
    "finish batch",
  );
  log(`import ${batch.id} done: ${JSON.stringify(totals)}`);
  return totals;
}
