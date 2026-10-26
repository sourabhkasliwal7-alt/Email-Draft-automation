import { buildErrorCsv, type ErrorRow } from "@outreach/importer";
import { can } from "@outreach/core";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** CSV of every row that was not imported, with the reason, safe to open in a spreadsheet. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.state !== "ok") return new Response("Sign in required", { status: 401 });
  if (!can(session.user.role, "import.use")) return new Response("Not allowed", { status: 403 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: batch } = await supabase.from("import_batches").select("id, file_name, totals").eq("id", id).maybeSingle();
  if (!batch) return new Response("Not found", { status: 404 });

  const rows: ErrorRow[] = [];
  // jsonb does not keep key order, so the file's column order is stored on the batch by the worker.
  const headers: string[] = [...(((batch.totals ?? {}) as { headers?: string[] }).headers ?? [])];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("import_rows")
      .select("row_number, status, errors, original")
      .eq("batch_id", id)
      .in("status", ["invalid", "duplicate", "suppressed", "skipped", "failed"])
      .order("row_number")
      .range(from, from + 999);
    if (error) return new Response(error.message, { status: 500 });
    for (const r of data) {
      const original = r.original as Record<string, string>;
      for (const h of Object.keys(original)) if (!headers.includes(h)) headers.push(h);
      rows.push({ row_number: r.row_number, status: r.status, errors: (r.errors ?? []).filter((e: string) => !e.startsWith("Note:")), original });
    }
    if (data.length < 1000) break;
  }

  const name = `${batch.file_name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "_")}-not-imported.csv`;
  return new Response(buildErrorCsv(rows, headers), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
