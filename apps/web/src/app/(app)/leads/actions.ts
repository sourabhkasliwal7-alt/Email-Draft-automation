"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { queueApolloFind } from "@/lib/adapter-tests";
import { guardAction, type ActionState } from "@/lib/auth";
import { validate } from "@/lib/forms";

const findSchema = z.object({ campaignId: z.string().uuid("Choose a campaign") });

/** "Find leads now": queues the free Apollo people search for one campaign. It uses no email credits; the worker adds the people it finds to the campaign. */
export async function findApolloLeads(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("import.use");
  if (!guard.ok) return guard.state;
  const v = validate(findSchema, formData);
  if (!v.ok) return v.state;
  const { data: campaign } = await guard.supabase.from("campaigns").select("id, icp").eq("id", v.data.campaignId).is("deleted_at", null).maybeSingle();
  if (!campaign) return { ok: false, message: "That campaign no longer exists." };
  const source = (campaign.icp as { leadSource?: string } | null)?.leadSource;
  if (source !== "apollo" && source !== "both") return { ok: false, message: "This campaign does not use Apollo. Change its lead source in Setup > Campaign first.", fieldErrors: { campaignId: "Choose a campaign that uses Apollo" } };
  const res = await queueApolloFind(campaign.id);
  revalidatePath("/leads");
  return { ok: res.ok, message: res.message };
}
