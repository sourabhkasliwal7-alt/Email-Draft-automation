import type {
  Adapters,
  ApolloAdapter,
  ApolloPerson,
  CrunchbaseAdapter,
  FetcherAdapter,
  GmailAdapter,
  GmailSender,
  LlmAdapter,
  SearchAdapter,
  VerifierAdapter,
} from "./types";

/** Deterministic, offline mock adapters. They never touch the network. */

// ---------------------------------------------------------------- fetcher
/** "acme-01.example.com" -> "Acme 01" */
export function companyNameFromHost(host: string): string {
  const label = host.replace(/^www\./, "").split(".")[0] ?? host;
  return label
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Pages look like real small-company sites. Hosts starting with "down-" answer 503, "empty-" serve a JS-only shell
 * with no text, and "other-" redirect to another domain, so every research edge case can be exercised offline.
 */
export const mockFetcher: FetcherAdapter = {
  async fetchPage(url) {
    const u = new URL(url);
    const retrievedAt = new Date().toISOString();
    const name = companyNameFromHost(u.hostname);
    if (u.hostname.startsWith("down-")) return { url, status: 503, text: "", retrievedAt };
    if (u.hostname.startsWith("empty-")) return { url, status: 200, text: "", retrievedAt };
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const text: Record<string, string> = {
      "/": `${name} builds workflow software for logistics and retail operations teams. Founded in 2019, ${name} serves customers across India and the US.`,
      "/about": `About ${name}. ${name} helps operations teams automate manual reporting. The team of 120 people is based in Bengaluru.`,
      "/careers": `Careers at ${name}. We are hiring: Senior Operations Analyst, Data Engineer and Customer Success Manager. Open roles are updated weekly.`,
    };
    const body = text[path];
    return body ? { url, status: 200, text: body, retrievedAt } : { url, status: 404, text: "", retrievedAt };
  },
};

// ---------------------------------------------------------------- search
export const mockSearch: SearchAdapter = {
  async search({ query, num = 3 }) {
    // "<company> funding" style queries; company = everything before the last word
    const words = query.trim().split(/\s+/);
    const company = words.length > 1 ? words.slice(0, -1).join(" ") : query;
    const slug = encodeURIComponent(company.toLowerCase().replace(/\s+/g, "-")).slice(0, 40);
    const results = [
      { title: `${company} announces seed funding round`, url: `https://news.example.com/${slug}/funding`, snippet: `${company} announced a seed funding round to expand its operations platform.`, publishedAt: "2026-09-01" },
      { title: `${company} is hiring across operations`, url: `https://news.example.com/${slug}/hiring`, snippet: `${company} is hiring analysts and engineers as it grows.`, publishedAt: "2026-09-15" },
      { title: `Unrelated page about something else`, url: `https://news.example.com/${slug}/other`, snippet: `A general article about logistics trends.`, publishedAt: "2026-08-01" },
    ].slice(0, num);
    return { results, usage: { units: { search: 1 } } };
  },
};

// ---------------------------------------------------------------- crunchbase
export const mockCrunchbase: CrunchbaseAdapter = {
  async lookupOrganization(domain) {
    return {
      org: { domain, name: domain.split(".")[0] ?? domain, lastFundingType: "series_a", lastFundingDate: "2026-08-15", lastFundingUsd: 5_000_000, sourceUrl: `https://crunchbase.example.com/organization/${domain}` },
      usage: { units: { lookup: 1 } },
    };
  },
};

// ---------------------------------------------------------------- apollo
const FIRST = ["Asha", "Ben", "Chen", "Dev", "Elif", "Farah", "Gita", "Hugo", "Ila", "Jan"];
const LAST = ["Rao", "Miller", "Wu", "Shah", "Kaya", "Noor", "Iyer", "Costa", "Das", "Novak"];
const TITLES = ["COO", "Head of Operations", "VP Operations", "CTO", "Marketing Manager"];
const INDUSTRIES = ["logistics", "saas", "retail"];
export const MOCK_APOLLO_TOTAL = 60;
const PAGE_SIZE = 25;

/** 60 deterministic people over 20 companies. No email is included, exactly like a real Apollo search. */
export function mockApolloPeople(): ApolloPerson[] {
  return Array.from({ length: MOCK_APOLLO_TOTAL }, (_, i) => {
    const company = i % 20;
    const domain = i % 17 === 16 ? null : `apollo-co-${String(company).padStart(2, "0")}.example.com`;
    return {
      id: `apollo-mock-${String(i).padStart(3, "0")}`,
      firstName: FIRST[i % FIRST.length]!,
      lastName: `${LAST[(i * 3) % LAST.length]!}${i}`,
      title: TITLES[i % TITLES.length]!,
      linkedinUrl: `https://linkedin.com/in/apollo-mock-${i}`,
      country: i % 3 === 0 ? "US" : "IN",
      organization: { name: `Apollo Co ${company}`, domain, industry: INDUSTRIES[company % INDUSTRIES.length]!, employeeCount: 20 + company * 25 },
    };
  });
}

/** every reveal call the mock received, so tests can prove the request flags (no phone, no personal email, no waterfall) */
export const mockRevealLog: { personId: string; flags: unknown }[] = [];

export const mockApollo: ApolloAdapter = {
  async searchPeople(filters, page) {
    const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
    const all = mockApolloPeople().filter((p) => {
      if (filters.titles.length && !filters.titles.some((t) => lc(p.title).includes(lc(t)))) return false;
      if (filters.keywords.length && !filters.keywords.some((k) => lc(p.organization?.industry).includes(lc(k)))) return false;
      if (filters.locations.length && !filters.locations.some((l) => lc(p.country) === lc(l))) return false;
      const n = p.organization?.employeeCount ?? null;
      if (n != null && ((filters.employeeMin != null && n < filters.employeeMin) || (filters.employeeMax != null && n > filters.employeeMax))) return false;
      return true;
    });
    const per = filters.perPage ?? PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(all.length / per));
    const people = all.slice((page - 1) * per, page * per);
    return { people, page, totalPages, totalEntries: all.length, usage: { units: { call: 1 } } };
  },
  async getOrganization(domain) {
    const name = companyNameFromHost(domain);
    return { org: { name, domain, industry: "saas", employeeCount: 80, country: "IN" }, usage: { units: { call: 1 } } };
  },
  /** Every 7th person has no revealable email, so the "no email" path is exercised. */
  async revealEmail({ personId, flags }) {
    mockRevealLog.push({ personId, flags });
    const n = Number(personId.replace(/\D/g, ""));
    const p = mockApolloPeople()[n];
    if (!p || n % 7 === 6 || !p.organization?.domain) return { email: null, usage: { units: { credit: 0 } } };
    return { email: `${p.firstName}.${p.lastName}@${p.organization.domain}`.toLowerCase(), usage: { units: { credit: 1 } } };
  },
};

