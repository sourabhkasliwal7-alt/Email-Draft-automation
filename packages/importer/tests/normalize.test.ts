import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KeyIndex,
  applyPreset,
  autoDetectMapping,
  buildErrorCsv,
  classifyRow,
  dedupeKeys,
  looksLikeApollo,
  normalizeRow,
  readTable,
  validateMapping,
  validateRow,
  type ExistingContact,
  type ImportMode,
  type NormalizedRow,
  type PlanContext,
} from "../src";

const fx = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(join(__dirname, "../../../tests/fixtures/imports", name))) });
const objects = (t: Awaited<ReturnType<typeof readTable>>) => t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i]!])));

describe("column mapping", () => {
  it("auto-detects aliases across spellings", () => {
    const m = autoDetectMapping(["FName", "L_Name", "E-mail", "Organization", "Company Website", "Job Title", "# Employees", "Source"]);
    expect(m.fields).toMatchObject({
      first_name: "FName",
      last_name: "L_Name",
      email: "E-mail",
      company_name: "Organization",
      company_domain: "Company Website",
      job_title: "Job Title",
      employee_count: "# Employees",
      lead_source: "Source",
    });
  });

  it("does not let a generic Name column swallow Company Name", () => {
    const m = autoDetectMapping(["Name", "Company Name", "Email"]);
    expect(m.fields).toMatchObject({ full_name: "Name", company_name: "Company Name", email: "Email" });
  });

  it("recognises an Apollo export and maps it with the preset", async () => {
    const t = await readTable(fx("apollo-export.csv"));
    expect(looksLikeApollo(t.headers)).toBe(true);
    const m = applyPreset(t.headers, "apollo");
    expect(m.fields).toMatchObject({
      first_name: "First Name",
      job_title: "Title",
      email: "Email",
      email_status: "Email Status",
      profile_url: "Person Linkedin Url",
      company_name: "Company",
      company_domain: "Website",
      employee_count: "# Employees",
    });
  });

  it("explains unusable mappings", () => {
    const headers = ["Name", "Email"];
    expect(validateMapping({ fields: { full_name: "Name", email: "Email" } }, headers, { requireEmail: true })).toEqual([]);
    expect(validateMapping({ fields: { full_name: "Name" } }, headers, { requireEmail: true }).join(" ")).toMatch(/Map an Email column/);
    expect(validateMapping({ fields: { full_name: "Gone", email: "Email" } }, headers, { requireEmail: true }).join(" ")).toMatch(/"Gone".*not in this file/);
    expect(validateMapping({ fields: { full_name: "Name", first_name: "Name", email: "Email" } }, headers, { requireEmail: true }).join(" ")).toMatch(/more than one field/);
    expect(validateMapping({ fields: { email: "Email" } }, headers, { requireEmail: true }).join(" ")).toMatch(/Full name or a First name/);
  });
});

describe("normalisation", () => {
  it("cleans messy emails, keeps the original casing for display, and lowercases for uniqueness", async () => {
    const t = await readTable(fx("messy-emails.csv"));
    const m = autoDetectMapping(t.headers);
    const n = objects(t).map((r) => normalizeRow(r, m));

    expect(n[0]).toMatchObject({ first_name: "Jane", last_name: "Doe", full_name: "Jane Doe", email: "Jane.DOE@Acme.COM", email_lower: "jane.doe@acme.com", company_domain: "acme.example.com", employee_count: 2000 });
    expect(n[1]).toMatchObject({ email_lower: "bob@mu.example.com", employee_count: 1500 });
    expect(n[2]).toMatchObject({ email_lower: "cy@nu.example.com", employee_count: 50 });
    expect(n[2]!.warnings.join(" ")).toMatch(/Spaces were removed/);
    expect(n[3]).toMatchObject({ email_lower: "a@xi.example.com", employee_count: null });
    expect(n[3]!.warnings.join(" ")).toMatch(/Several emails/);
    expect(n[3]!.warnings.join(" ")).toMatch(/Employee count "abc"/);
    expect(n[4]).toMatchObject({ email_lower: null, emailInvalid: true });
    // a free-mail address and a LinkedIn "website" never become a company domain
    expect(n[5]).toMatchObject({ email_lower: "flo@gmail.com", company_domain: null });
    expect(n[5]!.warnings.join(" ")).toMatch(/not a company website/);
  });

  it("maps Apollo data: statuses, LinkedIn URL cleanup, employee counts", async () => {
    const t = await readTable(fx("apollo-export.csv"));
    const m = applyPreset(t.headers, "apollo");
    const [a, b, c] = objects(t).map((r) => normalizeRow(r, m, { leadSource: "apollo" }));
    expect(a).toMatchObject({ email_status: "valid", profile_url: "https://linkedin.com/in/lia-moss", employee_count: 1200, company_domain: "iota.example.com", country: "India", lead_source: "apollo" });
    expect(b).toMatchObject({ email_status: "risky", profile_url: "https://linkedin.com/in/max-dahl", employee_count: 55 });
    expect(c).toMatchObject({ email_status: "invalid", employee_count: null });
    expect(c!.warnings.join(" ")).toMatch(/not a single number/);
    expect(validateRow(c!, { requireEmail: true }).join(" ")).toMatch(/invalid or bounced/);
    expect(validateRow(a!, { requireEmail: true })).toEqual([]);
  });

  it("collapses whitespace and strips zero-width characters", () => {
    const n = normalizeRow({ N: "  Ann    Lee​ ", E: " X@Y.com " }, { fields: { full_name: "N", email: "E" } });
    expect(n.full_name).toBe("Ann Lee");
    expect(n.email_lower).toBe("x@y.com");
  });
});

