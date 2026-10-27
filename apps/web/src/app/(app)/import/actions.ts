"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CANONICAL_FIELDS, ImportParseError, readTable, sha256Hex, validateMapping, type CanonicalField, type Mapping } from "@outreach/importer";
import { guardAction, type ActionState } from "@/lib/auth";
import { dbErrorMessage, validate } from "@/lib/forms";
import { createServiceDb } from "@/lib/supabase/service";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /\.(csv|tsv|txt|xlsx|xlsm)$/i;

const uploadSchema = z.object({ campaignId: z.string().uuid("Choose a campaign") });

export async function createImport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("import.use");
  if (!guard.ok) return guard.state;
  const v = validate(uploadSchema, formData);
  if (!v.ok) return v.state;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file to upload.", fieldErrors: { file: "Choose a CSV or Excel file" } };
  if (!ALLOWED.test(file.name)) {
    const old = /\.xls$/i.test(file.name);
    return { ok: false, message: old ? "Old .xls files are not supported. Save as .xlsx or CSV." : "Upload a .csv, .tsv, .txt or .xlsx file.", fieldErrors: { file: old ? "Save as .xlsx or CSV first" : "Unsupported file type" } };
  }
  if (file.size > MAX_BYTES) return { ok: false, message: "That file is larger than 25 MB.", fieldErrors: { file: "File is larger than 25 MB" } };

  const { data: campaign } = await guard.supabase.from("campaigns").select("id").eq("id", v.data.campaignId).is("deleted_at", null).maybeSingle();
  if (!campaign) return { ok: false, message: "That campaign no longer exists.", fieldErrors: { campaignId: "Choose a campaign" } };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = sha256Hex(bytes);
  const { data: batch, error } = await guard.supabase
    .from("import_batches")
    .insert({ file_name: file.name.slice(0, 200), file_hash: hash, file_size: file.size, campaign_id: campaign.id, user_id: guard.user.id, status: "uploaded", mapping: {} })
    .select("id")
    .single();
  if (error) return { ok: false, message: dbErrorMessage(error) };

  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100);
  const path = `${batch.id}/${safeName}`;
  const service = createServiceDb();
  const up = await service.storage.from("imports").upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) {
    await guard.supabase.from("import_batches").update({ status: "failed", error: `Upload failed: ${up.error.message}` }).eq("id", batch.id);
    return { ok: false, message: `The file could not be stored: ${up.error.message}` };
  }
  const { error: pathError } = await guard.supabase.from("import_batches").update({ storage_path: path }).eq("id", batch.id);
  if (pathError) return { ok: false, message: dbErrorMessage(pathError) };

  revalidatePath("/leads");
  redirect(`/import/${batch.id}`);
}

const startSchema = z.object({
  batchId: z.string().uuid(),
  sheet: z.string().default(""),
  header: z.enum(["auto", "yes", "no"]).default("auto"),
  mode: z.enum(["add_new", "update_existing", "skip_duplicates"]),
  templateName: z.string().trim().max(80).default(""),
});

export async function startImport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("import.use");
  if (!guard.ok) return guard.state;
  const v = validate(startSchema, formData, { booleans: ["dryRun"] });
  if (!v.ok) return v.state;
  const dryRun = formData.has("dryRun");

  const { data: batch } = await guard.supabase.from("import_batches").select("*").eq("id", v.data.batchId).maybeSingle();
  if (!batch || !batch.storage_path || !batch.campaign_id) return { ok: false, message: "That import was not found." };
  if (batch.status === "mapped" || batch.status === "importing") return { ok: false, message: "This import is already running." };
  if (batch.status === "completed" && !batch.dry_run) return { ok: false, message: "This file was already imported. Upload it again to import it again." };

  const { data: campaign } = await guard.supabase.from("campaigns").select("icp").eq("id", batch.campaign_id).single();
  const requireEmail = (campaign?.icp as { requireEmail?: boolean } | null)?.requireEmail !== false;

  const fields: Mapping["fields"] = {};
  for (const f of CANONICAL_FIELDS) {
    const header = String(formData.get(`map_${f.key}`) ?? "");
    if (header) fields[f.key as CanonicalField] = header;
  }
  const firstRowIsHeader = v.data.header === "auto" ? undefined : v.data.header === "yes";
  const mapping: Mapping = { fields, ...(firstRowIsHeader === undefined ? {} : { firstRowIsHeader }) };

  // Validate against the real file so a stale or edited mapping cannot start a doomed job.
  const service = createServiceDb();
  const dl = await service.storage.from("imports").download(batch.storage_path);
  if (dl.error || !dl.data) return { ok: false, message: "The uploaded file could not be read from storage." };
  let headers: string[];
  try {
    const table = await readTable({ name: batch.file_name, bytes: new Uint8Array(await dl.data.arrayBuffer()) }, { sheet: v.data.sheet || undefined, firstRowIsHeader });
    headers = table.headers;
  } catch (e) {
    return { ok: false, message: e instanceof ImportParseError ? e.message : "The file could not be parsed." };
  }
  const problems = validateMapping(mapping, headers, { requireEmail });
  if (problems.length) return { ok: false, message: problems.join(" "), fieldErrors: { mapping: problems.join(" ") } };

  if (v.data.templateName) {
    // Names are unique case-insensitively (index on lower(name)): saving under an existing name replaces that template.
    const { data: existing } = await guard.supabase.from("import_templates").select("id").ilike("name", v.data.templateName.replace(/[%_\\]/g, (m) => `\\${m}`)).maybeSingle();
    const { error } = existing
      ? await guard.supabase.from("import_templates").update({ mapping: { fields } as never }).eq("id", existing.id)
      : await guard.supabase.from("import_templates").insert({ name: v.data.templateName, mapping: { fields } as never, created_by: guard.user.id });
    if (error) return { ok: false, message: dbErrorMessage(error), fieldErrors: { templateName: "Could not save the template" } };
  }

  const runs = batch.runs + 1;
  const { error: updateError } = await guard.supabase
    .from("import_batches")
    .update({ mapping: mapping as never, mode: v.data.mode, dry_run: dryRun, sheet: v.data.sheet || null, status: "mapped", runs, totals: {}, error: null })
    .eq("id", batch.id);
  if (updateError) return { ok: false, message: dbErrorMessage(updateError) };

  const { error: jobError } = await guard.supabase.from("jobs").insert({
    type: "import.run",
    idempotency_key: `import:${batch.id}:${runs}`,
    payload: { batchId: batch.id, run: runs },
    campaign_id: batch.campaign_id,
  });
  if (jobError) return { ok: false, message: dbErrorMessage(jobError) };

  revalidatePath("/leads");
  redirect(`/import/${batch.id}`);
}

export async function deleteTemplate(formData: FormData): Promise<void> {
  const guard = await guardAction("import.use");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await guard.supabase.from("import_templates").delete().eq("id", id);
  revalidatePath("/leads");
}

/** Lets the user abandon a batch that is stuck waiting for a worker. */
export async function cancelImport(formData: FormData): Promise<void> {
  const guard = await guardAction("import.use");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await guard.supabase.from("import_batches").update({ status: "cancelled" }).eq("id", id).in("status", ["uploaded", "mapped"]);
  await guard.supabase.from("jobs").update({ status: "cancelled" }).like("idempotency_key", `import:${id}:%`).eq("status", "pending");
  revalidatePath(`/import/${id}`);
}
