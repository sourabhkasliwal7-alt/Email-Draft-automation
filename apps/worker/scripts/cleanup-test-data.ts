/**
 * Clean ONLY test and demo data, so the next real test starts empty.
 *
 *   pnpm --filter @outreach/worker exec tsx scripts/cleanup-test-data.ts --preview   (default) deletes everything inside a transaction, prints the counts, then ROLLS BACK: nothing changes
 *   pnpm --filter @outreach/worker exec tsx scripts/cleanup-test-data.ts --backup    writes the backup only
 *   pnpm --filter @outreach/worker exec tsx scripts/cleanup-test-data.ts --run       backup first, then the real deletion, then the checks
 *   add  --keep-campaign "CSV test 15"  (repeatable) to keep a campaign (its offer and mailbox are kept with it; all leads still go)
 *
 * NEVER touched: the schema and migrations, auth users and profiles, the connected Gmail mailbox and its encrypted token, .env,
 * settings (footer, schedule, models, workflow), price_table, spend_caps, audit_log (existing rows; the cleanup itself adds audit rows,
 * because every change to offers, campaigns, suppression and mailboxes is audited by a trigger, and that is wanted).
 *
 * Why triggers are switched off: the app forbids deleting leads, contacts, companies, campaigns, drafts and runs, and makes lead_events
 * append-only, with guard triggers (block_delete / block_mutation). This script switches off exactly those named guard triggers on exactly those
 * tables, inside ONE transaction, deletes the test rows, switches them on again, and checks they are on before it commits. Foreign-key checks
 * stay on the whole time (session_replication_role is NOT used), so a wrong order or a missed reference makes the transaction fail and roll back.
 * If anything goes wrong nothing is changed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { createServiceClient } from "@outreach/db";

config({ path: join(process.cwd(), "../../.env") });

const args = process.argv.slice(2);
const mode: "preview" | "backup" | "run" = args.includes("--run") ? "run" : args.includes("--backup") ? "backup" : "preview";
const keepCampaigns = args.flatMap((a, i) => (a === "--keep-campaign" && args[i + 1] ? [args[i + 1]!] : []));
const ROOT = join(process.cwd(), "../..");

/** guard triggers that are switched off for the transaction (table, trigger) and checked back on before the commit */
const GUARDS: [string, string][] = [
  ["lead_events", "block_mutation"],
  ["send_approvals", "block_mutation"],
  ["replies", "block_delete"],
  ["email_sends", "block_delete"],
  ["email_drafts", "block_delete"],
  ["credit_ledger", "block_delete"],
  ["pipeline_batches", "block_delete"],
  ["campaign_leads", "block_delete"],
  ["contacts", "block_delete"],
  ["companies", "block_delete"],
  ["campaigns", "block_delete"],
];

const TEST_OFFER = `(name like 'Nuance:%' or name like 'e2e-offer-%' or name like 'itest%')`;
const TEST_ADDRESS = `(coalesce(email_lower, domain) ilike '%itest%' or coalesce(email_lower, domain) ilike '%e2e%')`;

