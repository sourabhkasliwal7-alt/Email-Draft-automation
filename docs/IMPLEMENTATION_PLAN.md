# AI Outreach Engine — Implementation Plan

Oct 26, 2026 · @sourabh

## How to use this plan

The build runs as 14 phases (0 to 13) inside Claude Code. Each phase has one mega prompt; the Master Autopilot prompt runs them all in order and moves to the next phase only when the current one passes its tests. You test the finished tool in the UI at the end with the checklist in the last section.

**Run order**

1. Do the one-time setup below (about 1 hour).
2. Export this doc as Markdown and save it in the repo as `docs/IMPLEMENTATION_PLAN.md`. Also put the v2 spec in `docs/SPEC.docx`. Claude Code reads both.
3. Paste the Master Autopilot prompt into Claude Code. It runs Phase 0 onward. If a session ends (context limit, crash), paste the Resume line from the master prompt and it continues from `PROGRESS.md`.
4. If you prefer control, paste one phase prompt at a time instead. Each phase prompt also works on its own.

**One-time setup (you do this, Claude Code cannot)**

| Item | Needed by phase | Notes |
| --- | --- | --- |
| Supabase project (dev) + Supabase MCP connected to Claude Code | 0 | Use a separate dev project. Supabase advises not pointing the MCP at production data. |
| Anthropic API key | 9 | Billed separately from a Claude subscription. |
| Serper (or other search API) key | 6 | Free trial is enough for building. |
| Google Cloud project + OAuth client (Web) + Gmail API enabled | 10 | If both inboxes are on your Google Workspace, set the consent screen to Internal. |
| Two Gmail inboxes to connect | 10 | Use test inboxes first. |
| Email verification provider key | 8 | Pick one; the code uses an adapter, so it can change later. |
| Apollo CSV export (sample of 50 to 100 real leads) | 3 | API integration only if your Apollo plan includes API access. |
| Crunchbase decision | 7 | API needs an Enterprise or Applications licence (quote-based). Without it, the CSV-export and search fallback is used. |
| Hosting: Vercel (web) + a small VPS or Railway/Render (worker) | 13 | Worker is a long-running process; it cannot run on Vercel functions. |

Connect the Supabase MCP in Claude Code with your project ref (read-write, dev project only):

```bash
claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?project_ref=<YOUR_PROJECT_REF>"
```

**Why it never stops on a missing key.** Every outside service (Claude, Serper, Crunchbase, Apollo, verifier, Gmail) sits behind an adapter with a mock version. If a key is missing, Claude Code builds and tests against the mock, writes the item in `BLOCKERS.md`, and moves on. The only things that truly wait for you are: pasting keys into `.env`, clicking through Google OAuth consent for each inbox, and the final pilot.

## Architecture and stack

The web app and a background worker share one Supabase database. Every paid call and every Gmail call runs in the worker, so caps, retries and the send guard live in one place.

```text
Web app (Next.js, Vercel)  <->  Supabase (PostgreSQL + Auth + Storage)  <->  Worker (Mastra + pg-boss, VPS)
Worker  ->  Claude API | Serper search | Crunchbase (flag) | Apollo + verifier | Gmail API (2 inboxes)
```

The web app handles only the Google sign-in step when you connect an inbox; after that the worker uses the stored, encrypted token.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js + TypeScript + Tailwind + shadcn/ui | Fast to build screens; deploys on Vercel |
| Worker | Node + Mastra workflows + pg-boss | Long-running jobs with steps, retries and resume; queue lives in Postgres, no Redis |
| Database, auth, files | Supabase (PostgreSQL, Auth, Storage) | One managed service; Claude Code drives it through the Supabase MCP |
| LLM | Claude API: cheaper model for extraction and checks, stronger model for drafting | Keeps cost near the ₹4 to ₹6 per-draft target |
| Search | Serper (adapter) | Cheap news, funding and hiring lookups |
| Company data | Crunchbase adapter, off by default | API needs an enterprise licence; CSV and search fallback otherwise |
| Email | Gmail API with OAuth for two inboxes | Drafts and approved sends from your own inboxes |
| Hosting | Vercel (web), small VPS or Railway/Render (worker), Supabase (data) | Worker must run all the time |

## Master Autopilot prompt

Paste this once into Claude Code at the repo root. It carries the rules every phase follows, so the phase prompts below stay short.

