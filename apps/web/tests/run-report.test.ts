import { describe, expect, it } from "vitest";
import { RUN_REPORT_COLUMNS } from "@outreach/core";
import { isRecheckable, quickCheckOf, recheckCounts, recheckLine } from "../src/lib/quick-check";
import { PLAIN_REASON, PLAIN_STEP } from "../src/lib/plain";
import { reportResponse, runLeadIds, sortReportLeads, toReportLead, type LoadedRun, type RawReportLead } from "../src/lib/run-report";

const skipped: RawReportLead = {
  lead: { status: "disqualified", reason_codes: ["screen-failed", "does not look like a software business"], lead_score: null, lead_source: "import:leads.csv", score_components: { screen: { fit: "no", business_type: "restaurant", reason: "serves food", mode: "live" } } },
  contact: { first_name: "Rita", last_name: "Stone", job_title: "Owner", email: "rita@food.example", email_status: "valid", company_name: "Food Co" },
  company: { name: "Food Co", domain: "food.example", country: "UK", employee_count: 12, industry: "food" },
  cutoff: 55,
};

const drafted: RawReportLead = {
  lead: {
    status: "draft_ready",
    reason_codes: [],
    lead_score: 82,
    trigger: "Hiring a React developer",
    trigger_date: "2026-10-01",
    trigger_source: "https://acme.example/careers",
    lead_source: "web_discovery",
    source_detail: "saas agency uk",
    score_components: {
      screen: { fit: "uncertain", business_type: "software agency", reason: "thin homepage" },
      research: { pages_visited: ["https://acme.example/", "https://acme.example/careers"], hiring_roles: ["React Developer", "QA"], facts_check: { given: 5, kept: 3 } },
      components: { fit: 15, role: 20, size: 10, trigger: 25, data: 12 },
    },
  },
  contact: { first_name: "Asha", last_name: "Rao", job_title: "CTO", email: "asha@acme.example", email_status: "valid", profile_url: "https://profile.example/asha" },
  company: { name: "Acme", domain: "acme.example", country: "IN", employee_count: 40, industry: "software" },
  facts: [{ statement: "Acme is hiring a React developer", url: "https://acme.example/careers" }],
  draft: { subject: "Quick idea", body_text: "=SUM(1,1)\nSecond line, with a comma", claim_check: { attempts: 2 }, gmail_draft_id: "r-1", gmail_message_id: "18abc" },
  mailbox: "me@gmail.com",
  offerName: "White-label development",
  caseStudy: "Agency overflow case",
  costUsd: 0.0123,
  cutoff: 55,
};

describe("toReportLead", () => {
  it("maps a skipped lead with its reason, step and quick check", () => {
    const l = toReportLead(skipped);
    expect(l).toMatchObject({ status: "disqualified", reasonCodes: ["screen-failed", "does not look like a software business"], quickCheck: { fit: "no", reason: "serves food" }, businessType: "restaurant", companyName: "Food Co", domain: "food.example", cutoff: 55, draft: null, gmailLink: null });
    expect(l.pagesVisited).toEqual([]);
    expect(l.factsGiven).toBeNull();
    expect(l.components).toBeNull();
  });

  it("maps an approved lead with research, score parts, draft quality and the Gmail link", () => {
    const l = toReportLead(drafted);
    expect(l).toMatchObject({
      pagesVisited: ["https://acme.example/", "https://acme.example/careers"],
      hiringRoles: ["React Developer", "QA"],
      factsGiven: 5,
      factsKept: 3,
      components: { fit: 15, role: 20, size: 10, trigger: 25, data: 12 },
      score: 82,
      offerName: "White-label development",
      caseStudy: "Agency overflow case",
      mailbox: "me@gmail.com",
      costUsd: 0.0123,
    });
    expect(l.draft).toEqual({ subject: "Quick idea", body: "=SUM(1,1)\nSecond line, with a comma", attempts: 2 });
    expect(l.gmailLink).toBe("https://mail.google.com/mail/u/?authuser=me%40gmail.com#drafts?compose=18abc");
  });

  it("carries the test-run decision and survives missing or odd jsonb", () => {
    expect(toReportLead({ lead: { status: "scored", score_components: null }, wouldApprove: true }).wouldApprove).toBe(true);
    const odd = toReportLead({ lead: { status: "researching", score_components: { screen: "oops", research: { pages_visited: "x", facts_check: [] }, components: 5 } } });
    expect(odd).toMatchObject({ quickCheck: null, pagesVisited: [], hiringRoles: [], factsGiven: null, components: null, draft: null });
    // a draft that was never saved in Gmail has no link
    expect(toReportLead({ ...drafted, draft: { subject: "s", body_text: "b", claim_check: {}, gmail_draft_id: null } }).gmailLink).toBeNull();
  });
});

