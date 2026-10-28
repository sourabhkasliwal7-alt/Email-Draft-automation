import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@outreach/db";
import { WORKFLOW_SETTINGS_KEY, parseWorkflowConfig } from "@outreach/core";
import { loadLead } from "../src/pipeline/common";
import type { Fact } from "../src/pipeline/stages";
import { chooseOffer, writeEmail } from "../src/pipeline/write";
import { cleanup, hasIntegrationDb, makeCtx, newTag } from "./helpers/itest";

const enabled = hasIntegrationDb();
if (!enabled) console.warn("[worker tests] DATABASE_URL / Supabase keys missing: the multi-offer integration tests are NOT run.");

/** A campaign with several offers: each lead gets its offer and case study by rules, the default offer when none fits, and the choice is stored with its reason. */
describe.skipIf(!enabled)("offer choice per lead (mock adapters, real database)", () => {
  const tag = newTag();
  const ctx = makeCtx("offers-worker", (m) => console.warn(`[worker] ${m}`));
  const { db } = ctx;
  const D = (s: string) => `${s}-${tag}.example.com`;
  let inboxId = "";
  let agencyOffer = "";
  let healthOffer = "";
  let previousWorkflow: Json | null | undefined;

  async function mkCampaign(name: string, offerIds: string[], defaultOffer: string | null) {
    const { data, error } = await db
      .from("campaigns")
      .insert({ name: `${tag} ${name}`, offer_id: defaultOffer, offer_ids: offerIds, inbox_id: inboxId, cta: "Open to a quick call next week?", daily_cap: 6, target_roles: ["COO"], icp: { leadSource: "csv", requireEmail: true, industries: ["software"] } as Json })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }
  async function mkLead(campaign: string, key: string, o: { industry?: string; businessType?: string; triggerType?: string } = {}) {
    const company = (await db.from("companies").insert({ domain: D(key), name: `${key} ${tag}`, industry: o.industry ?? "software", employee_count: 80, country: "IN" }).select("id").single()).data!;
    const contact = (await db.from("contacts").insert({ first_name: "Pat", last_name: `Tester ${tag}`, full_name: `Pat Tester ${tag}`, job_title: "COO", email: `pat@${D(key)}`, company_id: company.id, country: "IN" }).select("id").single()).data!;
    const components = { ...(o.businessType ? { screen: { fit: "yes", business_type: o.businessType, reason: "x", mode: "mock" } } : {}), ...(o.triggerType ? { trigger_type: o.triggerType } : {}) };
    return (await db.from("campaign_leads").insert({ campaign_id: campaign, contact_id: contact.id, status: "imported", lead_source: "itest", score_components: components as Json }).select("id").single()).data!.id;
  }
  async function setWorkflow() {
    const value = { postal_address: `${tag} Street 1, Pune 411001, India`, optout_line: "Reply STOP and I will not write again." };
    await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: value as Json }, { onConflict: "key" });
  }

  beforeAll(async () => {
    previousWorkflow = (await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle()).data?.value;
    await setWorkflow();
    inboxId = (await db.from("inboxes").insert({ email: `${tag}-inbox@example.com`, display_name: "Sam", status: "active", daily_send_cap: 50, daily_draft_cap: 50, min_seconds_between_sends: 0 }).select("id").single()).data!.id;
    agencyOffer = (await db.from("offers").insert({ name: `White-label ${tag}`, allowed_claims: ["Fixed-scope audit"], match_terms: ["agency", "web design"] }).select("id").single()).data!.id;
    healthOffer = (await db.from("offers").insert({ name: `Healthtech capacity ${tag}`, allowed_claims: ["Fixed-scope audit"], match_terms: ["healthcare", "health tech"], trigger_types: ["hiring-developers"] }).select("id").single()).data!.id;
    await db.from("case_studies").insert([
      { offer_id: agencyOffer, title: `Agency overflow ${tag}`, summary: "Illustrative", allowed_numbers: { hours: 12 }, industries: ["agency"] },
      { offer_id: agencyOffer, title: `Studio rescue ${tag}`, summary: "Illustrative", allowed_numbers: { weeks: 3 }, industries: ["web design"] },
      { offer_id: healthOffer, title: `Clinic portal ${tag}`, summary: "Illustrative", allowed_numbers: { days: 9 }, industries: ["healthcare"] },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    if (previousWorkflow === undefined) await db.from("settings").delete().eq("key", WORKFLOW_SETTINGS_KEY);
    else await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: previousWorkflow }, { onConflict: "key" });
    await cleanup(tag);
    await ctx.pool.end();
  }, 120_000);

  it("chooses the offer and the case study by rules, and falls back to the default offer", async () => {
    const camp = await mkCampaign("choose", [agencyOffer, healthOffer], healthOffer);
    const agency = await chooseOffer(ctx, await loadLead(db, await mkLead(camp, "studio", { businessType: "Web design agency" })));
    expect(agency.offer?.id).toBe(agencyOffer);
    expect(agency.offerReason).toContain('"agency"');
    expect(agency.caseStudy?.title).toBe(`Agency overflow ${tag}`);

    const health = await chooseOffer(ctx, await loadLead(db, await mkLead(camp, "clinic", { businessType: "Healthcare software", industry: "hospital & health care" })));
    expect(health.offer?.id).toBe(healthOffer);
    expect(health.caseStudy?.title).toBe(`Clinic portal ${tag}`);

    const other = await chooseOffer(ctx, await loadLead(db, await mkLead(camp, "freight", { businessType: "Freight forwarder", industry: "logistics" })));
    expect(other.offer?.id).toBe(healthOffer); // the default offer
    expect(other.offerReason).toContain("No offer rule matched");
    expect(other.caseStudy).toBeNull(); // no case study of the default offer fits a freight forwarder

    const trigger = await chooseOffer(ctx, await loadLead(db, await mkLead(camp, "saas-studio", { businessType: "SaaS agency", industry: "healthcare", triggerType: "hiring-developers" })));
    expect(trigger.offer?.id).toBe(healthOffer); // matches both offers; the hiring trigger tips it to the healthtech offer
    expect(trigger.offerReason).toContain("Hiring developers");
  }, 120_000);

  it("a campaign saved before several offers existed keeps working: its one offer is used for every lead", async () => {
    const camp = await mkCampaign("legacy", [agencyOffer], agencyOffer);
    const c = await chooseOffer(ctx, await loadLead(db, await mkLead(camp, "legacy-co", { businessType: "Dental clinic" })));
    expect(c.offer?.id).toBe(agencyOffer);
    expect(c.offerReason).toBe("The only offer on this campaign.");

    const none = await mkCampaign("none", [], null);
    expect((await chooseOffer(ctx, await loadLead(db, await mkLead(none, "none-co")))).offer).toBeNull();
  }, 120_000);

  it("an archived offer is never chosen; the default is replaced by the first live offer", async () => {
    const camp = await mkCampaign("archived", [agencyOffer, healthOffer], healthOffer);
    await db.from("offers").update({ deleted_at: new Date().toISOString() }).eq("id", healthOffer);
    try {
      const c = await chooseOffer(ctx, await loadLead(db, await mkLead(camp, "after-archive", { businessType: "Healthcare software" })));
      expect(c.offer?.id).toBe(agencyOffer);
    } finally {
      await db.from("offers").update({ deleted_at: null }).eq("id", healthOffer);
    }
  }, 120_000);

  it("the chosen offer and its reason are stored on the lead before the email is written, even when the email later fails its checks", async () => {
    // the mock quick check calls every company a "software agency": the agency offer fits, the default (healthtech) does not
    const camp = await mkCampaign("write", [healthOffer, agencyOffer], healthOffer);
    const lead = await mkLead(camp, "write-co", { businessType: "Software agency" });
    await db.from("contacts").update({ first_name: "Pat" }).eq("id", (await loadLead(db, lead)).contact_id);
    const fact: Fact = { evidenceId: "00000000-0000-4000-8000-000000000001", type: "hiring", statement: "Acme is hiring a React developer", quote: "We are hiring a React developer", url: "https://acme.example/careers", date: null, retrievedAt: new Date().toISOString(), trigger: "hiring-developers" };
    const passThrough = (async (_provider: string, _unit: string, fn: () => Promise<unknown>) => fn()) as never;
    const cfg = parseWorkflowConfig({ postal_address: "1 Street, Pune 411001, India", optout_line: "Reply STOP and I will not write again." });
    await writeEmail(ctx, passThrough, cfg, await loadLead(db, lead), [fact], { displayName: "Sam", email: `${tag}-inbox@example.com` }, []);
    const row = (await db.from("campaign_leads").select("offer_id, offer_reason, case_study_id").eq("id", lead).single()).data!;
    expect(row.offer_id).toBe(agencyOffer);
    expect(row.offer_reason).toMatch(/Matched "agency"/);
    expect(row.case_study_id).not.toBeNull();
  }, 120_000);
});