```text
You are the lead automation engineer building the "AI Outreach Engine" end to end.

SOURCES OF TRUTH (read fully before writing code):
- docs/SPEC.docx  (requirements v2; Section 23 overrides older wording about sending)
- docs/IMPLEMENTATION_PLAN.md  (phases 0-13 and their mega prompts)
- PROGRESS.md, BLOCKERS.md, CLAUDE.md  (create them in Phase 0 if missing)

TOOLS:
- Use the Supabase MCP for every database action: list tables, apply migrations,
  run SQL checks, generate TypeScript types, read logs and advisors.
  Also save every migration as a file in supabase/migrations/ so the repo is the record.
- Use the shell for installs, builds, tests and git.

HOW TO RUN:
1. Read PROGRESS.md. Find the first phase not marked DONE. Start there.
2. Open that phase's mega prompt in docs/IMPLEMENTATION_PLAN.md and execute it fully.
3. A phase is DONE only when ALL are true:
   - every item in its "Build" list exists and is wired to the UI or worker
   - its "Edge cases" are handled and each has a test
   - pnpm lint, pnpm typecheck, pnpm test (and pnpm e2e from Phase 2 on) pass
   - Supabase advisors (security + performance) show no new errors
   - PROGRESS.md updated: phase DONE, date, what was built, how to verify in UI
   - git commit "phase <n>: <title>"
4. Immediately continue to the next phase. Do not stop to ask for confirmation
   between phases. Do not summarize and wait. Keep going until Phase 13 is DONE.
5. If a test fails, debug and fix it. Never skip, delete or weaken a test to pass.
6. Missing credential or external access: build the real adapter AND a mock adapter
   behind the same interface, select by env flag, test with the mock, add the item
   to BLOCKERS.md (what is needed, where to put it, how to verify), and continue.
7. Only stop early for: an action that could send a real email, spend real money
   beyond the configured caps, or delete data in a non-dev database.

NON-NEGOTIABLE RULES (put these in CLAUDE.md in Phase 0):
- No email is ever sent without an explicit, recorded user approval for that email
  or for a reviewed batch. Draft creation and sending are separate stages.
- The Gmail send call exists in exactly one module (send job). Tests prove that
  unapproved, suppressed, already-sent or capped emails cannot be sent.
- Check Do Not Contact at import, before research spend, before drafting, and
  immediately before every send.
- Never invent facts. Every personalization claim links to a stored evidence row
  (URL + retrieval date). Unsupported claims fail the quality check.
- Every job is idempotent (unique keys) and resumable from its last completed step.
- Secrets only in env vars. OAuth refresh tokens encrypted (AES-256-GCM).
  The Supabase service-role key is used only server-side and in the worker.
- RLS is enabled on every table. No paid call happens without a spend-cap check.
- Costs are calculated from recorded usage x editable price table; never hard-coded.
- Never scrape Crunchbase or LinkedIn; never bypass paywalls, logins or CAPTCHAs.
- Pin dependency versions. Before using Mastra, Gmail or Anthropic SDK APIs,
  check the installed version's docs; do not rely on memory for method names.

RESUME LINE (if a session ends, paste only this):
"Continue the AI Outreach Engine build: read CLAUDE.md, PROGRESS.md and
docs/IMPLEMENTATION_PLAN.md, then resume from the first phase not DONE,
following the Master Autopilot rules."

Start now with the first phase not DONE.
```

## Phases and mega prompts

Each phase ends with something you can see in the UI, so progress is checkable even mid-build.

| Phase | Builds | You can check in the UI |
| --- | --- | --- |
| 0 Foundation | Monorepo, tooling, adapters with mocks, CI | App opens, health page green |
| 1 Database | All tables, RLS, history, views, seed via Supabase MCP | Tables visible in Supabase |
| 2 Auth and setup screens | Login, roles, campaigns, offers, suppression, settings | Create a campaign and offer |
| 3 CSV/XLSX import | Upload, mapping, validation, dedupe, dry run, error export | Import a messy Apollo CSV |
| 4 Queue and workflow engine | pg-boss jobs, Mastra pipeline, resume, spend caps | Start, pause, resume a batch |
| 5 Qualification and scoring | ICP filters, 0 to 100 score with reasons | Score breakdown on a lead |
| 6 Research and hiring signals | Website, careers, job boards, search, evidence store | Evidence with source links |
| 7 Crunchbase | Adapter (flagged), CSV fallback, funding signals | Funding signal with date and source |
| 8 Enrichment and verification | Email reveal after qualification, verifier, credit caps | Email status per lead |
| 9 Drafting and quality check | Claude drafts, offer choice, claim checker, versions | Draft with pass/fail and warnings |
| 10 Review and Gmail drafts | Review queue, Gmail OAuth for 2 inboxes, draft creation | Draft appears in Gmail |
| 11 Sending, tracking, history | Approved sending, send log, replies, follow-ups, timeline | Send one approved email, see it tracked |
| 12 Dashboard and costs | KPIs, funnel, campaign performance, actual costs | Dashboard numbers match data |
| 13 Hardening and deployment | E2E tests, security, deploy, pilot report | Live URL, full UI test |

### Phase 0: Foundation

