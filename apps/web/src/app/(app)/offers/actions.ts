"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { caseStudySchema, offerSchema, parseAllowedNumbers, splitLines, splitList } from "@outreach/core";
import { guardAction, type ActionState } from "@/lib/auth";
import { dbErrorMessage, validate } from "@/lib/forms";

export async function saveOffer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("offer.manage");
  if (!guard.ok) return guard.state;
  const v = validate(offerSchema, formData);
  if (!v.ok) return v.state;
  const row = {
    name: v.data.name,
    description: v.data.description,
    allowed_claims: splitLines(v.data.allowedClaims),
    cta_options: splitLines(v.data.ctaOptions),
  };
  const id = String(formData.get("id") ?? "");
  if (id) {
    const { error } = await guard.supabase.from("offers").update(row).eq("id", id).is("deleted_at", null);
    if (error) return { ok: false, message: dbErrorMessage(error) };
    revalidatePath("/offers");
    return { ok: true, message: "Offer saved." };
  }
  const { data, error } = await guard.supabase.from("offers").insert(row).select("id").single();
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/offers");
  redirect(`/offers/${data.id}`);
}

export async function archiveOffer(formData: FormData): Promise<void> {
  const guard = await guardAction("offer.manage");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await guard.supabase.from("offers").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/offers");
}

export async function saveCaseStudy(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("offer.manage");
  if (!guard.ok) return guard.state;
  const v = validate(caseStudySchema, formData);
  if (!v.ok) return v.state;
  const nums = parseAllowedNumbers(v.data.allowedNumbers);
  if (nums.error) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { allowedNumbers: nums.error } };
  const row = {
    offer_id: v.data.offerId || null,
    title: v.data.title,
    summary: v.data.summary,
    industries: splitList(v.data.industries),
    allowed_numbers: nums.value,
  };
  const id = String(formData.get("id") ?? "");
  const { error } = id
    ? await guard.supabase.from("case_studies").update(row).eq("id", id).is("deleted_at", null)
    : await guard.supabase.from("case_studies").insert(row);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/offers");
  redirect(`/offers/${row.offer_id ?? ""}`);
}

export async function archiveCaseStudy(formData: FormData): Promise<void> {
  const guard = await guardAction("offer.manage");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await guard.supabase.from("case_studies").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/offers");
}