describe("run leads", () => {
  it("are the leads worked on plus the ones skipped before them, once each", () => {
    expect(runLeadIds({ leadIds: ["a", "b"], reportExtraIds: ["b", "c"] })).toEqual(["a", "b", "c"]);
    expect(runLeadIds({ leadIds: ["a"] })).toEqual(["a"]);
    expect(runLeadIds(null)).toEqual([]);
  });
  it("list approved and drafted first, then the rest, then skipped; the best score first", () => {
    const a = toReportLead({ lead: { status: "disqualified", lead_score: 90 } });
    const b = toReportLead({ lead: { status: "draft_ready", lead_score: 60 } });
    const c = toReportLead({ lead: { status: "approved", lead_score: 80 } });
    const d = toReportLead({ lead: { status: "scored", lead_score: 99 } });
    expect(sortReportLeads([a, b, c, d]).map((l) => l.status)).toEqual(["approved", "draft_ready", "scored", "disqualified"]);
  });
});

describe("the CSV download", () => {
  const loaded: LoadedRun = { batch: { id: "11111111-2222-3333-4444-555555555555", campaign_id: "c", started_at: "2026-10-28T00:00:00Z", finished_at: null, totals: {}, estimate: {} }, leads: [toReportLead(drafted), toReportLead(skipped)] };

  it("starts with a byte order mark, has exactly the report columns, and keeps every lead including skipped ones", async () => {
    const res = reportResponse(loaded.batch.id, loaded, new Date("2026-10-28T10:00:00Z"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="run-report-2026-10-28-11111111.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Response.text() drops the byte order mark, so the raw bytes are checked: EF BB BF
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe(RUN_REPORT_COLUMNS.join(","));
    expect(text).toContain("Food Co");
    expect(text).toContain("Acme");
    expect(text).toContain("passed after a rewrite");
    expect(text).toContain("quick check"); // the step where the skipped lead stopped
  });

  it("protects cells that start with = + - @, and keeps a multi-line body inside quotes", async () => {
    const text = await reportResponse("id", loaded).text();
    expect(text).toContain(`"'=SUM(1,1)\nSecond line, with a comma"`);
    expect(text).not.toMatch(/(^|,)=SUM/m);
  });

  it("is a 404 for an unknown run", async () => {
    expect(reportResponse("x", null).status).toBe(404);
  });
});

describe("quick check display and re-check", () => {
  it("reads the saved quick check as yes, maybe or no", () => {
    expect(quickCheckOf({ screen: { fit: "yes", business_type: "saas", reason: "builds software" } })).toEqual({ label: "Yes", tone: "green", businessType: "saas", reason: "builds software" });
    expect(quickCheckOf({ screen: { fit: "uncertain" } })).toMatchObject({ label: "Maybe", tone: "amber" });
    expect(quickCheckOf({ screen: { fit: "no", reason: "a school" } })).toMatchObject({ label: "No", tone: "red", reason: "a school" });
    expect(quickCheckOf({})).toBeNull();
    expect(quickCheckOf(null)).toBeNull();
    expect(quickCheckOf({ screen: { fit: "weird" } })).toBeNull();
  });

  it("counts only leads skipped as not a fit or unreadable", () => {
    expect(isRecheckable({ status: "disqualified", reason_codes: ["screen-failed", "x"] })).toBe(true);
    expect(isRecheckable({ status: "disqualified", reason_codes: ["no-data"] })).toBe(true);
    expect(isRecheckable({ status: "disqualified", reason_codes: ["below-threshold"] })).toBe(false);
    expect(isRecheckable({ status: "imported", reason_codes: ["screen-failed"] })).toBe(false);
    expect(
      recheckCounts([
        { campaign_id: "a", status: "disqualified", reason_codes: ["screen-failed"] },
        { campaign_id: "a", status: "disqualified", reason_codes: ["no-data"] },
        { campaign_id: "a", status: "disqualified", reason_codes: ["suppressed"] },
        { campaign_id: "b", status: "disqualified", reason_codes: ["screen-failed"] },
        { campaign_id: "b", status: "draft_ready", reason_codes: [] },
      ]),
    ).toEqual({ a: 2, b: 1 });
  });

  it("says the result in plain words", () => {
    expect(recheckLine({ total: 23, passed: 15, stillNo: 6, stillUnreadable: 2 })).toBe("Checked 23: 15 now fit or may fit and wait for the next run, 6 still do not fit, 2 websites still cannot be read.");
    expect(recheckLine({ total: 0, note: "No lead was skipped at the quick check." })).toBe("No lead was skipped at the quick check.");
    expect(recheckLine({ total: 3, passed: 1, stillNo: 0, stillUnreadable: 0, suppressed: 1, failed: 1 })).toContain("1 are on your do-not-contact list");
  });

  it("points a skipped lead to the Re-check button in plain words", () => {
    expect(PLAIN_REASON["screen-failed"]).toMatch(/Re-check skipped leads on the Leads page/);
    expect(PLAIN_REASON["no-data"]).toMatch(/Re-check skipped leads on the Leads page/);
    expect(PLAIN_STEP["quick check"]).toMatch(/only a clear no is skipped/);
  });
});
