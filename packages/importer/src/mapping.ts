export const CANONICAL_FIELDS = [
  { key: "full_name", label: "Full name" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "job_title", label: "Job title" },
  { key: "email", label: "Email" },
  { key: "profile_url", label: "Profile URL (LinkedIn etc., from your file)" },
  { key: "company_name", label: "Company name" },
  { key: "company_domain", label: "Company website / domain" },
  { key: "country", label: "Country" },
  { key: "industry", label: "Industry" },
  { key: "employee_count", label: "Employee count" },
  { key: "email_status", label: "Email status (from your source)" },
  { key: "lead_source", label: "Lead source" },
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number]["key"];

/** field -> header text in the file. Stored on the batch and in saved templates. */
export interface Mapping {
  fields: Partial<Record<CanonicalField, string>>;
  /** undefined = auto-detect; set when the user overrides the guess */
  firstRowIsHeader?: boolean;
}

/** "First Name", "first_name", "FNAME", "# Employees" -> comparable key */
export function headerKey(h: string): string {
  return h
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const ALIASES: Record<CanonicalField, string[]> = {
  first_name: ["firstname", "fname", "givenname", "first", "forename"],
  last_name: ["lastname", "lname", "surname", "familyname", "last"],
  full_name: ["fullname", "name", "contactname", "personname", "contact", "leadname"],
  job_title: ["jobtitle", "title", "position", "role", "designation", "jobposition", "jobrole"],
  email: ["email", "emailaddress", "workemail", "businessemail", "mail", "emailid", "primaryemail", "eaddress"],
  profile_url: ["personlinkedinurl", "linkedinurl", "linkedinprofile", "linkedinprofileurl", "linkedin", "profileurl", "profile"],
  company_name: ["company", "companyname", "organization", "organisation", "organizationname", "account", "accountname", "employer", "companynameforemails"],
  company_domain: ["website", "companywebsite", "companydomain", "domain", "organizationwebsite", "companyurl", "websiteurl", "web", "url"],
  country: ["country", "personcountry", "companycountry", "countryregion"],
  industry: ["industry", "sector", "vertical", "companyindustry"],
  employee_count: ["employees", "numberofemployees", "employeecount", "companysize", "noofemployees", "headcount", "staffcount", "size"],
  email_status: ["emailstatus", "emailverificationstatus", "verificationstatus"],
  lead_source: ["leadsource", "source", "origin"],
};

/** Picks, for every field, the first header whose normalised text matches an alias (earlier alias = stronger). */
export function autoDetectMapping(headers: string[]): Mapping {
  const keyed = headers.map((h) => ({ h, k: headerKey(h) }));
  const used = new Set<string>();
  const fields: Mapping["fields"] = {};
  // Most specific fields first so "Company Name" is not swallowed by the generic "name" of full_name.
  const order: CanonicalField[] = ["email", "profile_url", "company_domain", "company_name", "first_name", "last_name", "job_title", "email_status", "employee_count", "country", "industry", "lead_source", "full_name"];
  for (const field of order) {
    for (const alias of ALIASES[field]) {
      const hit = keyed.find((x) => x.k === alias && !used.has(x.h));
      if (hit) {
        fields[field] = hit.h;
        used.add(hit.h);
        break;
      }
    }
  }
  return { fields };
}

/** Column titles of an Apollo.io people export. */
export const APOLLO_PRESET: Partial<Record<CanonicalField, string[]>> = {
  first_name: ["First Name"],
  last_name: ["Last Name"],
  job_title: ["Title"],
  email: ["Email"],
  email_status: ["Email Status"],
  profile_url: ["Person Linkedin Url"],
  company_name: ["Company", "Company Name for Emails"],
  company_domain: ["Website"],
  country: ["Country", "Company Country"],
  industry: ["Industry"],
  employee_count: ["# Employees"],
};

export const PRESETS = { apollo: { label: "Apollo export", fields: APOLLO_PRESET } } as const;
export type PresetName = keyof typeof PRESETS;

export function applyPreset(headers: string[], preset: PresetName): Mapping {
  const byKey = new Map(headers.map((h) => [headerKey(h), h]));
  const fields: Mapping["fields"] = {};
  for (const [field, titles] of Object.entries(PRESETS[preset].fields) as [CanonicalField, string[]][]) {
    for (const t of titles) {
      const h = byKey.get(headerKey(t));
      if (h) {
        fields[field] = h;
        break;
      }
    }
  }
  return { fields };
}

/** True when enough Apollo-specific columns are present to suggest the preset. */
export function looksLikeApollo(headers: string[]): boolean {
  const keys = new Set(headers.map(headerKey));
  return ["personlinkedinurl", "emailstatus", "companynameforemails", "employees", "seniority"].filter((k) => keys.has(k)).length >= 2;
}

/** Problems that make a mapping unusable for this file. Empty = OK. */
export function validateMapping(mapping: Mapping, headers: string[], opts: { requireEmail: boolean }): string[] {
  const errors: string[] = [];
  const set = new Set(headers);
  for (const [field, header] of Object.entries(mapping.fields)) {
    if (header && !set.has(header)) errors.push(`The column "${header}" mapped to ${field} is not in this file.`);
  }
  const f = mapping.fields;
  if (opts.requireEmail && !f.email) errors.push("Map an Email column (or turn on research-first for the campaign to import rows without email).");
  if (!f.email && !f.profile_url && !(f.company_name || f.company_domain)) {
    errors.push("Map at least an Email, a Profile URL, or a Company column so rows can be identified.");
  }
  if (!f.full_name && !f.first_name) errors.push("Map a Full name or a First name column.");
  const targets = Object.values(mapping.fields).filter(Boolean) as string[];
  const dup = targets.find((t, i) => targets.indexOf(t) !== i);
  if (dup) errors.push(`The column "${dup}" is mapped to more than one field.`);
  return errors;
}
