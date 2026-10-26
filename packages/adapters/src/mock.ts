import type {
  Adapters,
  ApolloAdapter,
  CrunchbaseAdapter,
  FetcherAdapter,
  GmailAdapter,
  GmailSender,
  LlmAdapter,
  SearchAdapter,
  VerifierAdapter,
} from "./types";

/** Deterministic, offline mock adapters. They never touch the network. */

export const mockLlm: LlmAdapter = {
  async complete(req) {
    const text = `[mock ${req.tier}] ${req.prompt.slice(0, 80)}`;
    return {
      text,
      model: `mock-${req.tier}`,
      usage: { units: { input_token: Math.ceil(req.prompt.length / 4), output_token: Math.ceil(text.length / 4) } },
    };
  },
};

export const mockSearch: SearchAdapter = {
  async search({ query, num = 3 }) {
    const slug = encodeURIComponent(query.toLowerCase().replace(/\s+/g, "-")).slice(0, 40);
    const results = Array.from({ length: num }, (_, i) => ({
      title: `Mock result ${i + 1} for ${query}`,
      url: `https://news.example.com/${slug}/${i + 1}`,
      snippet: `Mock snippet ${i + 1} about ${query}.`,
      publishedAt: "2026-09-01",
    }));
    return { results, usage: { units: { search: 1 } } };
  },
};

export const mockFetcher: FetcherAdapter = {
  async fetchPage(url) {
    return { url, status: 200, text: `Mock page content for ${url}`, retrievedAt: new Date().toISOString() };
  },
};

export const mockCrunchbase: CrunchbaseAdapter = {
  async lookupOrganization(domain) {
    return {
      org: {
        domain,
        name: domain.split(".")[0] ?? domain,
        lastFundingType: "series_a",
        lastFundingDate: "2026-08-15",
        lastFundingUsd: 5_000_000,
        sourceUrl: `https://crunchbase.example.com/organization/${domain}`,
      },
      usage: { units: { lookup: 1 } },
    };
  },
};

export const mockApollo: ApolloAdapter = {
  async revealEmail({ firstName, lastName, domain }) {
    return { email: `${firstName}.${lastName}@${domain}`.toLowerCase(), usage: { units: { credit: 1 } } };
  },
};

/** Status is decided by the local part so tests can pick an outcome. */
export const mockVerifier: VerifierAdapter = {
  async verify(email) {
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    const status = local.includes("invalid")
      ? "invalid"
      : local.includes("risky")
        ? "risky"
        : local.includes("catchall")
          ? "catch_all"
          : "valid";
    return { status, usage: { units: { verification: 1 } } };
  },
};

export function createMockGmail(): GmailAdapter & { drafts: Map<string, { to: string; subject: string; bodyText: string }> } {
  const drafts = new Map<string, { to: string; subject: string; bodyText: string }>();
  return {
    drafts,
    async createDraft(req) {
      const draftId = `mock-draft-${drafts.size + 1}`;
      drafts.set(draftId, { to: req.to, subject: req.subject, bodyText: req.bodyText });
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
      return { messageId: `mock-msg-${sent.length}`, threadId: `mock-thread-${sent.length}` };
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
