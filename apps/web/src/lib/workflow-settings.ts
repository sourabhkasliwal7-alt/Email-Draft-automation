import { WORKFLOW_SETTINGS_KEY, parseWorkflowConfig, type WorkflowConfig } from "@outreach/core";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The workflow settings live in one `settings` row (key "workflow"); anything not saved yet falls back to the defaults. */
export async function loadWorkflowSettings(supabase: Client): Promise<WorkflowConfig> {
  const { data } = await supabase.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle();
  return parseWorkflowConfig(data?.value);
}