```text
PHASE 0: FOUNDATION. Follow the Master Autopilot rules.
GOAL: A clean, runnable monorepo where every outside service has a real and a mock adapter.
BUILD:
- pnpm workspace:
  apps/web     Next.js (App Router, TypeScript strict, Tailwind, shadcn/ui)
  apps/worker  Node worker: Mastra workflows + pg-boss queue
  packages/core      pure domain logic: normalize, dedupe, scoring, state machines, cost math
  packages/db        Supabase clients (browser/server/service), generated types, repositories
  packages/adapters  interfaces + live + mock for: llm (Claude), search (Serper), fetcher,
                     crunchbase, apollo, verifier, gmail. Select per adapter by env
                     (e.g. ADAPTER_GMAIL=mock|live).
- env.ts per app using zod: fail fast with a list of missing vars, but allow mock mode.
- .env.example with every variable and a comment; .gitignore covers all .env files.
- CLAUDE.md (copy the NON-NEGOTIABLE RULES), PROGRESS.md (table of phases 0-13),
  BLOCKERS.md, README.md (how to run web + worker locally).
- ESLint, Prettier, Vitest, Playwright, tsx. Scripts: dev, build, lint, typecheck, test, e2e.
- Dockerfile for the worker. GitHub Actions: lint + typecheck + test on every push.
- /api/health (web) and a worker heartbeat (written to DB from Phase 1).
EDGE CASES: missing env var in live mode -> clear startup error naming it;
mock mode works with zero external keys.
DONE WHEN: pnpm dev opens the web app; all scripts pass; CI config present.
Then update PROGRESS.md, commit, start Phase 1.
```

### Phase 1: Database (Supabase MCP)

```text
PHASE 1: DATABASE. Follow the Master Autopilot rules. Use the Supabase MCP for all DB work
and save each migration in supabase/migrations/.
GOAL: Full schema for v1 + v2 requirements, safe by default.
BUILD (tables, all with id uuid, created_at, updated_at):
- profiles(user_id, full_name, role: admin|operator|reviewer|sender)
- inboxes(email, display_name, status, encrypted_refresh_token, scopes, daily_draft_cap,
  daily_send_cap, min_seconds_between_sends, last_health_check)
- offers (the "Nuance offer" library: name, description, allowed_claims[], cta_options[]),
  case_studies(offer_id, title, summary, allowed_numbers jsonb, industries[])
- campaigns(name, icp jsonb, target_roles[], regions[], score_draft_min, score_review_min,
  daily_cap, offer_id, tone, cta, inbox_id, research_depth, send_window jsonb, status)
- companies(domain UNIQUE, name, country, industry, employee_count, website, summary,
  research_cached_at)
- contacts(full_name, first_name, last_name, job_title, email, email_lower UNIQUE NULLS
  DISTINCT, email_status, profile_url UNIQUE, company_id, country, dnc boolean)
- campaign_leads(campaign_id, contact_id, UNIQUE(campaign_id, contact_id), lead_source,
  icp_segment, lead_score, score_components jsonb, reason_codes[], status, trigger,
  trigger_date, trigger_source, offer_id, case_study_id, owner_id, last_contact_date,
  next_action, next_action_date, nurture_date, opportunity_value numeric, review_required)
- import_batches(file_name, file_hash, storage_path, sheet, mapping jsonb, mode, totals jsonb,
  status, user_id), import_rows(batch_id, row_number, original jsonb, normalized jsonb,
  status, errors[], contact_id)
- research_runs, evidence_items(company_id, url, title, snippet, retrieved_at, source_type,
  confidence), signals(company_id, type: funding|hiring|expansion|launch|leadership|other,
  description, source_url, source_name, signal_date, retrieved_at,
  verification: verified|possible|stale, confidence, provider)
- enrichment_results(contact_id, provider, result jsonb, credits_used)
- email_drafts(campaign_lead_id, version, subject, body_text, body_html, facts jsonb
  [evidence ids], claim_check jsonb, quality_score, warnings[], status, inbox_id,
  gmail_draft_id, gmail_message_id_header, body_hash, idempotency_key UNIQUE)
- send_approvals(draft_id UNIQUE, approved_by, approved_at, batch_label)
- email_sends(draft_id, send_key UNIQUE, inbox_id, recipient_name, recipient_email, company,
  subject, body_text, campaign_id, status: queued|sending|sent|failed|cancelled|unknown,
  failure_reason, attempt, sent_at, gmail_message_id, gmail_thread_id)
- replies(send_id, received_at, kind: reply|auto_reply|bounce|opt_out, snippet)
- followups(campaign_lead_id, step, due_date, status)
- lead_events(campaign_lead_id, contact_id, type, payload jsonb, actor) APPEND-ONLY
- suppression(email_lower, domain, scope: global|campaign, campaign_id, reason, source)
- jobs, job_steps(job_id, step, status, attempts, error, started_at, finished_at, output_ref)
- usage_records(provider, operation, units jsonb, cost_usd, campaign_id, campaign_lead_id, job_id)
- price_table(provider, unit, usd_per_unit, effective_from), spend_caps, settings, audit_log
DATABASE GUARDS (defense in depth):
- Trigger on email_sends INSERT: reject unless a send_approvals row exists for the draft,
  recipient is not suppressed, and no 'sent' row exists for the same campaign_lead + step.
- lead_events: revoke UPDATE/DELETE; trigger blocks changes.
- RLS on every table: policies by role from profiles; worker uses service role.
- Indexes on all foreign keys, status columns, email_lower, domain, created_at.
- Views: v_daily_metrics, v_campaign_performance, v_cost_summary, v_followups_due.
- Seed: 1 demo campaign, 2 offers, 2 case studies, 3 suppression rows, 10 fake leads
  on example.com domains.
AFTER: generate TypeScript types via MCP into packages/db; run Supabase advisors and fix issues.
EDGE CASES: emails stored lowercased for uniqueness but original kept; deleting a
campaign never deletes history (soft delete); timestamps in UTC, displayed in Asia/Kolkata.
TESTS: SQL tests (or Vitest against the DB) proving the send trigger, append-only
history and RLS per role.
Then update PROGRESS.md, commit, start Phase 2.
```

