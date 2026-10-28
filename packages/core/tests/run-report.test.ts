import { describe, expect, it } from "vitest";
import { RUN_REPORT_COLUMNS, buildScreenPrompt, decisionOf, emailQualityOf, reportRow, runReportCsv, runReportFileName, stepOfReason, type RunReportLead } from "../src";

const base: RunReportLead = {
  firstName: "Asha", lastName: "Rao", jobTitle: "Head of Operations", email: "asha@acme.io", emailStatus: "valid", dataFlags: [], profileUrl: "https://example.com/in/asha",
  companyName: "Acme", domain: "acme.io", country: "IN", employeeCount: 80, industry: "software", businessType: "software agency",
  leadSource: "import:leads.csv", sourceDetail: null,
  quickCheck: { fit: "yes", reason: "builds software for clients" },
  pagesVisited: ["https://acme.io/", "https://acme.io/careers"], hiringRoles: ["React Developer"],
  facts: [{ statement: "Acme is hiring a React developer", url: "https://acme.io/careers" }], factsGiven: 4, factsKept: 3,
  trigger: "Acme is hiring a React developer", triggerDate: "2026-10-01", triggerUrl: "https://acme.io/careers",
  score: 82, components: { fit: 25, trigger: 20, role: 15, size: 10, data: 12 }, cutoff: 55,
  status: "draft_ready", reasonCodes: [], wouldApprove: false,
  offerName: "White-label development", offerReason: 'Matched "agency" in the business type.', caseStudy: "Agency overflow case",
  draft: { subject: "Quick idea", body: "Hi Asha,\n\nI saw the role.\n\nBest", attempts: 1 },
  gmailLink: "https://mail.google.com/mail/u/?authuser=me%40x.com#drafts?compose=1", mailbox: "me@x.com", costUsd: 0.01234, models: { quickCheck: "claude-haiku-5-5", facts: "claude-haiku-5-5", writing: "claude-sonnet-5-5", checker: "claude-haiku-5-5" },
};

describe("run report", () => {
  it("has one named column per item of the brief, in a fixed order", () => {
    expect(RUN_REPORT_COLUMNS).toEqual([
      "First name", "Last name", "Job title", "Email", "Email status", "Data flags", "Profile URL", "Company", "Website", "Country", "Employees", "Industry", "Business type",
      "Source", "Search query", "Quick check", "Quick check reason", "Pages visited", "Hiring roles found", "Verified facts", "Facts passed quote check", "Facts failed quote check",
      "Trigger", "Trigger date", "Trigger source", "Score", "Score: fit", "Score: trigger", "Score: role", "Score: size", "Score: data quality", "Cut-off", "Decision",
      "Skip reason", "Stopped at step", "Offer", "Why this offer", "Case study", "Email subject", "Email body", "Email quality", "Gmail draft link", "Mailbox", "Model used", "Cost (USD)",
    ]);
  });

  it("fills an approved lead completely", () => {
    const r = reportRow(base);
    expect(r).toMatchObject({
      "Source": "CSV file", "Search query": "", "Quick check": "yes", "Quick check reason": "builds software for clients",
      "Pages visited": "https://acme.io/ | https://acme.io/careers", "Hiring roles found": "React Developer",
      "Verified facts": "Acme is hiring a React developer [https://acme.io/careers]", "Facts passed quote check": "3", "Facts failed quote check": "1",
      "Score": "82", "Score: fit": "25", "Score: trigger": "20", "Score: role": "15", "Score: size": "10", "Score: data quality": "12", "Cut-off": "55", "Decision": "approved",
      "Skip reason": "", "Stopped at step": "", "Offer": "White-label development", "Why this offer": 'Matched "agency" in the business type.', "Case study": "Agency overflow case",
      "Email subject": "Quick idea", "Email quality": "passed first time", "Mailbox": "me@x.com", "Cost (USD)": "0.0123",
    });
    expect(r["Email body"]).toBe("Hi Asha,\n\nI saw the role.\n\nBest");
    expect(r["Gmail draft link"]).toContain("mail.google.com");
    expect(reportRow({ ...base, draft: { ...base.draft!, attempts: 2 } })["Email quality"]).toBe("passed after a rewrite");
  });

  it("includes skipped leads with the reason in plain words and the step where they stopped", () => {
    const skipped: RunReportLead = { ...base, status: "disqualified", reasonCodes: ["screen-failed", "restaurant, not a software business"], draft: null, gmailLink: null, score: null, components: null, pagesVisited: [], facts: [], factsGiven: null, factsKept: null, costUsd: null };
    const r = reportRow(skipped);
    expect(r["Decision"]).toBe("skipped");
    expect(r["Skip reason"]).toMatch(/does not look like a fit/i);
    expect(r["Skip reason"]).toContain("restaurant, not a software business");
    expect(r["Stopped at step"]).toBe("quick check");
    expect(r["Facts failed quote check"]).toBe("");
    expect(r["Email body"]).toBe("");
    expect(reportRow({ ...skipped, reasonCodes: ["draft-failed", "W4: exclamation mark"] })["Email quality"]).toBe("failed: W4: exclamation mark");
  });

  it("shows the search query only for web leads, and decides test runs", () => {
    const web = reportRow({ ...base, leadSource: "web_discovery", sourceDetail: "fintech agency India" });
    expect(web["Source"]).toBe("Web discovery (Google)");
    expect(web["Search query"]).toBe("fintech agency India");
    expect(reportRow({ ...base, leadSource: "import:apollo-pull-1a2b" })["Source"]).toBe("Apollo search");
    expect(decisionOf({ status: "scored", wouldApprove: true })).toBe("would be approved (test run)");
    expect(decisionOf({ status: "scored", wouldApprove: false })).toBe("not decided yet");
  });

  it("names the step of every skip reason", () => {
    expect(stepOfReason("screen-failed")).toBe("quick check");
    expect(stepOfReason("no-data", "homepage did not open (503)")).toBe("quick check");
    expect(stepOfReason("no-data", "no readable page or search result")).toBe("research");
    expect(stepOfReason("extraction-suspect")).toBe("research");
    expect(stepOfReason("below-threshold")).toBe("approve");
    expect(stepOfReason("suppressed")).toBe("clean");
    expect(stepOfReason("no-contact")).toBe("clean");
    expect(stepOfReason("bad-email")).toBe("reveal and verify");
    expect(stepOfReason("draft-failed")).toBe("write");
    expect(stepOfReason("step-failed", "research: timeout")).toBe("research");
    expect(emailQualityOf({ draft: null, reasonCodes: [] })).toBe("");
  });
});