// ---------------------------------------------------------------- verifier
/** Status is decided by the local part so tests can pick an outcome. */
export const mockVerifier: VerifierAdapter = {
  async verify(email) {
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    const status = local.includes("invalid") ? "invalid" : local.includes("risky") ? "risky" : local.includes("catchall") ? "catch_all" : "valid";
    return { status, usage: { units: { verification: 1 } } };
  },
};

// ---------------------------------------------------------------- llm
const SOURCE_RE = /SOURCE (\d+) url=(\S+)\n([\s\S]*?)\nEND SOURCE/g;
const EVIDENCE_RE = /^EVIDENCE (\S+): (.+)$/gm;

function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]?/g) ?? []).map((s) => s.trim()).filter((s) => s.length > 20);
}

/**
 * A deterministic stand-in for the model. It follows the same prompt contracts as the real one ([task:extract],
 * [task:draft], [task:check]) so the pipeline, guards and checks run unchanged: it only ever quotes text it was given.
 */
export const mockLlm: LlmAdapter = {
  async complete(req) {
    const task = /\[task:(extract|draft|check|screen|facts|write|check_email)\]/.exec(`${req.system ?? ""}\n${req.prompt}`)?.[1];
    let text: string;
    if (task === "extract") {
      const items: { type: string; description: string; source_url: string; snippet: string }[] = [];
      for (const m of req.prompt.matchAll(SOURCE_RE)) {
        const [, , url, body] = m;
        for (const s of sentences(body!)) {
          const l = s.toLowerCase();
          const type = l.includes("hiring") ? "hiring" : l.includes("funding") || l.includes("raised") ? "funding" : l.includes("founded") || l.includes("serves") || l.includes("builds") ? "other" : null;
          if (type) items.push({ type, description: s, source_url: url!, snippet: s });
        }
      }
      // the mock "model" also invents one fact so the anti-hallucination guard has something to drop
      if (req.prompt.includes("[mock:hallucinate]")) items.push({ type: "funding", description: "Raised $500M", source_url: "https://invented.example.com/", snippet: "raised $500M from a famous fund" });
      text = JSON.stringify({ items });
    } else if (task === "draft") {
      const get = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(req.prompt)?.[1]?.trim() ?? "";
      const ev = [...req.prompt.matchAll(EVIDENCE_RE)].map((m) => ({ id: m[1]!, snippet: m[2]! }));
      const first = get("FIRST_NAME");
      const company = get("COMPANY");
      const cta = get("CTA") || "Open to a quick call next week?";
      const used = ev.slice(0, 2);
      const lines = [first ? `Hi ${first},` : "Hello,", ""];
      if (used.length) lines.push(`I came across this about ${company}: "${used[0]!.snippet}"`);
      else lines.push(`I have been reading about ${company} and its work.`);
      lines.push("", `We help teams like yours cut manual operations work with a fixed-scope audit, and I thought it could be relevant to ${get("JOB_TITLE") || "your team"}.`, "", cta, "", get("SIGNATURE") || "Best regards");
      text = JSON.stringify({ subject: `Quick idea for ${company}`, body_text: lines.join("\n"), facts_used: used.map((e) => ({ claim: e.snippet, evidence_id: e.id })) });
    } else if (task === "check") {
      const ev = [...req.prompt.matchAll(EVIDENCE_RE)].map((m) => m[2]!);
      const claims = [...req.prompt.matchAll(/^CLAIM \d+: (.+)$/gm)].map((m) => m[1]!);
      const flags = claims.filter((c) => !ev.some((e) => e.includes(c) || c.includes(e))).map((c) => `Claim not supported by evidence: ${c}`);
      text = JSON.stringify({ pass: flags.length === 0, flags });
    } else if (task === "screen") {
      const dom = /Company: .*\((\S+)\)/.exec(req.prompt)?.[1] ?? "";
      const fit = dom.startsWith("nofit-") ? "no" : dom.startsWith("maybe-") ? "uncertain" : "yes";
      text = JSON.stringify({ fit, business_type: "software agency", reason: fit === "yes" ? "builds software for operations teams" : "does not look like a software business" });
    } else if (task === "facts") {
      const facts: { type: string; statement: string; source_url: string; quote: string; date: null }[] = [];
      let devRoles: string[] = [];
      for (const m of req.prompt.matchAll(SOURCE_RE)) {
        const [, , url, body] = m;
        const clean = body!.replace(/<\/?data>/g, "");
        for (const s of sentences(clean)) {
          if (s.includes("?")) continue;
          const l = s.toLowerCase();
          const type = l.includes("hiring") ? "hiring" : l.includes("funding") || l.includes("raised") ? "funding" : l.includes("builds") || l.includes("helps") ? "service-detail" : null;
          if (!type) continue;
          const quote = s.split(/\s+/).slice(0, 25).join(" ");
          facts.push({ type, statement: s, source_url: url!, quote, date: null });
          if (type === "hiring" && /engineer|developer/i.test(s)) devRoles = ["Data Engineer"];
        }
      }
      // invented facts, so the exact-quote check has something to reject
      if (req.prompt.includes("[mock:hallucinate]")) facts.push({ type: "funding", statement: "Raised a big round", source_url: "https://invented.example.com/", quote: "raised five hundred million from a famous fund", date: null });
      if (req.prompt.includes("(apollo-co-07.")) for (let i = 0; i < 6; i++) facts.push({ type: "award", statement: "Won an award", source_url: "https://invented.example.com/", quote: `won the best workplace award ${i} years in a row`, date: null });
      text = JSON.stringify({ facts, business_type: "software agency", developer_roles_open: devRoles, best_fact_index: facts.findIndex((f) => f.type === "hiring") });
    } else if (task === "write") {
      const get = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(req.prompt)?.[1]?.trim() ?? "";
      const fact = /^FACT (\S+): (.*?) \| QUOTE: (.*)$/m.exec(req.prompt);
      const first = get("FIRST_NAME");
      const company = get("COMPANY");
      // "Badwrite" companies get a bad first attempt (fixed on the rewrite); "Failwrite" ones never get fixed
      const bad = company.includes("Badwrite") && (!req.prompt.includes("FIX THESE PROBLEMS") || company.includes("Failwrite"));
      const lines = [
        `Hi ${first},`,
        "",
        fact ? `I read this on the ${company} site: "${fact[3]}"` : "I have been reading about your company.",
        "",
        "How do you handle development work today when your own team is already at capacity?",
        "",
        "We work with small software teams that want extra delivery capacity without adding permanent headcount.",
        get("TOOLS"),
        get("WHITE_LABEL_LINE"),
        "",
        bad ? "Happy to share an example, you will love it!" : "Happy to share an example of how that works if it is useful.",
        "",
        get("SENDER_FIRST_NAME"),
        "Nuance Infotech",
      ];
      text = JSON.stringify({ subject: `idea for ${company}`, body: lines.join("\n"), fact_ids_used: fact ? [fact[1]] : [] });
    } else if (task === "check_email") {
      const wl = /^WHITE_LABEL_LINE: (.*)$/m.exec(req.prompt)?.[1] ?? "";
      const body = req.prompt.split("EMAIL BODY:")[1] ?? "";
      const two = (ok: boolean) => (ok ? 2 : 0);
      text = JSON.stringify({ scores: { one_true_detail: 2, process_question: two(body.includes("?")), tools_for_their_industry: 2, white_label_line: two(Boolean(wl) && body.includes(wl)), soft_ask: 2, human_tone: two(!body.includes("!")) }, problems: [] });
    } else {
      text = `[mock ${req.tier}] ${req.prompt.slice(0, 80)}`;
    }
    return { text, model: `mock-${req.tier}`, usage: { units: { input_token: Math.ceil(req.prompt.length / 4), output_token: Math.ceil(text.length / 4) } } };
  },
};