describe("campaign validation", () => {
  it("no email: invalid unless the campaign is research-first AND the row can still be identified", async () => {
    const t = await readTable(fx("research-first.csv"));
    const m = autoDetectMapping(t.headers);
    expect(t.rows).toHaveLength(2); // the ",," row is blank
    const n = objects(t).map((r) => normalizeRow(r, m));
    expect(validateRow(n[0]!, { requireEmail: true })[0]).toMatch(/Email is required/);
    expect(validateRow(n[0]!, { requireEmail: false })).toEqual([]);
    expect(validateRow(n[1]!, { requireEmail: false })).toEqual([]); // name + company
    const bare = normalizeRow({ N: "Zed" }, { fields: { full_name: "N" } });
    expect(validateRow(bare, { requireEmail: false })[0]).toMatch(/profile URL, or a name plus a company/);
  });

  it("a malformed email is an error whatever the campaign says", () => {
    const n = normalizeRow({ N: "Zed", E: "nope" }, { fields: { full_name: "N", email: "E" } });
    expect(validateRow(n, { requireEmail: false }).join(" ")).toMatch(/is not a valid email/);
  });
});

function row(over: Partial<NormalizedRow>): NormalizedRow {
  return {
    first_name: "Ann", last_name: "Lee", full_name: "Ann Lee", job_title: null, email: null, email_lower: null, profile_url: null,
    company_name: null, company_domain: null, country: null, industry: null, employee_count: null, email_status: "unknown",
    lead_source: null, warnings: [], emailInvalid: false, data_flags: [], ...over,
  };
}

function ctx(mode: ImportMode, extra: Partial<PlanContext> = {}, existing: [Partial<NormalizedRow>, ExistingContact][] = []): PlanContext {
  const idx = new KeyIndex<ExistingContact>();
  for (const [n, c] of existing) idx.add(dedupeKeys(row(n)), c);
  return { mode, rules: { requireEmail: true }, suppression: { emails: new Set(), domains: new Set() }, seen: new KeyIndex<number>(), existing: idx, ...extra };
}

describe("duplicates and suppression", () => {
  it("dedupes inside the file by email, then profile URL, then company + name (accent/case-insensitive)", () => {
    const c = ctx("add_new", { rules: { requireEmail: false } });
    expect(classifyRow(row({ email_lower: "a@x.com" }), 2, c).status).toBe("imported");
    const byEmail = classifyRow(row({ email_lower: "a@x.com", full_name: "Other" }), 3, c);
    expect(byEmail).toMatchObject({ status: "duplicate", matchedBy: "email", duplicateOf: 2 });
    expect(classifyRow(row({ profile_url: "https://linkedin.com/in/ann" }), 4, c).status).toBe("imported");
    expect(classifyRow(row({ profile_url: "https://linkedin.com/in/ann", full_name: "Zed" }), 5, c)).toMatchObject({ status: "duplicate", matchedBy: "profile_url" });
    expect(classifyRow(row({ full_name: "José Álvarez", company_domain: "z.com" }), 6, c).status).toBe("imported");
    expect(classifyRow(row({ full_name: "jose alvarez", company_domain: "z.com" }), 7, c)).toMatchObject({ status: "duplicate", matchedBy: "company_and_name" });
    expect(classifyRow(row({ full_name: "jose alvarez", company_domain: "other.com" }), 8, c).status).toBe("imported");
  });

  it("an invalid first occurrence does not block a later valid row for the same person", () => {
    const c = ctx("add_new");
    expect(classifyRow(row({ email_lower: null, email: "bad", emailInvalid: true }), 2, c).status).toBe("invalid");
    expect(classifyRow(row({ email_lower: "a@x.com" }), 3, c).status).toBe("imported");
  });

  it("flags suppressed emails and domains at import, even when they would also be duplicates", () => {
    const suppression = { emails: new Set(["no@x.com"]), domains: new Set(["blocked.com"]) };
    const c = ctx("add_new", { suppression });
    expect(classifyRow(row({ email_lower: "no@x.com" }), 2, c)).toMatchObject({ status: "suppressed" });
    expect(classifyRow(row({ email_lower: "any@blocked.com", company_domain: "blocked.com" }), 3, c).messages[0]).toMatch(/Domain blocked.com/);
    expect(classifyRow(row({ email_lower: "ok@fine.com" }), 4, c).status).toBe("imported");
    expect(classifyRow(row({ email_lower: "ok@fine.com" }), 5, c).status).toBe("duplicate");
  });

  it("an existing contact marked DNC is suppressed", () => {
    const c = ctx("update_existing", {}, [[{ email_lower: "d@x.com" }, { id: "1", dnc: true, inCampaign: false }]]);
    expect(classifyRow(row({ email_lower: "d@x.com" }), 2, c).status).toBe("suppressed");
  });

  it("modes: existing contact in the campaign / elsewhere", () => {
    const here: ExistingContact = { id: "1", dnc: false, inCampaign: true };
    const elsewhere: ExistingContact = { id: "2", dnc: false, inCampaign: false };
    const ex: [Partial<NormalizedRow>, ExistingContact][] = [[{ email_lower: "h@x.com" }, here], [{ email_lower: "e@x.com" }, elsewhere]];
    const r = (mode: ImportMode, email: string) => classifyRow(row({ email_lower: email }), 2, ctx(mode, {}, ex));

    expect(r("add_new", "h@x.com")).toMatchObject({ status: "duplicate", messages: ["Already in this campaign."] });
    expect(r("add_new", "e@x.com")).toMatchObject({ status: "imported", existing: elsewhere });
    expect(r("add_new", "n@x.com")).toMatchObject({ status: "imported", createContact: true });

    expect(r("update_existing", "h@x.com")).toMatchObject({ status: "updated", existing: here });
    expect(r("update_existing", "e@x.com")).toMatchObject({ status: "updated", existing: elsewhere });

    expect(r("skip_duplicates", "h@x.com").status).toBe("duplicate");
    expect(r("skip_duplicates", "e@x.com").status).toBe("skipped");
    expect(r("skip_duplicates", "n@x.com").status).toBe("imported");
  });
});

