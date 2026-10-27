import pg from "pg";
import { adminClient } from "./support";

/**
 * Removes everything the import e2e created (tag "e2eimp"). Contacts, leads and campaigns cannot be deleted through
 * the app by design (guard triggers), so this uses a direct connection with triggers disabled for one transaction,
 * and only touches rows whose names/emails/domains carry the tag.
 */
export async function cleanupImportData() {
  if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
    console.warn("[e2e] DATABASE_URL is not set: import test data (tag e2eimp) was NOT removed.");
    return;
  }
  const admin = adminClient();
  const { data: batches } = await admin.from("import_batches").select("storage_path, campaign_id, campaigns!inner(name)").like("campaigns.name", "%e2eimp%");
  const paths = (batches ?? []).map((b) => b.storage_path).filter((p): p is string => Boolean(p));

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    const like = "%e2eimp%";
    const campaigns = `(select id from public.campaigns where name like $1)`;
    await client.query(`delete from public.lead_events where campaign_lead_id in (select id from public.campaign_leads where campaign_id in ${campaigns})`, [like]);
    await client.query(`delete from public.import_rows where batch_id in (select id from public.import_batches where campaign_id in ${campaigns})`, [like]);
    await client.query(`delete from public.jobs where payload->>'batchId' in (select id::text from public.import_batches where campaign_id in ${campaigns})`, [like]);
    await client.query(`delete from public.import_batches where campaign_id in ${campaigns}`, [like]);
    await client.query(`delete from public.campaign_leads where campaign_id in ${campaigns}`, [like]);
    await client.query(`delete from public.contacts where email_lower like $1 or company_name like $1 or full_name like $1 or last_name like $1`, [like]);
    await client.query(`delete from public.companies where domain like $1`, [like]);
    await client.query(`delete from public.import_templates where name like $1`, [like]);
    await client.query(`delete from public.campaigns where name like $1`, [like]);
    await client.query(`delete from public.audit_log where payload::text like $1`, [like]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  if (paths.length) await admin.storage.from("imports").remove(paths);
}

/**
 * Removes what simple.spec.ts seeds (tag "e2esimple"): campaigns, leads, runs, drafts, jobs, mailboxes and people.
 * Same technique as above: a direct connection with triggers off for one transaction, only rows that carry the tag.
 */
export async function cleanupSimpleData() {
  if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
    console.warn("[e2e] DATABASE_URL is not set: simple-flow test data (tag e2esimple) was NOT removed.");
    return;
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    const like = "%e2esimple%";
    const campaigns = `(select id from public.campaigns where name like $1)`;
    const leads = `(select id from public.campaign_leads where campaign_id in ${campaigns})`;
    await client.query(`delete from public.email_drafts where campaign_lead_id in ${leads}`, [like]);
    await client.query(`delete from public.lead_events where campaign_lead_id in ${leads}`, [like]);
    await client.query(`delete from public.jobs where campaign_id in ${campaigns} or idempotency_key like $1`, [like]);
    await client.query(`delete from public.pipeline_batches where campaign_id in ${campaigns}`, [like]);
    await client.query(`delete from public.campaign_leads where campaign_id in ${campaigns}`, [like]);
    await client.query(`delete from public.contacts where email_lower like $1 or company_name like $1 or full_name like $1 or last_name like $1`, [like]);
    await client.query(`delete from public.companies where domain like $1 or name like $1`, [like]);
    await client.query(`delete from public.campaigns where name like $1`, [like]);
    await client.query(`delete from public.inboxes where email like $1`, [like]);
    await client.query(`delete from public.audit_log where payload::text like $1`, [like]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}