describe("run report CSV file", () => {
  it("starts with a byte order mark, and has a header row of exactly the columns", () => {
    const csv = runReportCsv([base]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")[0]).toBe(RUN_REPORT_COLUMNS.map((c) => (/[",]/.test(c) ? `"${c}"` : c)).join(","));
  });

  it("protects cells that start with = + - or @ against formulas", () => {
    const csv = runReportCsv([{ ...base, firstName: "=HYPERLINK(\"http://evil\")", jobTitle: "+1 director", companyName: "-cmd", quickCheck: { fit: "yes", reason: "@SUM(A1)" } }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1 director");
    expect(csv).toContain("'-cmd");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/);
  });

  it("keeps a multi-line draft in one quoted cell and doubles quotes", () => {
    const csv = runReportCsv([{ ...base, draft: { subject: 'Say "hi"', body: "Line 1\nLine 2, with comma", attempts: 1 } }]);
    expect(csv).toContain('"Line 1\nLine 2, with comma"');
    expect(csv).toContain('"Say ""hi"""');
    // one header line + one data record (the data record contains a newline inside quotes, so count records by parsing quotes)
    const rows: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of csv.slice(1)) {
      if (ch === '"') q = !q;
      if (ch === "\n" && !q && cur.endsWith("\r")) {
        rows.push(cur.slice(0, -1));
        cur = "";
      } else cur += ch;
    }
    expect(rows).toHaveLength(2);
  });

  it("names the file after the day and the run", () => {
    expect(runReportFileName("88d20add-1111-2222-3333-444455556666", new Date("2026-10-28T10:00:00Z"))).toBe("run-report-2026-10-28-88d20add.csv");
  });
});

describe("quick-check prompt", () => {
  const p = buildScreenPrompt({ name: "Acme", domain: "acme.io" }, "saas, fintech", "We build apps.", { name: "White-label development", description: "extra developers for agencies" });

  it("judges against the target industries AND the offer", () => {
    expect(p.prompt).toContain("MARKET:saas, fintech");
    expect(p.prompt).toContain("OFFER: White-label development - extra developers for agencies");
    expect(p.prompt.split("\n")[0]).toBe("Company: Acme (acme.io)");
    expect(buildScreenPrompt({ name: "A", domain: "a.io" }, "", "x").prompt).toContain("OFFER: white-label web and app development");
  });

  it("only answers no for a clearly unrelated business; doubt means uncertain", () => {
    expect(p.system).toMatch(/when in doubt, answer "uncertain", never "no"/);
    expect(p.system).toMatch(/"no" ONLY when the business is clearly unrelated/);
    expect(p.system).toMatch(/agency or studio/);
  });
});
