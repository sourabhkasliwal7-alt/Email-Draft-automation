import { icpSchema, leadsToFind, sourcesOf } from "@outreach/core";
import type { JobInfo, WorkerCtx } from "../ctx";
import { must } from "../pipeline/common";
import { loadWorkflowConfig } from "../pipeline/run-common";
import { researchIsLive } from "../pipeline/stages";
import { pullFromApollo, type PullResult } from "./apollo-pull";

export interface ApolloFindPayload {
  campaignId: string;
}
export interface ApolloFindResult extends PullResult {
  /** true when the made-up demo people of the mock adapter were used */
  demo: boolean;
}

/**
 * "Find leads with Apollo": runs only the people search for one campaign (the same search a run does) and adds the people to the
 * campaign's leads. It reveals nothing and writes nothing; the next run checks, researches and approves them.
 */
export async function apolloFindJob(ctx: WorkerCtx, payload: ApolloFindPayload, job: JobInfo): Promise<ApolloFindResult> {
  const campaign = must(await ctx.db.from("campaigns").select("*").eq("id", payload.campaignId).is("deleted_at", null).single(), "load campaign");
  const icp = icpSchema.parse(campaign.icp ?? {});
  const demo = ctx.modes.apollo !== "live";
  const none = (note: string): ApolloFindResult => ({ found: 0, imported: 0, duplicate: 0, suppressed: 0, invalid: 0, note, demo });
  if (!sourcesOf(icp).includes("apollo")) return none("This campaign does not use Apollo search. Tick Apollo search in the campaign on the Setup page.");
  // made-up people must never reach a real run (real pages, real model): they have invented websites and addresses
  if (demo && researchIsLive(ctx)) return none("Apollo is in demo mode (no key yet): nothing was searched. Add APOLLO_API_KEY and set ADAPTER_APOLLO=live in .env, then restart.");
  const cfg = await loadWorkflowConfig(ctx.db);
  const pull = await pullFromApollo(ctx, campaign, { id: job.jobId, started_by: null }, job, leadsToFind(campaign.daily_cap, cfg.approval_rate), cfg);
  return { ...pull, demo };
}
