import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@outreach/db";
import { WORKFLOW_SETTINGS_KEY } from "@outreach/core";
import { startRun } from "@outreach/db";
import type { WorkerCtx } from "../src/ctx";
import { importTable } from "../src/jobs/import";
import { runOneJob } from "../src/jobs/runner";
import { loadFacts } from "../src/pipeline/stages";
import { cleanup, hasIntegrationDb, makeCtx, newTag } from "./helpers/itest";

const enabled = hasIntegrationDb();
if (!enabled) console.warn("[worker tests] DATABASE_URL / Supabase keys missing: the research-source and email-quality integration tests are NOT run.");

/**
 * Findings from the Apollo CSV run reports, as tests (mock adapters, real database): research reads only the lead's own site and press about
 * that exact company; the email follows the tools table, the sample emails, the reply-only soft ask, the subject and sign-off rules; email
 * statuses and data problems are recorded.
 */
describe.skipIf(!enabled)("research sources and email quality (mock adapters, real database)", () => {
  const tag = newTag();
  const ctx = makeCtx("quality-worker", (m) => console.warn(`[worker] ${m}`));
  const { db } = ctx;
  const D = (s: string) => `${s}-${tag}.example.com`;
  const OFFER = `Web and app development for agencies ${tag}`;
  let inboxId = "";
  let offerId = "";
  let previousWorkflow: Json | null | undefined;

  async function setWorkflow(patch: Record<string, unknown> = {}) {
    const value = { postal_address: `${tag} Street 1, Pune 411001, India`, optout_line: "Reply STOP and I will not write again.", ...patch };
    await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: value as Json }, { onConflict: "key" });
  }
  async function mkCampaign(name: string, inbox = inboxId) {
    const { data, error } = await db
      .from("campaigns")
      .insert({ name: `${tag} ${name}`, offer_id: offerId, offer_ids: [offerId], inbox_id: inbox, cta: "Open to a quick call next week?", daily_cap: 6, target_roles: ["CTO"], icp: { leadSource: "csv", requireEmail: true, industries: ["software"] } as Json })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id;
  }
  async function mkLead(campaign: string, key: string, o: { domain?: string; name?: string; email?: string | null; status?: string; industry?: string } = {}) {
    const domain = o.domain ?? D(key);
    const company = (await db.from("companies").insert({ domain, name: o.name ?? `${key} ${tag}`, industry: o.industry ?? "software", employee_count: 80, country: "IN" }).select("id").single()).data!;
    const contact = (
      await db
        .from("contacts")
        .insert({ first_name: "Pat", last_name: `Tester ${tag}`, full_name: `Pat Tester ${tag}`, job_title: "CTO", email: o.email === undefined ? `pat@${domain}` : o.email, email_status: o.status ?? "unknown", company_id: company.id, country: "IN" })
        .select("id")
        .single()
    ).data!;
    const lead = (await db.from("campaign_leads").insert({ campaign_id: campaign, contact_id: contact.id, status: "imported", lead_source: "itest" }).select("id").single()).data!;
    return { leadId: lead.id, contactId: contact.id, companyId: company.id, domain };
  }
  const leadRow = async (id: string) => (await db.from("campaign_leads").select("status, reason_codes, score_components, lead_score").eq("id", id).single()).data!;
  async function run(c: WorkerCtx, campaignId: string) {
    const batchId = await startRun(db, campaignId, { startedBy: null, label: `${tag} run` });
    while (await runOneJob(c, { campaignIds: [campaignId] })) {
      /* keep draining */
    }
    return (await db.from("pipeline_batches").select("*").eq("id", batchId).single()).data!;
  }

  beforeAll(async () => {
    previousWorkflow = (await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle()).data?.value;
    await setWorkflow();
    inboxId = (await db.from("inboxes").insert({ email: `${tag}-inbox@example.com`, display_name: "Sam Rivera", status: "active", daily_send_cap: 50, daily_draft_cap: 50, min_seconds_between_sends: 0 }).select("id").single()).data!.id;
    offerId = (await db.from("offers").insert({ name: OFFER, allowed_claims: ["Fixed-scope audit"], cta_options: ["Open to a quick call next week?"] }).select("id").single()).data!.id;
    await db.from("case_studies").insert({ offer_id: offerId, title: `Case ${tag}`, summary: "Illustrative", allowed_numbers: { hours: 12 }, industries: ["software"] });
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    if (previousWorkflow === undefined) await db.from("settings").delete().eq("key", WORKFLOW_SETTINGS_KEY);
    else await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: previousWorkflow }, { onConflict: "key" });
    await cleanup(tag);
    await ctx.pool.end();
  }, 120_000);

  it("research reads only the lead's own site and press about that exact company; LinkedIn, Crunchbase, job boards and look-alike companies are never used", async () => {
    const camp = await mkCampaign("sources");
    const name = `Quadrant ${tag}`;
    const lead = await mkLead(camp, "quadrant", { name });
    const own = `https://${lead.domain}/news/funding`;
    const press = "https://news.example.org/quadrant-seed";
    const hits = [
      { title: `${name} (${lead.domain}) announces seed funding round`, url: own, snippet: `${name} announced a seed funding round to grow its team.`, publishedAt: "2026-10-01" },
      { title: `${name} raises seed funding`, url: press, snippet: `${name}, which runs ${lead.domain}, raised a seed funding round.`, publishedAt: "2026-10-02" },
      { title: `${name} Inc - funding round`, url: `https://quadrant${tag}inc.example.com/about`, snippet: `${name} Inc announced a seed funding round.`, publishedAt: "2026-10-03" },
      { title: `${name} (${lead.domain}) | LinkedIn`, url: `https://www.linkedin.com/company/quadrant-${tag}`, snippet: `${name} ${lead.domain} announced a seed funding round.` },
      { title: `${name} (${lead.domain}) | Crunchbase`, url: `https://www.crunchbase.com/organization/quadrant-${tag}`, snippet: `${name} ${lead.domain} raised a seed funding round.` },
      { title: `${name} (${lead.domain}) hiring - Indeed`, url: `https://www.indeed.com/cmp/quadrant-${tag}`, snippet: `${name} ${lead.domain} is hiring developers.` },
    ];
    const queries: string[] = [];
    const fetched: string[] = [];
    const spying: WorkerCtx = {
      ...ctx,
      adapters: {
        ...ctx.adapters,
        search: { search: async ({ query }) => (queries.push(query), { results: hits, usage: { units: { search: 1 } } }) },
        fetcher: { fetchPage: async (url) => (fetched.push(url), ctx.adapters.fetcher.fetchPage(url)) },
      },
    };
    const batch = await run(spying, camp);
    expect(batch.status).toBe("completed");

    // the search names the company AND its domain, so look-alike companies are not even asked for
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q).toContain(lead.domain);
    // nothing outside the company's own site was fetched, and nothing on LinkedIn or Crunchbase
    expect(fetched.length).toBeGreaterThan(0);
    for (const u of fetched) expect(new URL(u).hostname).toBe(lead.domain);

    const research = ((await leadRow(lead.leadId)).score_components as { research?: { pages_visited: string[] } }).research;
    expect(research).toBeTruthy();
    const visited = research!.pages_visited;
    expect(visited).toEqual(expect.arrayContaining([own, press]));
    for (const u of visited) {
      const host = new URL(u).hostname;
      expect(host, u).not.toMatch(/linkedin|crunchbase|indeed/);
      expect(host, u).not.toContain("inc.example.com"); // the look-alike company
    }
    // every stored fact is on the company's own site or on the checked press page
    const evidence = (await db.from("evidence_items").select("url, source_type").eq("company_id", lead.companyId)).data!;
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) expect([lead.domain, "news.example.org"], e.url).toContain(new URL(e.url).hostname);
    const facts = await loadFacts(ctx, lead.companyId, []);
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) expect([lead.domain, "news.example.org"], f.url).toContain(new URL(f.url).hostname);
  }, 300_000);

  it("facts saved by an earlier version from other sites are not used: look-alike companies, LinkedIn, job boards and unchecked 'news'", async () => {
    const camp = await mkCampaign("legacy");
    const name = `Vitalize ${tag}`;
    const lead = await mkLead(camp, "vitalize", { name });
    const row = (url: string, sourceType: string, what: string) => ({ company_id: lead.companyId, url, title: `[hiring] ${what}`, snippet: `${what} (quote)`, retrieved_at: new Date().toISOString(), source_type: sourceType, confidence: 0.6 });
    const rows = [
      row(`https://${lead.domain}/careers`, "company_site", "own careers page"),
      row("https://news.example.org/checked", "web", "checked press"),
      row("https://news.example.org/old", "news", "press saved before the check existed"),
      row(`https://vitalizepsych${tag}.example.com/team`, "news", "a look-alike company"),
      row("https://www.linkedin.com/company/x", "web", "linkedin"),
      row("https://www.indeed.com/cmp/x", "web", "indeed"),
    ];
    const { error } = await db.from("evidence_items").insert(rows);
    expect(error).toBeNull();
    const used = (await loadFacts(ctx, lead.companyId, [])).map((f) => f.statement).sort();
    expect(used).toEqual(["checked press", "own careers page"]);
  }, 60_000);

  it("a lead whose 'website' is LinkedIn or Crunchbase is skipped before anything is read or paid for", async () => {
    const camp = await mkCampaign("linkedin");
    const li = await mkLead(camp, "li", { domain: `${tag}.linkedin.com` });
    const fetched: string[] = [];
    const spying: WorkerCtx = { ...ctx, adapters: { ...ctx.adapters, fetcher: { fetchPage: async (u) => (fetched.push(u), ctx.adapters.fetcher.fetchPage(u)) } } };
    const batch = await run(spying, camp);
    expect(batch.status).toBe("completed");
    expect(await leadRow(li.leadId)).toMatchObject({ status: "disqualified", reason_codes: ["excluded", expect.stringContaining("LinkedIn or Crunchbase")] });
    expect(fetched).toEqual([]);
    expect((await db.from("usage_records").select("id").eq("campaign_lead_id", li.leadId)).data).toHaveLength(0);
  }, 200_000);

  it("the email: tools row by industry, sample emails in the writer's system text, reply-only soft ask, no offer name in the subject, sign-off name + company once", async () => {
    await setWorkflow({
      tools_by_industry: { default: "DEFAULT TOOLS SENTENCE.", "health, software": "SOFTWARE TOOLS SENTENCE." },
      reference_emails: [`Hi A, sample one ${tag}.`, `Hi B, sample two ${tag}.`],
      sender_company: "Nuance Infotech",
    });
    try {
      const camp = await mkCampaign("email");
      const lead = await mkLead(camp, "mailco", { industry: "Health software" });
      const writes: { system: string; prompt: string }[] = [];
      // the first attempt breaks three rules (offer name in the subject, asks the lead to send something, company twice in the sign-off); the rewrite is told which
      const flawed: WorkerCtx = {
        ...ctx,
        adapters: {
          ...ctx.adapters,
          llm: {
            complete: async (req) => {
              const isWrite = /\[task:write\]/.test(`${req.system ?? ""}\n${req.prompt}`);
              const res = await ctx.adapters.llm.complete(req);
              if (!isWrite) return res;
              writes.push({ system: req.system ?? "", prompt: req.prompt });
              if (req.prompt.includes("THE LAST ATTEMPT FAILED")) return res;
              const w = JSON.parse(res.text) as { subject: string; body: string; fact_ids_used: string[] };
              w.subject = "web and app development for agencies";
              w.body = w.body.replace("just reply.", "please send me your requirements.").replace("Sam Rivera\nNuance Infotech", "Nuance Infotech\nNuance Infotech");
              return { ...res, text: JSON.stringify(w) };
            },
          },
        },
      };
      const batch = await run(flawed, camp);
      expect(batch.status).toBe("completed");
      expect(await leadRow(lead.leadId)).toMatchObject({ status: "draft_ready" });

      expect(writes).toHaveLength(2);
      const [first, second] = writes;
      // the industry row was chosen from the company's industry ("Health software" matches a keyword of the second row), not the default
      expect(first!.prompt).toContain("TOOLS: SOFTWARE TOOLS SENTENCE.");
      expect(first!.prompt).not.toContain("DEFAULT TOOLS SENTENCE.");
      // the sample emails are in the system text (the same for every lead), not repeated in the per-lead text
      expect(first!.system).toContain(`SAMPLE 1: Hi A, sample one ${tag}.`);
      expect(first!.system).toContain(`SAMPLE 2: Hi B, sample two ${tag}.`);
      expect(first!.prompt).not.toContain("SAMPLE 1");
      expect(first!.system).toContain("just reply");
      expect(first!.prompt).toContain("SENDER_NAME: Sam Rivera");
      expect(first!.prompt).toContain("SENDER_COMPANY: Nuance Infotech");
      // the rewrite is told each failed rule
      expect(second!.prompt).toContain("W5: subject contains the internal offer name");
      expect(second!.prompt).toContain("W7: asks the lead to send, share or fill in something");
      expect(second!.prompt).toContain("W9: the company name is written twice in the sign-off");

      const draft = (await db.from("email_drafts").select("subject, body_text, claim_check").eq("campaign_lead_id", lead.leadId).single()).data!;
      expect((draft.claim_check as { attempts: number }).attempts).toBe(2);
      expect(draft.subject.toLowerCase()).not.toContain("for agencies");
      expect(draft.body_text).toContain("just reply.");
      expect(draft.body_text).not.toMatch(/send me|your requirements/i);
      expect(draft.body_text).toContain("Sam Rivera\nNuance Infotech");
      expect(draft.body_text.split("Nuance Infotech").length - 1).toBe(1);
    } finally {
      await setWorkflow();
    }
  }, 400_000);

  it("a mailbox whose display name is the company name signs with the company once", async () => {
    const companyBox = (await db.from("inboxes").insert({ email: `${tag}-company@example.com`, display_name: "Nuance Infotech", status: "active", daily_send_cap: 50, daily_draft_cap: 50, min_seconds_between_sends: 0 }).select("id").single()).data!.id;
    const camp = await mkCampaign("companybox", companyBox);
    const lead = await mkLead(camp, "signco");
    const batch = await run(ctx, camp);
    expect(batch.status).toBe("completed");
    expect(await leadRow(lead.leadId)).toMatchObject({ status: "draft_ready" });
    const body = (await db.from("email_drafts").select("body_text").eq("campaign_lead_id", lead.leadId).single()).data!.body_text;
    expect(body.split("Nuance Infotech").length - 1).toBe(1);
    expect(body).not.toContain("Nuance\nNuance Infotech");
  }, 300_000);

  it("email status: a catch-all address is risky and is not written to; a work address on another website is flagged", async () => {
    const camp = await mkCampaign("status");
    const catchAll = await mkLead(camp, "catchco", { email: `catchall.pat@${D("catchco")}` }); // the verifier answers catch-all
    const legacy = await mkLead(camp, "legacyco", { status: "catch_all" }); // saved as catch_all by an earlier version
    const mismatch = await mkLead(camp, "mismatchco", { email: `pat@other-${tag}.example.com` });
    const batch = await run(ctx, camp);
    expect(batch.status).toBe("completed");

    for (const l of [catchAll, legacy]) {
      expect((await db.from("contacts").select("email_status").eq("id", l.contactId).single()).data!.email_status).toBe("risky");
      expect(await leadRow(l.leadId)).toMatchObject({ status: "disqualified", reason_codes: ["bad-email", "risky"] });
      expect((await db.from("email_drafts").select("id").eq("campaign_lead_id", l.leadId)).data).toHaveLength(0);
    }
    // never "valid" without a check: the verifier ran for the unchecked one only
    expect((await db.from("contacts").select("email_status").eq("id", mismatch.contactId).single()).data!.email_status).toBe("valid");
    expect(((await leadRow(mismatch.leadId)).score_components as { data_flags?: string[] }).data_flags).toEqual(["email domain mismatch"]);
    expect(((await leadRow(catchAll.leadId)).score_components as { data_flags?: string[] }).data_flags ?? []).toEqual([]);
  }, 300_000);

  it("import: an email at another website than the company's is flagged on the lead ('email domain mismatch'); a catch-all status is saved as risky", async () => {
    const camp = await mkCampaign("import");
    const headers = ["First Name", "Last Name", "Email", "Email Status", "Website", "Company"];
    const rows = [
      ["Ann", `Flag ${tag}`, `ann@trinium-${tag}.example.com`, "Catch-all", D("elkview"), `Elkview ${tag}`],
      ["Bob", `Fine ${tag}`, `bob@${D("fine")}`, "Verified", D("fine"), `Fine ${tag}`],
    ];
    const mapping = { fields: { first_name: "First Name", last_name: "Last Name", email: "Email", email_status: "Email Status", company_domain: "Website", company_name: "Company" } };
    const batch = (
      await db.from("import_batches").insert({ file_name: `${tag}.csv`, file_hash: `${tag}:flags`, campaign_id: camp, mapping: mapping as unknown as Json, mode: "add_new", status: "mapped", runs: 1 }).select("*").single()
    ).data!;
    const table = { sheetNames: ["s"], sheet: "s", headers, rawHeaders: headers, hasHeader: true, rows, rowNumbers: [2, 3], blankRows: 0, encoding: null, delimiter: null, warnings: [] };
    const totals = await importTable(db, batch, { requireEmail: true, stored: mapping as never, run: 1 }, table, ctx.log);
    expect(totals.imported).toBe(2);
    const leads = (await db.from("campaign_leads").select("score_components, contacts(first_name, email_status)").eq("campaign_id", camp)).data!;
    const ann = leads.find((l) => l.contacts?.first_name === "Ann")!;
    const bob = leads.find((l) => l.contacts?.first_name === "Bob")!;
    expect((ann.score_components as { data_flags: string[] }).data_flags).toEqual(["email domain mismatch"]);
    expect(ann.contacts?.email_status).toBe("risky");
    expect((bob.score_components as { data_flags?: string[] }).data_flags ?? []).toEqual([]);
    expect(bob.contacts?.email_status).toBe("valid");
    const notes = (await db.from("import_rows").select("errors").eq("batch_id", batch.id).eq("row_number", 2).single()).data!.errors;
    expect(notes.join(" ")).toMatch(/Email domain mismatch/);
  }, 120_000);
});
