import { join } from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { createServiceClient, type DbClient } from "@outreach/db";

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
 * Removes every row tagged with `tag`. Contacts, leads, campaigns and history cannot be deleted through the app
 * (guard triggers), so cleanup uses a direct connection with triggers disabled for this one transaction.
 */
export async function cleanup(tag: string, storagePaths: string[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    const like = `%${tag}%`;
    const campaigns = `(select id from public.campaigns where name like $1)`;
    await client.query(`delete from public.lead_events where campaign_lead_id in (select id from public.campaign_leads where campaign_id in ${campaigns})`, [like]);
    await client.query(`delete from public.import_rows where batch_id in (select id from public.import_batches where campaign_id in ${campaigns})`, [like]);
    await client.query(`delete from public.import_batches where campaign_id in ${campaigns}`, [like]);
    await client.query(`delete from public.campaign_leads where campaign_id in ${campaigns}`, [like]);
    await client.query(`delete from public.contacts where email_lower like $1 or company_name like $1 or full_name like $1`, [like]);
    await client.query(`delete from public.companies where domain like $1`, [like]);
    await client.query(`delete from public.suppression where reason like $1`, [like]);
    await client.query(`delete from public.jobs where idempotency_key like $1`, [like]);
    await client.query(`delete from public.campaigns where name like $1`, [like]);
    await client.query(`delete from public.audit_log where payload::text like $1`, [like]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  if (storagePaths.length) await serviceDb().storage.from("imports").remove(storagePaths);
}
