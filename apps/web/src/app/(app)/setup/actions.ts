"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { WORKFLOW_SETTINGS_KEY, mergeWorkflowConfig, parseWorkflowConfig, priceSchema, spendCapSchema, type WorkflowConfig } from "@outreach/core";
import { queueAdapterTest, type TestProvider } from "@/lib/adapter-tests";
import { guardAction, type ActionState } from "@/lib/auth";
import { DEMO_CAMPAIGN_ID, DEMO_CAMPAIGN_NAME, DEMO_CASE_STUDY_IDS, DEMO_INBOX_EMAIL, DEMO_INBOX_ID, DEMO_OFFER_IDS } from "@/lib/demo-data";
import { dbErrorMessage, validate } from "@/lib/forms";
import {
  creditsFormSchema,
  creditsToPatch,
  footerFormSchema,
  footerToPatch,
  modelsFormSchema,
  modelsToPatch,
  runRulesFormSchema,
  runRulesToPatch,
  scheduleFormSchema,
  scheduleToPatch,
  webExcludeFormSchema,
  webExcludeToPatch,
  writingRulesFormSchema,
  writingRulesToPatch,
} from "./schemas";

type Guard = Extract<Awaited<ReturnType<typeof guardAction>>, { ok: true }>;

/** Saves only the keys of one Setup section on top of what is already saved. */
async function saveSection(guard: Guard, patch: (existing: WorkflowConfig) => Partial<WorkflowConfig>, message: string): Promise<ActionState> {
  const { data: row } = await guard.supabase.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle();
  let config: WorkflowConfig;
  try {
    const existing = parseWorkflowConfig(row?.value);
    config = mergeWorkflowConfig(existing, patch(existing));
  } catch (e) {
    return { ok: false, message: `These settings are not valid: ${(e as Error).message}` };
  }
  const { error } = await guard.supabase.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: config }, { onConflict: "key" });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/setup");
  revalidatePath("/");
  return { ok: true, message };
}

async function section<S extends z.ZodType>(
  formData: FormData,
  schema: S,
  booleans: string[],
  toPatch: (v: z.infer<S>, existing: WorkflowConfig) => Partial<WorkflowConfig>,
  message: string,
): Promise<ActionState> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return guard.state;
  const v = validate(schema as z.ZodType<z.infer<S>>, formData, { booleans });
  if (!v.ok) return v.state;
  return saveSection(guard, (existing) => toPatch(v.data, existing), message);
}

export const saveFooter = async (_p: ActionState, fd: FormData) => section(fd, footerFormSchema, [], (v) => footerToPatch(v), "Footer saved.");
export const saveSchedule = async (_p: ActionState, fd: FormData) => section(fd, scheduleFormSchema, ["schedule_enabled"], (v) => scheduleToPatch(v), "Schedule saved.");
export const saveModels = async (_p: ActionState, fd: FormData) => section(fd, modelsFormSchema, [], (v) => modelsToPatch(v), "Models saved.");
export const saveCredits = async (_p: ActionState, fd: FormData) => section(fd, creditsFormSchema, [], (v) => creditsToPatch(v), "Credit limits saved.");
export const saveRunRules = async (_p: ActionState, fd: FormData) =>
  section(fd, runRulesFormSchema, ["dry_run", "allow_risky", "skip_verification"], (v) => runRulesToPatch(v), "Run rules saved.");
export const saveWebExclude = async (_p: ActionState, fd: FormData) => section(fd, webExcludeFormSchema, [], (v) => webExcludeToPatch(v), "Saved. Web discovery never uses these websites as leads.");
export const saveWritingRules = async (_p: ActionState, fd: FormData) => section(fd, writingRulesFormSchema, [], (v, existing) => writingRulesToPatch(v, existing), "Writing rules saved.");

/** Prices are append-only history: a new row takes effect now and older rows keep pricing older usage. */
export async function addPrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return guard.state;
  const v = validate(priceSchema, formData);
  if (!v.ok) return v.state;
  const { error } = await guard.supabase.from("price_table").insert({ provider: v.data.provider, unit: v.data.unit, usd_per_unit: v.data.usdPerUnit });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/setup");
  return { ok: true, message: "Price added." };
}

export async function addSpendCap(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return guard.state;
  const v = validate(spendCapSchema, formData);
  if (!v.ok) return v.state;
  const { error } = await guard.supabase.from("spend_caps").insert({
    scope: v.data.scope,
    period: v.data.period,
    cap_usd: v.data.capUsd,
    provider: v.data.scope === "provider" ? v.data.provider : null,
    campaign_id: v.data.scope === "campaign" ? v.data.campaignId : null,
  });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/setup");
  return { ok: true, message: "Spend cap added." };
}

export async function deleteSpendCap(formData: FormData): Promise<void> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await guard.supabase.from("spend_caps").delete().eq("id", id);
  revalidatePath("/setup");
}

const TEST_PROVIDERS: TestProvider[] = ["anthropic", "serper", "verifier", "apollo"];

/** "Test connection": queues one tiny live check for the worker (priced, cap-checked, usage recorded). It never changes an ADAPTER_* mode. */
export async function testConnection(formData: FormData): Promise<void> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return;
  const provider = String(formData.get("provider") ?? "") as TestProvider;
  if (TEST_PROVIDERS.includes(provider)) await queueAdapterTest(provider);
  revalidatePath("/setup");
}

/**
 * "Archive demo data": hides the sample records that come with a fresh database (the demo mailbox, the "Demo campaign", the two demo offers and
 * their case studies). It is a soft delete (deleted_at is set, nothing is removed) and touches nothing else. Needs the same
 * permissions as archiving each of those by hand.
 */
export async function archiveDemoData(): Promise<void> {
  const offers = await guardAction("offer.manage");
  const campaigns = await guardAction("campaign.manage");
  const inboxes = await guardAction("inbox.manage");
  if (!offers.ok || !campaigns.ok || !inboxes.ok) redirect("/setup?tab=offers&notice=demo_forbidden");
  const now = new Date().toISOString();
  const failed = [
    // the campaign first: it points at the mailbox and the offer
    (await campaigns.supabase.from("campaigns").update({ deleted_at: now, status: "archived" }).or(`id.eq.${DEMO_CAMPAIGN_ID},name.eq."${DEMO_CAMPAIGN_NAME}"`).is("deleted_at", null)).error,
    (await inboxes.supabase.from("inboxes").update({ deleted_at: now }).or(`id.eq.${DEMO_INBOX_ID},email_lower.eq."${DEMO_INBOX_EMAIL}"`).is("deleted_at", null)).error,
    (await offers.supabase.from("case_studies").update({ deleted_at: now }).in("id", [...DEMO_CASE_STUDY_IDS]).is("deleted_at", null)).error,
    (await offers.supabase.from("offers").update({ deleted_at: now }).in("id", [...DEMO_OFFER_IDS]).is("deleted_at", null)).error,
  ].filter(Boolean);
  revalidatePath("/setup");
  redirect(`/setup?tab=offers&notice=${failed.length ? "demo_failed" : "demo_archived"}`);
}
