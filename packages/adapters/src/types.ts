/** Raw usage units for a call; cost is computed later from these x the editable price_table. */
export interface Usage {
  units: Record<string, number>;
}

export interface LlmRequest {
  /** cheap = extraction/checks, strong = drafting */
  tier: "cheap" | "strong";
  /** optional model override (from the workflow settings); the adapter falls back to its tier default */
  model?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
}
export interface LlmAdapter {
  complete(req: LlmRequest): Promise<{ text: string; model: string; usage: Usage }>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}
export interface SearchAdapter {
  search(req: { query: string; num?: number }): Promise<{ results: SearchResult[]; usage: Usage }>;
}

export interface FetchedPage {
  url: string;
  status: number;
  text: string;
  retrievedAt: string;
}
/** Public pages only: must respect robots.txt and never bypass logins, paywalls or CAPTCHAs. */
export interface FetcherAdapter {
  fetchPage(url: string): Promise<FetchedPage>;
}

export interface CrunchbaseOrg {
  domain: string;
  name: string;
  lastFundingType?: string;
  lastFundingDate?: string;
  lastFundingUsd?: number;
  sourceUrl: string;
}
export interface CrunchbaseAdapter {
  lookupOrganization(domain: string): Promise<{ org: CrunchbaseOrg | null; usage: Usage }>;
}

export interface ApolloFilters {
  titles: string[];
  seniorities: string[];
  /** industry / keyword terms */
  keywords: string[];
  locations: string[];
  employeeMin?: number | null;
  employeeMax?: number | null;
  perPage?: number;
}
export interface ApolloRevealFlags {
  revealPersonalEmails: false;
  revealPhoneNumber: false;
  waterfallEmail: false;
  waterfallPhone: false;
  webhookUrl: null;
}
export interface ApolloPerson {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  linkedinUrl: string | null;
  country: string | null;
  organization: { name: string; domain: string | null; industry: string | null; employeeCount: number | null } | null;
}
/** Search never returns emails (like Apollo); revealEmail is a separate, credit-spending call made only after qualification. */
export interface ApolloAdapter {
  searchPeople(filters: ApolloFilters, page: number): Promise<{ people: ApolloPerson[]; page: number; totalPages: number; totalEntries: number; usage: Usage }>;
  getOrganization(domain: string): Promise<{ org: { name: string; domain: string; industry: string | null; employeeCount: number | null; country: string | null } | null; usage: Usage }>;
  /** flags must always be the "email only" set (no phone, no personal email, no waterfall): see REVEAL_FLAGS in core */
  revealEmail(req: { personId: string; flags: ApolloRevealFlags }): Promise<{ email: string | null; usage: Usage }>;
}

export type VerifyStatus = "valid" | "invalid" | "risky" | "catch_all" | "unknown";
export interface VerifierAdapter {
  verify(email: string): Promise<{ status: VerifyStatus; usage: Usage }>;
}

export interface GmailDraftRequest {
  inboxId: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  /** Gmail label put on the draft (created if missing) */
  label?: string;
}
/** Draft creation and reply reading. Contains NO send capability by design. */
export interface GmailAdapter {
  createDraft(req: GmailDraftRequest): Promise<{ draftId: string; messageIdHeader: string }>;
  listReplies(req: { inboxId: string; sinceIso: string }): Promise<
    { messageId: string; threadId: string; receivedAt: string; snippet: string; kind: "reply" | "auto_reply" | "bounce" | "opt_out" }[]
  >;
}

/**
 * The only way to send. It must be imported by exactly one module: the worker's send job (Phase 11).
 * packages/adapters/tests/architecture.test.ts enforces that the Gmail send API appears in one file only.
 */
export interface GmailSender {
  sendDraft(req: { inboxId: string; draftId: string }): Promise<{ messageId: string; threadId: string }>;
}

export interface Adapters {
  llm: LlmAdapter;
  search: SearchAdapter;
  fetcher: FetcherAdapter;
  crunchbase: CrunchbaseAdapter;
  apollo: ApolloAdapter;
  verifier: VerifierAdapter;
  gmail: GmailAdapter;
  gmailSender: GmailSender;
}