/** children first. `n` is what is counted as "deleted" for the table. */
const STEPS: { table: string; sql: string; params?: () => unknown[] }[] = [
  { table: "lead_events", sql: "delete from public.lead_events" },
  { table: "replies", sql: "delete from public.replies" },
  { table: "send_approvals", sql: "delete from public.send_approvals" },
  { table: "email_sends", sql: "delete from public.email_sends" },
  { table: "followups", sql: "delete from public.followups" },
  { table: "credit_ledger", sql: "delete from public.credit_ledger where is_mock = true" },
  { table: "email_drafts", sql: "delete from public.email_drafts" },
  { table: "enrichment_results", sql: "delete from public.enrichment_results" },
  { table: "signals", sql: "delete from public.signals" },
  { table: "evidence_items", sql: "delete from public.evidence_items" },
  { table: "research_runs", sql: "delete from public.research_runs" },
  { table: "usage_records", sql: "delete from public.usage_records" },
  { table: "job_steps", sql: "delete from public.job_steps" },
  { table: "jobs", sql: "delete from public.jobs" },
  { table: "import_rows", sql: "delete from public.import_rows" },
  { table: "import_batches", sql: "delete from public.import_batches" },
  { table: "pipeline_batches", sql: "delete from public.pipeline_batches" },
  { table: "campaign_leads", sql: "delete from public.campaign_leads" },
  { table: "contacts", sql: "delete from public.contacts" },
  { table: "companies", sql: "delete from public.companies" },
  // seeded and test do-not-contact rows first: some point at a campaign (campaign-scope rows)
  { table: "suppression", sql: `delete from public.suppression where source = 'seed' or ${TEST_ADDRESS}` },
  { table: "campaigns", sql: "delete from public.campaigns where not (name = any($1::text[]))", params: () => [keepCampaigns] },
  // an offer that a kept campaign still uses stays (and so do its case studies)
  { table: "case_studies", sql: `delete from public.case_studies where title like 'Demo:%' or offer_id in (select id from public.offers where ${TEST_OFFER} and id not in (select offer_id from public.campaigns where offer_id is not null))` },
  { table: "offers", sql: `delete from public.offers where ${TEST_OFFER} and id not in (select offer_id from public.campaigns where offer_id is not null)` },
  { table: "inboxes", sql: "delete from public.inboxes where email = 'demo-sender@example.com' and id not in (select inbox_id from public.campaigns where inbox_id is not null)" },
];

/** tables listed in the report (what stays and what goes) */
const REPORT_TABLES = [...new Set(STEPS.map((s) => s.table)), "import_templates", "worker_heartbeats", "settings", "price_table", "spend_caps", "profiles", "audit_log"];
const CONFIG_TABLES = ["settings", "price_table", "spend_caps", "profiles"] as const;

async function counts(c: pg.ClientBase): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of REPORT_TABLES) out[t] = Number((await c.query(`select count(*)::int as n from public.${t}`)).rows[0].n);
  return out;
}

async function fingerprint(c: pg.ClientBase) {
  const hash = async (t: string) => (await c.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`)).rows[0].h as string;
  const config: Record<string, string> = {};
  for (const t of CONFIG_TABLES) config[t] = await hash(t);
  const mailbox = (await c.query(`select email, status, (encrypted_refresh_token is not null) as has_token, md5(encrypted_refresh_token) as token_md5, scopes from public.inboxes where deleted_at is null and email <> 'demo-sender@example.com' order by email`)).rows;
  return { config, mailbox };
}

/** refuse to continue if something that looks REAL would be lost */
async function safetyChecks(c: pg.ClientBase) {
  const problems: string[] = [];
  const real = Number((await c.query("select count(*)::int as n from public.credit_ledger where is_mock = false")).rows[0].n);
  if (real) problems.push(`credit_ledger has ${real} real (non-test) Apollo credit rows: they are NOT deleted, and contacts they point to cannot be deleted. Decide what to do with them first.`);
  const sent = Number((await c.query("select count(*)::int as n from public.email_sends where status in ('sent','sending','unknown')")).rows[0].n);
  if (sent) problems.push(`email_sends has ${sent} rows that were sent: these must never be deleted by a cleanup.`);
  const running = Number((await c.query("select count(*)::int as n from public.pipeline_batches where status = 'running'")).rows[0].n);
  if (running) problems.push(`${running} run(s) are in progress: wait for them to finish (or cancel them), then run the cleanup again.`);
  return problems;
}

async function listCampaigns(c: pg.ClientBase) {
  return (await c.query("select name, coalesce(icp->>'leadSource', '-') as source, (deleted_at is not null) as archived from public.campaigns order by created_at")).rows as { name: string; source: string; archived: boolean }[];
}

/** the deletion itself: guards off, deletes in order, guards on, guards verified. Returns rows deleted per table. */
async function deleteAll(c: pg.ClientBase): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  await c.query("set local lock_timeout = '15s'");
  for (const [t, trg] of GUARDS) await c.query(`alter table public.${t} disable trigger ${trg}`);
  for (const step of STEPS) {
    const r = await c.query(step.sql, step.params?.());
    deleted[step.table] = (deleted[step.table] ?? 0) + (r.rowCount ?? 0);
  }
  for (const [t, trg] of GUARDS) await c.query(`alter table public.${t} enable trigger ${trg}`);
  const off = (await c.query(`select c.relname || '.' || t.tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and t.tgenabled <> 'O' and not t.tgisinternal`)).rows;
  if (off.length) throw new Error(`guard triggers are not enabled again: ${off.map((r) => r.name).join(", ")}`);
  // the queue tables of pg-boss that hold JOBS (not its settings: queue, schedule, subscription, version)
  const boss = (await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pgboss' and c.relkind = 'r' and c.relname not in ('queue', 'schedule', 'subscription', 'version')`)).rows;
  let bossRows = 0;
  for (const b of boss) bossRows += (await c.query(`delete from pgboss."${b.relname}"`)).rowCount ?? 0;
  deleted["pgboss (queued jobs)"] = bossRows;
  return deleted;
}

