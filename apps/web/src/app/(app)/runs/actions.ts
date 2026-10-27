"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cancelRun, resumeRun, startRun } from "@outreach/db";
import { guardAction, type ActionState } from "@/lib/auth";
import { validate } from "@/lib/forms";
import { createServiceDb } from "@/lib/supabase/service";

const startSchema = z.object({ campaignId: z.string().uuid("Choose a campaign"), dryRun: z.boolean().default(false) });

/** "Start": queues one run for the campaign. The worker does the work; nothing is sent, only Gmail drafts are created. */
export async function startRunAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("workflow.start");
  if (!guard.ok) return guard.state;
  const v = validate(startSchema, formData, { booleans: ["dryRun"] });
  if (!v.ok) return v.state;
  const { data: campaign } = await guard.supabase.from("campaigns").select("id, name").eq("id", v.data.campaignId).is("deleted_at", null).maybeSingle();
  if (!campaign) return { ok: false, message: "That campaign no longer exists." };
  const db = createServiceDb();
  const { data: active } = await db.from("pipeline_batches").select("id, status").eq("campaign_id", campaign.id).in("status", ["running", "paused"]).maybeSingle();
  if (active) return { ok: false, message: active.status === "paused" ? "This campaign has a paused run. Resume or cancel it first." : "This campaign already has a run in progress." };
  try {
    await startRun(db, campaign.id, { startedBy: guard.user.id, dryRun: v.data.dryRun, label: v.data.dryRun ? "manual (dry run)" : "manual" });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  revalidatePath("/runs");
  return { ok: true, message: `${v.data.dryRun ? "Dry run" : "Run"} started for ${campaign.name}. The worker picks it up within a few seconds.` };
}

export async function resumeRunAction(formData: FormData): Promise<void> {
  const guard = await guardAction("workflow.start");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await resumeRun(createServiceDb(), id);
  revalidatePath("/runs");
  revalidatePath(`/runs/${id}`);
}

export async function cancelRunAction(formData: FormData): Promise<void> {
  const guard = await guardAction("workflow.start");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await cancelRun(createServiceDb(), id);
  revalidatePath("/runs");
  revalidatePath(`/runs/${id}`);
}