### Phase 2: Auth and setup screens

```text
PHASE 2: AUTH AND SETUP SCREENS. Follow the Master Autopilot rules.
GOAL: A signed-in operator can configure everything a campaign needs.
BUILD:
- Supabase Auth (email + password, optional magic link); middleware protects all routes;
  role guard per page and per server action.
- App shell with nav: Dashboard, Campaigns, Import, Leads, Review, Sending, Follow-ups,
  Suppression, Inboxes, Offers, Jobs, Usage & Cost, Settings.
- Campaigns: list + create/edit wizard (ICP rules editor, roles, regions, thresholds,
  daily caps, offer, tone, CTA, inbox, send window).
- Offers and case studies: CRUD with allowed claims and allowed numbers.
- Suppression center: add/remove email or domain, global or per campaign, CSV upload.
- Settings: price table, spend caps, model names per task, research depth,
  feature flags (CRUNCHBASE_ENABLED, REPLY_TRACKING_ENABLED, SENDING_ENABLED).
- Every config change writes audit_log.
EDGE CASES: reviewer cannot change settings; sender role required to approve sends;
disabled user loses access at once; form validation with clear messages.
TESTS: Playwright: log in, create campaign, add offer, add suppression row.
Then update PROGRESS.md, commit, start Phase 3.
```

### Phase 3: CSV/XLSX import

```text
PHASE 3: CSV/XLSX IMPORT. Follow the Master Autopilot rules. Spec Section 5 applies in full.
GOAL: Any reasonable lead file (Apollo export or hand-made) imports cleanly.
BUILD:
- Upload to a private Supabase Storage bucket; record file hash and batch.
- Parse CSV (papaparse) and XLSX (exceljs, or SheetJS from its official CDN tarball);
  worksheet picker; preview first 20 rows.
- Column mapping UI with alias auto-detect (first_name/First Name/Fname,
  company/company_name/Organization, etc.), an Apollo preset, and saved mapping templates.
- Normalize: trim, collapse spaces, lowercase emails, normalize URLs and domains
  (strip www, protocol, paths); keep the original row untouched in import_rows.original.
- Validate per campaign rules; row-level errors, never fail the whole file.
- Dedupe: normalized email, profile URL, then company domain + full name; against the
  batch itself, existing contacts and the campaign. Suppression check here too.
- Modes: add new only, update existing, skip duplicates, dry run (writes nothing).
- Summary: imported, duplicate, invalid, suppressed, skipped, failed. Download error rows
  as CSV with formula-injection protection (prefix ' to cells starting = + - @ tab CR).
- Large files parsed in the worker as a job with progress.
EDGE CASES (each tested with a fixture file in tests/fixtures/imports/):
UTF-8 BOM; Windows-1252 file; semicolon delimiter; quoted commas and newlines; blank rows;
duplicate header names; missing header row; 50,000-row limit message; email with spaces
or capitals; no email (allowed only if campaign is research-first); same file uploaded
twice (hash warning); Excel dates and numbers as text; Hindi/accented names kept intact.
Then update PROGRESS.md, commit, start Phase 4.
```

### Phase 4: Queue and workflow engine

```text
PHASE 4: QUEUE AND WORKFLOW ENGINE. Follow the Master Autopilot rules.
GOAL: Batches run in the background, survive crashes, never double-process, and stop at caps.
BUILD:
- pg-boss in apps/worker on the Supabase DIRECT or session-mode connection string
  (not the transaction pooler on port 6543: pg-boss needs session features).
- Mastra workflow "leadPipeline" with steps:
  suppressionCheck -> qualify -> research -> score -> enrich -> draft -> qualityCheck -> awaitReview
  Each step reads inputs from DB, writes outputs to DB, records job_steps status.
  Steps are idempotent; a rerun skips completed steps.
- Batch controls in UI: estimate cost (from price table x expected usage) -> Start;
  Pause; Resume; Cancel; Retry failed. Job Monitor page with live status.
- Spend guard: before every paid call check daily/monthly caps per provider and overall;
  at cap -> pause batch with reason shown in UI. Caps reset at midnight Asia/Kolkata.
- Rate limiter + concurrency per provider (config in settings). Exponential backoff with
  jitter on 429/5xx, bounded attempts, then dead-letter state with error text.
- Worker heartbeat every 30 s; UI shows "worker offline" when stale.
- Graceful shutdown on SIGTERM: finish the current step, then exit.
EDGE CASES: worker killed mid-step (test: resume completes without duplicates);
same lead enqueued twice (singleton key per campaign_lead + step); cap hit mid-batch;
lead added to DNC while queued (skipped at next step); campaign paused while running.
TESTS: integration tests with mock adapters for crash/resume, caps and duplicates.
Then update PROGRESS.md, commit, start Phase 5.
```

