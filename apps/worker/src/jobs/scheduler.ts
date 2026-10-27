import { istDayStartIso, shouldStartScheduledRun } from "@outreach/core";
import { startRun } from "@outreach/db";
import type { WorkerCtx } from "../ctx";
import { must } from "../pipeline/common";
import { loadWorkflowConfig } from "../pipeline/run-common";

/** Called once a minute: starts the daily run on weekdays at the configured IST time, skipping holidays. */
export async function scheduleTick(ctx: WorkerCtx, now = new Date()): Promise<string[]> {
  const cfg = await loadWorkflowConfig(ctx.db);
  const { count } = await ctx.db.from("pipeline_batches").select("id", { count: "exact", head: true }).gte("started_at", istDayStartIso(now));
  if (!shouldStartScheduledRun(now, cfg, (count ?? 0) > 0)) return [];
  const campaigns = must(await ctx.db.from("campaigns").select("id, name").eq("status", "active").is("deleted_at", null).order("created_at"), "load active campaigns");
  const started: string[] = [];
  for (const c of campaigns) {
    try {
      started.push(await startRun(ctx.db, c.id, { startedBy: null, label: "scheduled" }));
    } catch (e) {
      ctx.log(`schedule: could not start ${c.name}: ${(e as Error).message}`);
    }
  }
  return started;
}
