import { join } from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { createAdapters } from "@outreach/adapters";
import { createServiceClient, type DbClient } from "@outreach/db";
import type { WorkerCtx } from "../../src/ctx";

config({ path: join(__dirname, "../../../../.env") });

export const hasIntegrationDb = () =>
  /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

export function serviceDb(): DbClient {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

/** Everything one test run creates carries this tag so cleanup can find it and nothing else. */
export function newTag() {
  return `itest${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Removes the rows created by one test run. Everything is found through campaigns whose name contains `tag` (plus a few
 * directly tagged rows). Contacts/companies are removed only when nothing outside the tagged campaigns uses them, so
 * shared mock-Apollo people that a person created in the UI are never touched.
 * Guard triggers forbid deletes through the app, so this uses a direct connection with triggers disabled for ONE
 * transaction.
 */
export async function cleanup(tag: string, storagePaths: string[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    const like = `%${tag}%`;
    const q = (sql: string) => client.query(sql, [like]);
    await q(`create temp table _c on commit drop as select id from public.campaigns where name like $1`);
    await q(`create temp table _l on commit drop as select id, contact_id from public.campaign_leads where campaign_id in (select id from _c)`);
    await q(`create temp table _d on commit drop as select id from public.email_drafts where campaign_lead_id in (select id from _l)`);
    await q(`create temp table _k on commit drop as
      select distinct l.contact_id as id from _l l
      where not exists (select 1 from public.campaign_leads o where o.contact_id = l.contact_id and o.campaign_id not in (select id from _c))`);
    await q(`create temp table _co on commit drop as select distinct company_id as id from public.contacts where id in (select id from _k) and company_id is not null`);
    await q(`create temp table _j on commit drop as select id from public.jobs where campaign_id in (select id from _c) or idempotency_key like $1`);

    await q(`delete from public.replies where send_id in (select id from public.email_sends where draft_id in (select id from _d))`);
    await q(`delete from public.email_sends where draft_id in (select id from _d)`);
    await q(`delete from public.send_approvals where draft_id in (select id from _d)`);
    await q(`delete from public.email_drafts where id in (select id from _d)`);
    await q(`delete from public.followups where campaign_lead_id in (select id from _l)`);
    await q(`delete from public.lead_events where campaign_lead_id in (select id from _l) or contact_id in (select id from _k)`);
    await q(`delete from public.job_steps where job_id in (select id from _j)`);
    await q(`delete from public.usage_records where campaign_id in (select id from _c) or job_id in (select id from _j)`);
    await q(`delete from public.jobs where id in (select id from _j)`);
    await q(`delete from public.research_runs where campaign_lead_id in (select id from _l) or company_id in (select id from _co)`);
    await q(`delete from public.import_rows where batch_id in (select id from public.import_batches where campaign_id in (select id from _c))`);
    await q(`delete from public.import_batches where campaign_id in (select id from _c)`);
    await q(`delete from public.pipeline_batches where campaign_id in (select id from _c)`);
    await q(`delete from public.campaign_leads where campaign_id in (select id from _c)`);
    await q(`delete from public.enrichment_results where contact_id in (select id from _k)`);
    await q(`delete from public.contacts where id in (select id from _k) or email_lower like $1 or company_name like $1 or full_name like $1 or last_name like $1`);
    await q(`delete from public.signals where company_id in (select id from _co) or company_id in (select id from public.companies where domain like $1)`);
    await q(`delete from public.evidence_items where company_id in (select id from _co) or company_id in (select id from public.companies where domain like $1)`);
    await q(`delete from public.companies where (id in (select id from _co) and not exists (select 1 from public.contacts x where x.company_id = companies.id)) or domain like $1`);
    await q(`delete from public.suppression where reason like $1`);
    await q(`delete from public.spend_caps where campaign_id in (select id from _c)`);
    await q(`delete from public.price_table where unit like $1`);
    await q(`delete from public.campaigns where id in (select id from _c)`);
    await q(`delete from public.case_studies where title like $1`);
    await q(`delete from public.offers where name like $1`);
    await q(`delete from public.inboxes where email like $1`);
    await q(`delete from public.audit_log where payload::text like $1`);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  if (storagePaths.length) await serviceDb().storage.from("imports").remove(storagePaths);
}

/** A worker context with mock adapters (never live) and the real database. */
export function makeCtx(workerId = "itest-worker", log: (m: string) => void = () => {}): WorkerCtx & { pool: pg.Pool } {
  const adapters = createAdapters({});
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
  return { db: serviceDb(), pg: pool, pool, adapters, modes: adapters.modes, log, workerId };
}