async function backup(c: pg.ClientBase, storage: ReturnType<typeof createServiceClient>["storage"]) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(ROOT, "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `cleanup-${stamp}.json`);
  const dump: Record<string, unknown> = { takenAt: new Date().toISOString(), note: "Backup before cleanup_test_data. Not committed to git. The Gmail refresh token is NOT exported." };
  for (const t of [...new Set(STEPS.map((s) => s.table))]) {
    // the mailbox table is exported without its encrypted token
    const cols = t === "inboxes" ? (await c.query("select string_agg(quote_ident(column_name), ', ') as cols from information_schema.columns where table_schema = 'public' and table_name = 'inboxes' and column_name <> 'encrypted_refresh_token'")).rows[0].cols : "*";
    dump[t] = (await c.query(`select ${cols} from public.${t}`)).rows;
  }
  dump["pipeline_note"] = "the demo/test suppression and offer rows are included in their tables above";
  // the uploaded import files too (small CSV/XLSX files)
  const objects = (await c.query("select name from storage.objects where bucket_id = 'imports' order by name")).rows.map((r) => r.name as string);
  const filesDir = join(dir, `cleanup-${stamp}-imports`);
  let saved = 0;
  for (const name of objects) {
    const { data, error } = await storage.from("imports").download(name);
    if (error || !data) continue;
    const target = join(filesDir, name.replace(/[\\/:*?"<>|]/g, "_"));
    mkdirSync(filesDir, { recursive: true });
    writeFileSync(target, Buffer.from(await data.arrayBuffer()));
    saved++;
  }
  dump["importFiles"] = { listed: objects.length, saved, folder: saved ? filesDir : null };
  writeFileSync(file, JSON.stringify(dump, null, 1));
  const sha = createHash("sha256").update(JSON.stringify(dump)).digest("hex").slice(0, 12);
  return { file, files: saved, sha, objects };
}

function table(rows: Record<string, number | string>[]) {
  console.table(rows);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set in .env");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
  try {
    const problems = await safetyChecks(db);
    for (const p of problems) console.log(`STOP: ${p}`);
    if (problems.length && mode === "run") throw new Error("safety checks failed: nothing was changed");

    const before = await counts(db);
    const fpBefore = await fingerprint(db);
    const campaigns = await listCampaigns(db);

    // rehearsal: the real deletion inside a transaction that is rolled back (preview) or committed (run)
    let backupInfo: Awaited<ReturnType<typeof backup>> | null = null;
    if (mode === "backup" || mode === "run") {
      backupInfo = await backup(db, supabase.storage);
      console.log(`Backup written: ${backupInfo.file} (${backupInfo.files} import files saved next to it, checksum ${backupInfo.sha}). backups/ is not committed to git.`);
      if (mode === "backup") return;
    }

    await db.query("begin");
    let deleted: Record<string, number>;
    try {
      deleted = await deleteAll(db);
      if (mode === "preview") {
        await db.query("rollback");
      } else {
        await db.query("commit");
      }
    } catch (e) {
      await db.query("rollback").catch(() => undefined);
      throw new Error(`${(e as Error).message} (the transaction was rolled back: nothing was changed)`);
    }

    const rows = REPORT_TABLES.map((t) => ({ table: t, rows_now: before[t] ?? 0, will_delete: deleted[t] ?? 0, will_stay: (before[t] ?? 0) - (deleted[t] ?? 0) }));
    console.log(mode === "preview" ? "\nPREVIEW (nothing was deleted: the deletion ran inside a transaction and was rolled back)\n" : "\nDELETED\n");
    table(rows);
    console.log("campaigns:", campaigns.map((c) => `${c.name} [${c.source}${c.archived ? ", archived" : ""}]${keepCampaigns.includes(c.name) ? " KEPT" : " -> deleted"}`).join("; "));
    if (deleted["pgboss (queued jobs)"] !== undefined) console.log(`pg-boss queued test jobs: ${deleted["pgboss (queued jobs)"]}`);

    if (mode === "run") {
      // the uploaded files (the bucket "imports") are removed through the storage API, so the files themselves go, not just their records
      const names = backupInfo!.objects;
      let removed = 0;
      for (let i = 0; i < names.length; i += 50) {
        const { error } = await supabase.storage.from("imports").remove(names.slice(i, i + 50));
        if (error) console.log(`storage: could not remove some files: ${error.message}`);
        else removed += Math.min(50, names.length - i);
      }
      console.log(`storage bucket "imports": ${removed} of ${names.length} files removed`);

      const after = await counts(db);
      const fpAfter = await fingerprint(db);
      const left = (await db.query("select count(*)::int as n from storage.objects where bucket_id = 'imports'")).rows[0].n as number;
      const guardsOn = Number((await db.query(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and t.tgname in ('block_delete','block_mutation') and t.tgenabled = 'O'`)).rows[0].n);
      console.log("\nVERIFY");
      table([
        ...["lead_events", "campaign_leads", "contacts", "companies", "email_drafts", "evidence_items", "research_runs", "usage_records", "jobs", "import_batches", "pipeline_batches"].map((t) => ({ check: `${t} is empty`, result: after[t] === 0 ? "OK" : `NOT EMPTY (${after[t]})` })),
        { check: "campaigns left (kept ones only)", result: `${after.campaigns} (expected ${keepCampaigns.length})` },
        { check: "storage files left in imports", result: left === 0 ? "OK (0)" : `${left}` },
        ...CONFIG_TABLES.map((t) => ({ check: `${t} unchanged`, result: fpBefore.config[t] === fpAfter.config[t] ? "OK" : "CHANGED" })),
        { check: "connected mailbox unchanged (status, scopes, token)", result: JSON.stringify(fpBefore.mailbox) === JSON.stringify(fpAfter.mailbox) ? `OK ${fpAfter.mailbox.map((m) => `${m.email} ${m.status} token=${m.has_token}`).join(", ")}` : "CHANGED" },
        { check: "audit_log rows (existing rows are never removed)", result: `${before.audit_log} -> ${after.audit_log}` },
        { check: "guard triggers enabled again", result: `${guardsOn} enabled` },
      ]);
    } else {
      console.log("\nWHAT STAYS: settings, price table, spend caps, audit log, users and profiles, the connected Gmail mailbox (with its token), import templates, worker heartbeats, the schema and migrations.");
      console.log("Backup + real deletion: re-run with --run. To keep a campaign: --keep-campaign \"name\".");
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
