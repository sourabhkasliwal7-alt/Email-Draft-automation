"use server";

import { revalidatePath } from "next/cache";
import { suppressionSchema, suppressionToRow } from "@outreach/core";
import { guardAction, type ActionState } from "@/lib/auth";
import { dbErrorMessage, validate } from "@/lib/forms";
import { parseSuppressionCsv } from "@/lib/suppression-csv";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function addSuppression(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("suppression.add");
  if (!guard.ok) return guard.state;
  const v = validate(suppressionSchema, formData);
  if (!v.ok) return v.state;
  const { error } = await guard.supabase.from("suppression").insert(suppressionToRow(v.data));
  if (error) return { ok: false, message: error.code === "23505" ? "That entry is already on the list." : dbErrorMessage(error) };
  revalidatePath("/suppression");
  return { ok: true, message: "Added to the suppression list." };
}

export async function removeSuppression(formData: FormData): Promise<void> {
  const guard = await guardAction("suppression.remove");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await guard.supabase.from("suppression").delete().eq("id", id);
  revalidatePath("/suppression");
}

export async function uploadSuppressionCsv(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("suppression.add");
  if (!guard.ok) return guard.state;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file first.", fieldErrors: { file: "Choose a CSV file" } };
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: "That file is larger than 2 MB.", fieldErrors: { file: "File is larger than 2 MB" } };

  const scope = formData.get("scope") === "campaign" ? "campaign" : "global";
  const campaignId = String(formData.get("campaignId") ?? "");
  if (scope === "campaign" && !campaignId) return { ok: false, message: "Choose a campaign for a campaign-scoped upload.", fieldErrors: { campaignId: "Choose a campaign" } };

  const parsed = parseSuppressionCsv(await file.text());
  if (parsed.tooMany) return { ok: false, message: "That file has more than 20,000 rows. Split it and upload in parts." };
  if (!parsed.entries.length && !parsed.invalid.length) return { ok: false, message: "The file has no rows." };

  const rows = parsed.entries.map((e) => ({
    email_lower: e.email_lower,
    domain: e.domain,
    scope,
    campaign_id: scope === "campaign" ? campaignId : null,
    reason: e.reason ?? `CSV upload: ${file.name}`.slice(0, 300),
    source: "csv",
  }));

  let added = 0;
  let alreadyListed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await guard.supabase.from("suppression").insert(chunk);
    if (!error) {
      added += chunk.length;
      continue;
    }
    // A duplicate anywhere in the chunk fails the whole insert: retry row by row so the rest still land.
    for (const row of chunk) {
      const { error: rowError } = await guard.supabase.from("suppression").insert(row);
      if (!rowError) added++;
      else if (rowError.code === "23505") alreadyListed++;
      else return { ok: false, message: `Stopped after ${added} rows: ${dbErrorMessage(rowError)}` };
    }
  }

  revalidatePath("/suppression");
  const parts = [`Added ${added}`];
  if (alreadyListed) parts.push(`${alreadyListed} already on the list`);
  if (parsed.duplicatesInFile) parts.push(`${parsed.duplicatesInFile} duplicate rows in the file`);
  if (parsed.invalid.length) {
    const sample = parsed.invalid.slice(0, 3).map((i) => `row ${i.row} (${i.problem})`).join(", ");
    parts.push(`${parsed.invalid.length} invalid rows skipped, e.g. ${sample}`);
  }
  return { ok: true, message: parts.join(" · ") + "." };
}