### Phase 5: Qualification and scoring

```text
PHASE 5: QUALIFICATION AND SCORING. Follow the Master Autopilot rules. Spec Section 7.
GOAL: Cheap rules first; an explainable 0-100 score decides draft, review or skip.
BUILD:
- Deterministic ICP filter (no LLM): industry, employee range, country/region,
  role match by title keywords + seniority; outputs pass/fail + reason codes.
  Only passing leads go to research.
- Score in packages/core with campaign-configurable weights:
  ICP fit 0-30, trigger 0-25 (recency-weighted from signals), role fit 0-20,
  offer/case-study fit 0-15, data confidence 0-10.
- Decision: >= score_draft_min -> draft; >= score_review_min -> review; else skip.
- Optional short LLM explanation stored beside the numbers, never used to compute them.
- Re-score automatically when new evidence or signals arrive.
- Lead detail page: score bar per component with the reasons and linked evidence.
EDGE CASES: missing employee count (neutral, not zero, and lowers data confidence);
ambiguous titles ("Head", "Lead"); score exactly on a threshold; ICP edited after
scoring (re-score button and bulk re-score).
TESTS: table-driven unit tests covering every component and threshold boundary.
Then update PROGRESS.md, commit, start Phase 6.
```

### Phase 6: Research and hiring signals

```text
PHASE 6: RESEARCH AND HIRING SIGNALS. Follow the Master Autopilot rules. Spec 7 and 23.1.
GOAL: Source-backed facts and dated signals for each qualified company, cached by domain.
BUILD:
- Fetcher: robots.txt respected, clear user agent, 10 s timeout, 2 MB cap, redirects
  limited, per-domain rate limit, readability text extraction.
- Page discovery: home, about, products/services, careers/jobs, blog/news/press, sitemap.
- Job listings: detect ATS links on careers pages (Greenhouse, Lever, Ashby, Workable,
  others) and read their public job-board endpoints when available.
- Search adapter (Serper): max N queries per lead from settings (company news, funding,
  hiring); store url, title, date, snippet.
- Extraction: cheap Claude model returns zod-validated JSON of facts and signals; each
  item must carry source_url and a short snippet. ANTI-HALLUCINATION GUARD: drop any
  item whose snippet is not found in the fetched text of that URL.
- Signals: type, description, signal_date, retrieved_at, source. Hiring is "verified"
  only when a live careers page or job listing shows it; otherwise "possible".
  Older than the recency window (default 180 days; job posts > 60 days) -> "stale".
- Pick the lead trigger = most recent verified signal (else most recent possible),
  fill trigger, trigger_date, trigger_source on campaign_leads.
- Cache per domain (TTL from settings, default 14 days); other contacts reuse it.
- Stop early once enough evidence is found (configurable). Record all usage.
EDGE CASES: site down/timeout; JavaScript-only site with empty text (mark low data
confidence, no headless browser in MVP); redirect to another domain; parked domain;
non-English page; careers page with zero openings; duplicate signal from two sources
(merge, keep both sources); search result for a different company with a similar name
(domain must match).
TESTS: fixture HTML pages for each case; guard test proving invented snippets are dropped.
Then update PROGRESS.md, commit, start Phase 7.
```

### Phase 7: Crunchbase

```text
PHASE 7: CRUNCHBASE. Follow the Master Autopilot rules. Spec 23.1 and 23.8.
GOAL: Funding/growth signals from Crunchbase when licensed, with a working fallback when not.
BUILD:
- CrunchbaseAdapter interface: findOrganizationByDomain, getOrganization,
  getFundingRounds. Live version uses the official API key (header auth) and only runs
  when CRUNCHBASE_ENABLED=true; mock version for tests.
- Connection check in Settings: a 403 means the key lacks Enterprise/Applications access;
  show that message plainly and keep the flag off.
- Map results to companies (employee range, location) and signals
  (funding -> type funding, plus a "possible" hiring/expansion signal that Phase 6
  must verify on careers pages before it is called verified).
- Fallback A: import a licensed Crunchbase CSV export (reuse Phase 3 importer with a
  Crunchbase preset) into companies and signals.
- Fallback B: search-API funding queries ("<company> raises", "<company> funding")
  with domain match; stored as signals with the article as source.
- Cache by domain; usage and cost recorded; per-day call cap.
EDGE CASES: no match by domain; several organizations match (pick exact domain, else
leave unmatched); funding older than 18 months is not "recent"; amounts in different
currencies stored with currency code; API rate limit -> backoff.
NEVER scrape crunchbase.com pages.
Then update PROGRESS.md, commit, start Phase 8.
```

### Phase 8: Enrichment and verification

