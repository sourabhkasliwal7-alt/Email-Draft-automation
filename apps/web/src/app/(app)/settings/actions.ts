"use server";

import { revalidatePath } from "next/cache";
import { WORKFLOW_SETTINGS_KEY, parseWorkflowConfig, priceSchema, settingsSchema, spendCapSchema, workflowFormSchema, workflowFormToConfig } from "@outreach/core";
import { guardAction, type ActionState } from "@/lib/auth";
import { dbErrorMessage, validate } from "@/lib/forms";
import { settingsToRows } from "@/lib/settings";

export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return guard.state;
  const v = validate(settingsSchema, formData, { booleans: ["crunchbaseEnabled", "replyTrackingEnabled", "sendingEnabled"] });
  if (!v.ok) return v.state;
  // the sending switch is not on this form (it is hidden in the app): keep whatever is stored
  const { data: flags } = await guard.supabase.from("settings").select("value").eq("key", "flags").maybeSingle();
  const keep = (flags?.value as { SENDING_ENABLED?: boolean } | null)?.SENDING_ENABLED === true;
  const { error } = await guard.supabase.from("settings").upsert(settingsToRows({ ...v.data, sendingEnabled: keep }), { onConflict: "key" });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Settings saved." };
}

/** Prices are append-only history: a new row takes effect now and older rows keep pricing older usage. */
export async function addPrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return guard.state;
  const v = validate(priceSchema, formData);
  if (!v.ok) return v.state;
  const { error } = await guard.supabase
    .from("price_table")
    .insert({ provider: v.data.provider, unit: v.data.unit, usd_per_unit: v.data.usdPerUnit });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/settings");
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
  revalidatePath("/settings");
  return { ok: true, message: "Spend cap added." };
}

export async function deleteSpendCap(formData: FormData): Promise<void> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await guard.supabase.from("spend_caps").delete().eq("id", id);
  revalidatePath("/settings");
}

export async function saveWorkflowSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("settings.manage");
  if (!guard.ok) return guard.state;
  const v = validate(workflowFormSchema, formData, { booleans: ["schedule_enabled", "dry_run", "allow_risky"] });
  if (!v.ok) return v.state;
  const { data: row } = await guard.supabase.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle();
  let config;
  try {
    config = workflowFormToConfig(v.data, parseWorkflowConfig(row?.value));
  } catch (e) {
    return { ok: false, message: `These settings are not valid: ${(e as Error).message}` };
  }
  const { error } = await guard.supabase.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: config }, { onConflict: "key" });
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Run settings saved." };
}
