import { can } from "@outreach/core";
import { getSession } from "@/lib/auth";
import { loadRunReportLeads, reportResponse } from "@/lib/run-report";
import { createClient } from "@/lib/supabase/server";

/** The run report: one row per lead of the run (skipped leads included), as a CSV that opens correctly in Excel. Any run, old or test. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.state !== "ok") return new Response("Sign in required", { status: 401 });
  if (!can(session.user.role, "run.view")) return new Response("Not allowed", { status: 403 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  return reportResponse(id, await loadRunReportLeads(supabase, id));
}