```text
PHASE 8: ENRICHMENT AND VERIFICATION. Follow the Master Autopilot rules.
GOAL: Spend reveal/verification credits only on qualified leads, inside caps.
BUILD:
- Gate: only campaign_leads at or above score_draft_min (or approved from review).
- Email reveal: Apollo adapter if the plan allows API access; otherwise a
  "Needs email" queue where the operator pastes or imports emails.
- Verifier adapter: statuses valid, invalid, catch_all, unknown, disposable, role.
  Policy setting: which statuses may be drafted and which may be sent
  (default send only valid; catch_all needs explicit operator OK).
- Never mark verified without a stored verifier result. Credits -> usage_records.
EDGE CASES: verifier timeout -> unknown, retry later once; invalid -> suppression with
reason "invalid email"; role addresses (info@, sales@) flagged; email changed by
operator triggers re-verification.
Then update PROGRESS.md, commit, start Phase 9.
```

### Phase 9: Drafting and quality check

```text
PHASE 9: DRAFTING AND QUALITY CHECK. Follow the Master Autopilot rules. Spec Section 8.
GOAL: Short, personal, fully evidence-backed drafts; anything unsupported is caught.
BUILD:
- Offer choice: deterministic match (industry, signal type, case-study industries);
  if several fit, Claude may pick ONLY among those allowed ids. None fits -> neutral
  approved offer, or hold for review (campaign setting).
- Prompt builder: campaign tone, CTA, word limit (default 60-120), sender signature,
  the chosen offer and case study, and at most 3 evidence items (id + snippet + date).
  Use prompt caching for the fixed system part. Models from settings
  (default: a Sonnet-class model for drafting, a Haiku-class model for checks).
- Output (zod): subject, body_text, facts_used: [{claim, evidence_id}].
- Quality check = deterministic checks + a second Claude pass:
  name and company match the record; every claim maps to an evidence id or the case
  study; every number appears in evidence or allowed_numbers; no score, notes or URLs
  of internal pages; CTA present; length; banned/spammy phrases; recency (no "recently"
  on stale signals); not suppressed. Result: pass/fail, flags, suggested fixes.
- On fail: one automatic regenerate with the flags as feedback; still failing -> review
  with warnings. Every version kept; Regenerate with user feedback from the UI.
- Record tokens and cost per call.
EDGE CASES: no evidence at all; first name missing (campaign greeting fallback);
names with initials or non-Latin script; company suffixes (Pvt Ltd, Inc.) trimmed in
prose; model returns invalid JSON (retry once, then fail step with error).
TESTS: 10 golden fixtures in tests/fixtures/drafts with expected checker verdicts,
including planted fake claims that MUST fail. Mock LLM for CI; one live smoke test
runnable manually when the key exists.
Then update PROGRESS.md, commit, start Phase 10.
```

### Phase 10: Review queue and Gmail drafts

```text
PHASE 10: REVIEW QUEUE AND GMAIL DRAFTS. Follow the Master Autopilot rules. Spec 13.
GOAL: A reviewer checks evidence and draft side by side, then creates the Gmail draft.
BUILD:
- Review page: lead + company, score breakdown, evidence with links and dates, trigger,
  draft (editable), checker flags, cost so far. Actions: Approve to Gmail draft, Edit,
  Regenerate (with note), Skip (reason), Mark DNC, choose inbox. Keyboard shortcuts.
  Bulk approve with a confirm dialog showing the count.
- Gmail OAuth per inbox: Google OAuth 2.0 web flow with state (CSRF) and PKCE where
  supported; offline access; scopes: gmail.compose (drafts + sending a draft) and,
  only if REPLY_TRACKING_ENABLED, gmail.metadata. Store the refresh token encrypted.
  Inboxes page: connect, disconnect, health check, re-auth banner on invalid_grant.
- Draft creation: build MIME (UTF-8, RFC 2047 encoded subject, plain text + optional
  simple HTML), our own Message-ID and an X-Outreach-Key header; idempotency key
  campaign + lead + version; save gmail_draft_id, body_hash; lead_events entry.
- Inbox assignment: chosen inbox or balanced; daily draft cap per inbox.
EDGE CASES: token revoked or expired; Gmail 429/5xx (backoff, resume); two reviewers
approve the same draft (only one Gmail draft); draft deleted in Gmail later (sync marks
it missing); emoji or Hindi in subject; OAuth app in Testing mode (warn: refresh
tokens expire, re-auth needed).
TESTS: mock Gmail adapter records calls; test that approving twice creates one draft.
Then update PROGRESS.md, commit, start Phase 11.
```

### Phase 11: Approved sending, tracking and history