// ---------------------------------------------------------------- gmail
export function createMockGmail(): GmailAdapter & { drafts: Map<string, { to: string; subject: string; bodyText: string; label?: string }> } {
  const drafts = new Map<string, { to: string; subject: string; bodyText: string; label?: string }>();
  return {
    drafts,
    async createDraft(req) {
      const draftId = `mock-draft-${drafts.size + 1}-${Math.random().toString(36).slice(2, 7)}`;
      drafts.set(draftId, { to: req.to, subject: req.subject, bodyText: req.bodyText, label: req.label });
      return { draftId, messageIdHeader: `<${draftId}@mock.invalid>` };
    },
    async listReplies() {
      return [];
    },
  };
}

/** Records "sent" messages in memory only. A real email can never leave through this class. */
export function createMockGmailSender(): GmailSender & { sent: { inboxId: string; draftId: string }[] } {
  const sent: { inboxId: string; draftId: string }[] = [];
  return {
    sent,
    async sendDraft(req) {
      sent.push(req);
      return { messageId: `mock-msg-${sent.length}-${Math.random().toString(36).slice(2, 7)}`, threadId: `mock-thread-${sent.length}` };
    },
  };
}

export function createMockAdapters(): Adapters {
  return {
    llm: mockLlm,
    search: mockSearch,
    fetcher: mockFetcher,
    crunchbase: mockCrunchbase,
    apollo: mockApollo,
    verifier: mockVerifier,
    gmail: createMockGmail(),
    gmailSender: createMockGmailSender(),
  };
}