describe("error CSV", () => {
  it("includes the reason and original columns, and neutralises formula injection", () => {
    const csv = buildErrorCsv(
      [{ row_number: 7, status: "invalid", errors: ["Name is missing.", 'Email "x" is bad'], original: { Name: "=HYPERLINK(\"http://evil\")", Email: "+1@x", Note: "@cmd", Tab: "\tx" } }],
      ["Name", "Email", "Note", "Tab"],
    );
    expect(csv.startsWith("﻿row_number,status,errors,Name,Email,Note,Tab\r\n")).toBe(true);
    const body = csv.split("\r\n")[1]!;
    expect(body).toContain('"Name is missing. | Email ""x"" is bad"');
    expect(body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(body).toContain("'+1@x");
    expect(body).toContain("'@cmd");
    expect(body).not.toMatch(/(^|,)[=+@-]/);
  });
});

describe("Apollo / CSV email status and data flags", () => {
  const map = { fields: { first_name: "F", email: "E", email_status: "S", company_domain: "W" } };
  const status = (v: string) => normalizeRow({ F: "Ann", E: "ann@acme.io", S: v, W: "acme.io" }, map).email_status;

  it("maps a catch-all address to risky (a catch-all domain accepts anything), never to valid", () => {
    for (const v of ["Catch-all", "catch all", "Catch_All", "accept_all", "Accept All"]) expect(status(v), v).toBe("risky");
  });
  it("keeps valid only for what the source says it verified, and unchecked stays unknown", () => {
    expect(status("Verified")).toBe("valid");
    expect(status("Valid")).toBe("valid");
    expect(status("")).toBe("unknown");
    expect(status("Unavailable")).toBe("unknown");
    expect(status("Guessed")).toBe("risky");
    expect(status("Bounced")).toBe("invalid");
  });
  it("flags an email whose domain is not the company website: 'email domain mismatch'", () => {
    const flagged = normalizeRow({ F: "Ann", E: "ann@triniumsystems.com", W: "elkview.com" }, map);
    expect(flagged.data_flags).toEqual(["email domain mismatch"]);
    expect(flagged.warnings.join(" ")).toMatch(/Email domain mismatch: triniumsystems.com is not the company website elkview.com/);
    expect(normalizeRow({ F: "Ann", E: "ann@gmail.com", W: "elkview.com" }, map).data_flags).toEqual(["email domain mismatch"]);
  });
  it("does not flag the same site, a sub-domain either way, or a row without both", () => {
    for (const [email, site] of [["ann@acme.io", "https://www.acme.io/about"], ["ann@mail.acme.io", "acme.io"], ["ann@acme.io", "app.acme.io"]]) {
      expect(normalizeRow({ F: "Ann", E: email!, W: site! }, map).data_flags, `${email} / ${site}`).toEqual([]);
    }
    expect(normalizeRow({ F: "Ann", E: "ann@acme.io" }, { fields: { first_name: "F", email: "E" } }).data_flags).toEqual([]); // the website comes from the email: nothing to compare
    expect(normalizeRow({ F: "Ann", W: "acme.io" }, { fields: { first_name: "F", company_domain: "W" } }).data_flags).toEqual([]);
  });
});