```text
PHASE 11: APPROVED SENDING, TRACKING, HISTORY. Follow the Master Autopilot rules.
Spec 23.3, 23.4, 23.5 and Section 9.
GOAL: Send only approved drafts, exactly once, and track everything per lead.
BUILD:
- Sending page: Gmail drafts waiting for send approval, filter by campaign/inbox.
  "Send" (one) and "Approve batch" (selected) open a confirm dialog listing count,
  inboxes and recipients. Only role sender/admin. Writes send_approvals.
  SENDING_ENABLED=false hides the actions entirely.
- Send job (the ONLY module calling Gmail send):
  1. lock row (FOR UPDATE SKIP LOCKED), status queued -> sending
  2. re-check: approval exists, not suppressed, no prior sent row for lead + step,
     email status allowed, inbox healthy, inbox daily send cap, send window, and
     minimum delay between sends per inbox (with small random jitter)
  3. fetch the Gmail draft: missing -> failed "draft missing in Gmail";
     edited in Gmail (hash differs) -> store new body as a version, then send
  4. send the draft; store gmail_message_id, thread_id, sent_at; status sent
  5. lead_events, last_contact_date, next action; schedule follow-ups (day 4, day 9)
     as DRAFT candidates only, never auto-sent.
- Crash safety: rows stuck in "sending" past N minutes -> reconcile by our Message-ID
  when read scope exists; otherwise status "unknown" for a human to confirm in Gmail.
  NEVER auto-resend an unknown.
- Failures: permanent (invalid recipient, 4xx) -> failed + reason, invalid address to
  suppression; transient (429/5xx) -> retry with backoff up to the limit, then failed.
  Manual retry button for failed sends.
- Replies (REPLY_TRACKING_ENABLED): poll sent threads every 15 min; reply from another
  address -> replied, stop follow-ups; auto-replies (Auto-Submitted, X-Autoreply,
  out-of-office) are not replies; mailer-daemon -> bounce -> suppression;
  "unsubscribe/stop" wording -> opt-out -> DNC. Manual marks always available.
- Follow-ups page: due list; generate follow-up draft through the same review path.
- Lead detail: full timeline from lead_events (imports, research, scores, draft
  versions, Gmail drafts, sends, failures, replies, DNC changes, follow-ups).
EDGE CASES: double click on Send (one send); approval revoked before the job runs;
DNC added after approval (blocked at send time); inbox disconnected mid-batch (pause
that inbox only); daily cap reached (rest waits for tomorrow, shown in UI);
recipient replied before follow-up is due (follow-up cancelled).
TESTS: unit + DB-trigger tests that unapproved/suppressed/duplicate sends are refused;
crash simulation between Gmail call and DB update ends as "unknown", not a resend.
Then update PROGRESS.md, commit, start Phase 12.
```

### Phase 12: Dashboard and cost reporting

```text
PHASE 12: DASHBOARD AND COSTS. Follow the Master Autopilot rules. Spec 23.6, 15-17.
GOAL: One screen that shows what happened, what is pending and what it cost.
BUILD:
- KPI tiles: imported leads, researched companies, qualified leads, drafts generated,
  sent, failed, pending (approved not sent + drafts awaiting approval), replies,
  follow-ups due in 7 days.
- Funnel: imported -> researched -> qualified -> drafted -> sent -> replied.
- Trend by day for drafts, sends, failures, replies.
- Campaign performance table: drafts, sends, failures, replies, reply rate,
  cost per draft, cost per sent email.
- Costs: actual this month by provider (Claude, search, verifier, Crunchbase, hosting
  entered manually) vs budget; cost per successful draft in INR (FX rate in settings).
- Filters: date range, campaign, inbox, owner. Export CSV (formula-safe).
- Lists: failed emails with reason + retry; upcoming follow-ups.
TESTS: seed known data and assert every tile equals a direct SQL count.
Then update PROGRESS.md, commit, start Phase 13.
```

### Phase 13: Hardening, deployment and pilot

```text
PHASE 13: HARDENING, DEPLOYMENT, PILOT. Follow the Master Autopilot rules. Spec 14, 18, 19.
GOAL: Production-ready, deployed, and proven with a full end-to-end run.
BUILD:
- Playwright E2E (mock adapters): login -> campaign -> import messy CSV -> batch ->
  review -> Gmail draft -> approve send -> sent -> reply -> dashboard counts.
- Security: RLS tests per role; rate limits on API routes; upload type/size checks;
  security headers; CSRF on mutations; secrets scan; no tokens or keys in logs;
  dependency audit. Fix all Supabase advisor warnings.
- Load test in mock mode: 2,000 leads through the pipeline; no duplicates, no stuck jobs.
- Data: retention job, export and delete for a lead, backup plan noted.
- Deploy:
  web -> Vercel (env vars set, production domain);
  worker -> Docker on VPS or Railway/Render with restart policy and health check;
  database -> Supabase production project; apply migrations with the Supabase CLI
  (supabase db push), not via MCP on production;
  Google OAuth redirect URIs for the production domain.
- Monitoring: error tracking (e.g. Sentry), uptime check, worker-offline alert.
- Docs: docs/RUNBOOK.md (deploy, rotate keys, re-auth inbox, restore), docs/UI_TEST_GUIDE.md.
- Pilot mode: run 50-100 real leads with SENDING_ENABLED=false first, then send to an
  internal test address; generate a pilot report: cost per draft, pass rate, human edit
  rate, research coverage, processing time.
DONE WHEN: all acceptance items in Spec Section 19 and 23 pass, E2E green, app live.
Update PROGRESS.md with the live URL and the final checklist, commit, and stop.
The build is complete.
```

