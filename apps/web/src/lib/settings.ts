import { DEFAULT_SETTINGS, type SettingsInput } from "@outreach/core";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Stored as three rows in `settings` so the worker can read them with the same keys. */
export const SETTING_KEYS = { models: "models", researchDepth: "research_depth_default", flags: "flags" } as const;

type Models = { extraction?: string; claim_check?: string; drafting?: string };
type Flags = { CRUNCHBASE_ENABLED?: boolean; REPLY_TRACKING_ENABLED?: boolean; SENDING_ENABLED?: boolean };

/** Reads saved settings merged over the defaults (SENDING_ENABLED is false until an admin turns it on). */
export async function loadSettings(supabase: Client): Promise<SettingsInput> {
  const { data } = await supabase.from("settings").select("key, value").in("key", Object.values(SETTING_KEYS));
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const models = (byKey.get(SETTING_KEYS.models) ?? {}) as Models;
  const flags = (byKey.get(SETTING_KEYS.flags) ?? {}) as Flags;
  const depth = byKey.get(SETTING_KEYS.researchDepth);
  return {
    modelExtraction: models.extraction ?? DEFAULT_SETTINGS.modelExtraction,
    modelClaimCheck: models.claim_check ?? DEFAULT_SETTINGS.modelClaimCheck,
    modelDrafting: models.drafting ?? DEFAULT_SETTINGS.modelDrafting,
    researchDepth: depth === "light" || depth === "standard" || depth === "deep" ? depth : DEFAULT_SETTINGS.researchDepth,
    crunchbaseEnabled: flags.CRUNCHBASE_ENABLED ?? DEFAULT_SETTINGS.crunchbaseEnabled,
    replyTrackingEnabled: flags.REPLY_TRACKING_ENABLED ?? DEFAULT_SETTINGS.replyTrackingEnabled,
    sendingEnabled: flags.SENDING_ENABLED ?? DEFAULT_SETTINGS.sendingEnabled,
  };
}

export function settingsToRows(s: SettingsInput) {
  return [
    { key: SETTING_KEYS.models, value: { extraction: s.modelExtraction, claim_check: s.modelClaimCheck, drafting: s.modelDrafting } },
    { key: SETTING_KEYS.researchDepth, value: s.researchDepth },
    {
      key: SETTING_KEYS.flags,
      value: { CRUNCHBASE_ENABLED: s.crunchbaseEnabled, REPLY_TRACKING_ENABLED: s.replyTrackingEnabled, SENDING_ENABLED: s.sendingEnabled },
    },
  ];
}