## Edge cases that must be handled

These are the failures that usually break tools like this; each one has a test in its phase.

| Area | Edge case | Expected behavior | Phase |
| --- | --- | --- | --- |
| Sending | Double click on Send | Exactly one email sent | 11 |
| Sending | Crash after Gmail accepted, before DB saved | Status "unknown"; human confirms; never resent | 11 |
| Sending | Contact added to DNC after approval | Blocked at send time, reason logged | 11 |
| Sending | Draft edited or deleted inside Gmail | Edited: new version saved then sent. Deleted: marked missing | 10, 11 |
| Sending | Inbox daily send cap reached | Rest waits for next day; shown in UI | 11 |
| Sending | Permanent failure (bad address) | Failed with reason; address suppressed | 11 |
| Replies | Out-of-office auto-reply | Not counted as a reply; follow-ups continue | 11 |
| Replies | Bounce from mailer-daemon | Marked bounced; suppressed; follow-ups stopped | 11 |
| Replies | "Stop" or "unsubscribe" reply | Opt-out; global DNC | 11 |
| Gmail auth | Refresh token revoked or expired | Inbox marked needs re-auth; its jobs pause; others continue | 10 |
| Gmail auth | OAuth app left in Testing mode | Warning shown: tokens expire and break sending | 10 |
| Import | BOM, Windows-1252, semicolons, blank rows | Parsed correctly or row-level error | 3 |
| Import | Same file uploaded twice | Warning via file hash; dedupe prevents doubles | 3 |
| Import | Cell starting with = in error export | Prefixed so Excel cannot run it | 3 |
| Dedupe | Same person, different email case or spacing | One contact | 3 |
| Dedupe | Same person in two campaigns | One contact, two campaign leads, shared history | 1, 3 |
| Research | JavaScript-only site, empty text | Low data confidence; no invented facts | 6 |
| Research | Search hit about a similarly named company | Rejected: domain must match | 6 |
| Research | Model invents a fact or quote | Dropped: snippet not found in page text | 6 |
| Signals | Old job post or old funding | Marked stale; never called "recent" | 6, 7, 9 |
| Crunchbase | Basic key returns 403 | Clear message; flag stays off; fallback used | 7 |
| Drafting | No usable evidence | Neutral offer email or held for review | 9 |
| Drafting | Model returns invalid JSON | One retry, then step fails with error | 9 |
| Drafting | Number in email not in evidence or case study | Quality check fails | 9 |
| Queue | Worker killed mid-step | Resumes from last completed step, no duplicates | 4 |
| Queue | Provider rate limit (429) | Backoff and retry, then dead-letter | 4 |
| Costs | Spend cap hit mid-batch | Batch pauses with reason; resumes after reset or raise | 4 |
| Access | Reviewer tries to send or change settings | Refused by UI and by RLS | 2, 13 |
| Time | Daily caps and dates | Calculated in Asia/Kolkata, stored in UTC | 1, 4 |

## Final UI test checklist

Run this on the deployed app with your own test inboxes before using real leads. Tick each item as it passes.

**Setup**

- [ ] Log in as admin; create a reviewer user and confirm they cannot open Settings or Send
- [ ] Connect both Gmail inboxes; both show healthy
- [ ] Create an offer, a case study and a campaign with caps and thresholds
- [ ] Add a test email to the suppression list

**Import**

- [ ] Upload a real Apollo CSV; columns auto-map; preview looks right
- [ ] Dry run shows totals and writes nothing
- [ ] Real import: duplicates, invalid rows and the suppressed address are reported, error CSV downloads

**Pipeline**

- [ ] Cost estimate appears before Start; start a batch of 10
- [ ] Pause and resume work; Job Monitor shows each step
- [ ] Non-ICP leads are skipped with a reason
- [ ] Lead detail shows score breakdown, evidence links with dates, trigger and (if enabled) Crunchbase signal
- [ ] Hiring signals show verified or possible correctly

**Review and Gmail drafts**

- [ ] Draft shows checker result; open a failed one and read its flags
- [ ] Edit a draft, regenerate one with a note, skip one, mark one DNC
- [ ] Approve to Gmail: draft appears in the right inbox, only once

**Sending and tracking**

- [ ] Send one approved draft to your own address; it arrives; status Sent with message ID
- [ ] Try to send a draft for the suppressed address: refused
- [ ] Batch send 3 drafts: confirm dialog lists them; delays between sends visible
- [ ] Reply from your test address: lead shows Replied and follow-ups cancel
- [ ] Send to a non-existent address: shows Failed with reason and gets suppressed
- [ ] Lead timeline shows import, research, score, drafts, send, reply

**Dashboard and costs**

- [ ] Every tile matches what you did above
- [ ] Cost per draft and per sent email show real numbers in INR
- [ ] Lower a spend cap below today's spend: next batch pauses with the reason
