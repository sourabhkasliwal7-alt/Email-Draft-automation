# PROGRESS

| Phase | Title | Status | Date |
|-------|-------|--------|------|
| 0 | Foundation | DONE (see deviations) | 2026-10-26 |
| 1 | Database | DONE | 2026-10-26 |
| 2 | Auth and setup screens | DONE | 2026-10-26 |
| 3 | CSV/XLSX import | DONE | 2026-10-26 |
| CORE | Core automatic flow per docs/SRS.docx (mock mode) | DONE in mock mode (see below) | 2026-10-27 |
| LIVE-1 | CSV runs, Gmail connection, live Claude/Serper/ZeroBounce/fetcher | built; adapters stay on mock until you switch them | 2026-10-27 |
| LIVE-2 | Simple 4-page UI, Apollo as a main lead source, retry, email quality, gmail.modify label | built; Apollo needs your key | 2026-10-28 |
| LIVE-3 | Web discovery (Google) as a third lead source | built and tested on mock adapters; needs your Serper key and Apollo for contacts | 2026-10-28 |
| 4-13 | Replaced by the single-agent plan: the core flow first, everything else under "Later" | see "Later" | |

## LIVE-3 - Web discovery (Google) as a third lead source (2026-10-28)

**Built**
- Campaign lead source is now any mix of **CSV file**, **Apollo search** and **Web discovery (Google)** (`icp.leadSources`; the old one-word `leadSource` is still written and read, `sourcesOf()` is the way to read it). New campaign fields: typed search queries (one per line; empty = built from the target), max queries per run (default 10), max results per query (default 10).
- Worker: new `web.find` job and the web step of a run (`jobs/web-discovery.ts`). Queries -> Serper (one recorded usage row per query, spend caps and price table apply) -> only company websites (`core/discovery.ts`: configurable exclude list in Setup > Advanced, LinkedIn and Crunchbase always on it; government, education and IP addresses dropped) -> drop websites already stored or on the suppression list -> quick check per company (`screenCompanySite`, the same check a lead gets; a lead created by discovery carries its result, so it is never paid for twice) -> free Apollo people search by company website (`q_organization_domains_list[]`) -> best person for the campaign's target titles -> normal flow (research, score, approve, reveal, verify, write, Gmail draft).
- Fill order of a run: CSV leads already in the campaign, then Apollo and web (when both are ticked, Apollo fills half of what is missing and web the rest). Searching stops as soon as enough people are found.
- Nobody found, or Apollo not connected: the company is kept as a lead in Needs attention with reason `no-contact` and the company info; no email is guessed. Every later run looks the company up again for free (up to 15 per run).
- Every lead stores its source (`lead_source = web_discovery`) and the search that found it (`campaign_leads.source_detail`, migration `20261028100000_lead_source_detail.sql`).
- Web: campaign form with three source boxes, queries preview and caps; Leads page third card "Find companies on Google" with Preview and a result list; lead list columns Source and Found by; Needs attention shows *No contact found* with company info and no Retry; Setup > Advanced "Websites we never use as leads".
- Safety: web discovery is refused when the search is in demo mode while anything real (page fetcher, model, Apollo) is on; demo people never reach a real run; a test run may search and check companies (small Serper/model cost) but never spends Apollo credits.

**Tests**: core `discovery.test.ts`; adapters `web-discovery.test.ts` (live Apollo by website, mock search/people); worker `web-discovery.integration.test.ts` (filters, known/suppressed, caps, usage per query, no contact, re-check, safety gates, a full run, CSV + web mix); web `web-discovery-ui.test.ts`.

## LIVE-2 - simple UI, Apollo, retry, quality (2026-10-28)

**The tool is four pages** (Home, Leads, Drafts, Setup). Everything else moved into them; the old addresses redirect. Half-built screens were removed from the UI (code and tables are kept): sending/approval screens, follow-ups, reply tracking, Crunchbase, the job and cost pages. See "Later".

**Apollo is a main lead source, equal to CSV.** Campaign lead source = CSV, Apollo or Both (CSV leads first, Apollo fills what is missing). Filters: the campaign's roles, industries/keywords, countries and employee range, plus seniority and hiring (open jobs) for Apollo only. Built on Apollo's published API (docs.apollo.io), live adapter in `packages/adapters/src/live/apollo.ts`:
- Company search (`mixed_companies/search`, 1 credit per page of 100, at most 3 pages a run) gives each company's website; people search (`mixed_people/api_search`, free, no emails, hidden last names) then finds the people there. Apollo's people search returns no company website, which is why the company search comes first.
- Email reveal (`people/match`) is the only call that unlocks an email, for approved leads only, with personal emails, phone, waterfall and webhook switched off (the adapter refuses anything else), never twice per person, ledger row before and after, 70/day and 2000/month limits (editable). The company-search credits are recorded as usage and shown on Home but do not use up the reveal limits.
- A test run never searches Apollo (it would cost a credit); "Find leads with Apollo" on the Leads page runs the search alone. In demo mode (no key) made-up people are allowed only while everything else is demo too: a real run never works on demo people.
- Setup > Apollo account > Test connection: free checks only (key, people search access, whether the reveal call is reachable); a plan without API access gets a plain message.
- Everything is tested with the demo adapter and with scripted Apollo responses; it has NOT been run against the real Apollo API yet (no key): that is the first thing to check once the key is in.

**Retry** (Drafts > Needs attention): puts the lead back at the step that failed (writing, saving in Gmail, getting the email, research) and starts a run; earlier steps are kept so nothing already paid for runs again (`retryPatch` in core).

**Email quality:** a rewrite is told the exact rules that failed, with the rule text, and sees its own last attempt. Each run reports how many emails were right the first time, after one rewrite, or not good enough (Home and the run log). The SRS rules were not loosened.

**Gmail label:** the connection now asks for `gmail.compose` + `gmail.modify` (nothing else); a mailbox connected before shows "Reconnect needed" until reconnected. Drafts are created either way. Still no send code (architecture test kept). Draft message ids are stored so "Open in Gmail" opens the draft.

**Skip email verification (testing only):** Setup > Advanced, off by default, yellow banner on Home while on. An address that is already known to be bad is still refused.

**Test-data cleanup** (`apps/worker/scripts/cleanup-test-data.ts`): `--preview` (default) runs the whole deletion inside a transaction and rolls it back, printing rows per table; `--run` takes a backup into `backups/` (git-ignored; no Gmail token in it), deletes, then verifies. It removes only test/demo data (leads, contacts, companies, research, runs, drafts, jobs, usage, import batches and their uploaded files, test campaigns, seeded offers and case studies, the demo mailbox, seeded and test suppression rows) and never touches the schema, users, the connected mailbox and its token, settings, price table, spend caps or existing audit rows. The app forbids deleting leads, contacts, campaigns and so on, and `lead_events` is append-only, with named guard triggers; the script switches off exactly those triggers on exactly those tables inside the one transaction, deletes, switches them on again and checks they are on before committing. Foreign keys stay on, so a wrong order rolls everything back. The cleanup is itself audited (offers, campaigns, suppression and mailboxes write audit rows). Demo data is never created by the app: a unit test (`no-demo-seed.test.ts`) guards that.

**Funnel on Home** (Found -> Checked -> Researched -> Approved -> Drafted) is saved with each run (`totals.funnel`).

## LIVE-1 - CSV runs, Gmail connection, live Claude / Serper / ZeroBounce / page fetcher (2026-10-27)

**CSV as the lead source** (same engine, `apps/worker/src/jobs/run.ts`): a CSV campaign works the leads you imported through clean -> quick check -> research + exact-quote facts -> score -> approve -> verify -> write -> Gmail draft.
- A lead that already has an email never reaches Apollo and never costs a credit; its email is verified with the verifier as usual. Apollo credit limits no longer limit a CSV run (only Apollo-sourced campaigns).
- A lead with no email and no Apollo id goes to **Needs attention** ("No email: add one to the CSV ...") in the clean step, before any research is paid for. The run still completes; the daily summary counts it.
- Approved leads that are still waiting for a draft (a mailbox needed reconnecting, a limit paused a run) are picked up again by the next run and continue where they stopped; no earlier paid step repeats.

**Gmail connection** (`packages/adapters/src/live/`, `apps/web/src/app/api/google/`): `/api/google/connect` + `/api/google/callback`, redirect URI = `NEXT_PUBLIC_SITE_URL` + `/api/google/callback`. Scopes: `gmail.compose` + `gmail.labels` only. State/CSRF = random nonce in a signed 10-minute HttpOnly cookie that also pins the mailbox and the admin who started it. Nothing is stored unless the cookie and `state` match, the same admin is signed in, Google granted a refresh token and both scopes, and the Gmail address that signed in is the mailbox being connected (otherwise that grant is revoked). Refresh tokens: AES-256-GCM with `TOKEN_ENCRYPTION_KEY`, the mailbox id bound in as authenticated data, stored with the service role only. Mailboxes page: Connect / Reconnect / Disconnect per mailbox (two separate Gmail accounts = two mailboxes), status, expiry warning while the Google app is in Testing mode (`GOOGLE_APP_PUBLISHING`), "Create test draft" (addressed to the mailbox itself; nothing is sent). A revoked or expired sign-in turns that mailbox only into `needs_reconnect`; its run stops writing (no model spend) and other mailboxes keep working. Migration `20261027130000_gmail_connection.sql` (applied through the MCP): `inboxes.connected_at`, `last_error`, status `needs_reconnect`.
- Sending stays off and unbuilt: the live adapter has no send call (the architecture test still passes).

**Live adapters, one file each** (`ADAPTER_*` untouched, still mock): Claude (official `@anthropic-ai/sdk` 1.3.0, model from Settings), Serper, ZeroBounce (`VERIFIER_API_KEY` or `ZEROBOUNCE_API_KEY`), page fetcher. Settings > Connections has **Test connection** for Claude, Serper and ZeroBounce: one tiny real call through the same spend guard (price row required, caps checked, usage and cost recorded), whatever `ADAPTER_*` says.

**OpenRouter option (2026-10-27):** `LLM_PROVIDER=anthropic|openrouter` (default anthropic) picks how Claude is reached when `ADAPTER_LLM=live`. OpenRouter: `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer OPENROUTER_API_KEY` (per OpenRouter's API reference; model slugs checked against its public `/api/v1/models`: `anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`). Same interface, retries (429/5xx, Retry-After), JSON checks and token counting; a 200 that carries an error is treated as an error. Settings keep Anthropic ids (`claude-haiku-5-5`); the app sends `anthropic/claude-haiku-5.5` to OpenRouter and converts back when switching to the Anthropic API, and an id with a slash is sent exactly as typed. The three model names (quick check + email check, facts, writing) are now editable under Settings > Daily run. Usage is recorded under provider `openrouter` (own price rows, own provider caps; global and campaign caps unchanged). Units are per model (`input_token@anthropic/claude-haiku-5.5`) so Haiku and Sonnet are costed at their own prices; a plain `input_token` row is the fallback. Cost always comes from the price table; OpenRouter's own figure is shown next to it on the test result only. Settings > Connections shows the provider, the models (and what is sent) and the price-row hint; Test connection uses the selected provider.

**Tests added:** adapters (crypto, OAuth state, Gmail with a scripted fetch incl. two mailboxes, MIME, providers, fetcher/robots), web (callback/connect routes: forged state, wrong account, missing scope ...), worker (Test connection, no network), worker integration (CSV no-email and verify without credit; mailbox needs reconnect; revoke mid-run, other mailbox continues, resume), Playwright `google.spec.ts`.

## Later (deferred on purpose, in rough priority order)

1. **Sending** (screens removed from the UI; the send job, approval records and all guards exist and are tested; `SENDING_ENABLED` is off and has no switch in the app).
2. **Reply tracking and opt-out from replies** (SRS 4.8; the adapter method exists, the screens were removed).
3. **Follow-ups** (SRS 4.8; table and view exist, no screen).
4. **Crunchbase** (adapter slot and flag exist, off; never scraped).
5. Full dashboard, funnel and cost reports; load tests; deployment hardening; pg-boss/Mastra migration (the DB-backed job runner is the engine now; the `pgboss` schema is installed but unused).
6. Extra edge cases: per-mailbox targets with several mailboxes, SRS A4 weekly ramp-up, consent-risk country rules, LinkedIn (off), `over-quota` leads re-queued the next day.

## CORE - the automatic flow from docs/SRS.docx (2026-10-27)

**What a run does** (`apps/worker/src/jobs/run.ts`, rules in `packages/core/src/workflow.ts`, one job per run, lead state in the database so a resume never repeats a paid step - SRS G8):
1. Start: button on **Runs** (with an estimate and a confirm) or the daily schedule (weekdays, 06:30 IST by default, listed holidays skipped, once a day, campaigns that are Active). Run lock (one run at a time, a lock older than 3 h is stale), DRY_RUN mode, 120-minute run limit (pauses; Resume continues), settings check (postal address + opt-out line required before real drafts).
2. Today's number = min(campaign daily cap, mailbox draft cap, daily reveal credits left), never more than the monthly credits left.
3. Apollo people search (free), about target / 0.75 people, imported through the same engine as a CSV (duplicates, suppression/DNC). CSV leads already in the campaign work the same way.
4. Clean: DNC/suppressed, excluded domains/titles/countries, no website, same company within 30 days (also inside the run).
5. Stage A quick check: the homepage must open, then a cheap-model fit check (yes / uncertain / no).
6. Stage B research: up to 6 site pages incl. the careers page, two Serper queries, facts with an **exact quote check** (SRS 7.4: the quote must be on the page named as the source, word for word after tidying; links/emails/instruction words rejected; hiring counts only from the company's own site; stale facts dropped; a lead is skipped when more than 40% of its facts fail). Facts are stored as evidence rows (URL + retrieval date).
7. Score in code (fit 30, role 20, size 15, trigger 25, data 10; weights editable in the `workflow` setting). Approve the top leads at or above the cut-off (55) up to today's number; the rest are skipped with a reason (`below-threshold`, `over-quota`).
8. Credit-guarded reveal (`apps/worker/src/pipeline/reveal.ts`, the only reveal path): approved leads only, never twice for the same person (unique ledger row), 70/day and 2000/month, phone/personal email/waterfall always false, ledger row written **before** the call and completed after, a call that died half-way stays `uncertain` and is never retried automatically. Then role-address check and the verifier (risky/catch-all skipped unless allowed).
9. Write the email (SRS section 8: one verified fact, one process question, tools sentence by industry, the fixed white-label line, soft ask, 60-130 words, no links/exclamation marks/dashes/banned phrases, numbers only from the used fact or the case-study table, footer with postal address + opt-out line), code checks W1-W8 plus the model check C4 (at least 9 of 12, no zero), one rewrite, then `draft-failed`.
10. Gmail draft in the campaign's mailbox with label `AI-Outreach` and a bracketed note on top (score, trigger, source). **No in-app approval step**; failures go to **Needs attention**. Nothing is sent: `SENDING_ENABLED` is off and its switch is hidden in the app.
11. Run log with counts per step, daily summary (drafts, skipped by reason, credits, cost, minutes) on the run page and the dashboard.

**Database:** `supabase/migrations/20261027090000_run_engine.sql` (applied through the MCP): `credit_ledger` (RLS: admin/operator read, writes via the service role only; unique per person) and the extra batch pause reason `time_limit`.

**UI** (minimal, per the SRS note): Dashboard (latest run + needs attention), **Runs** (Start + estimate + dry run, recent runs, Resume/Cancel, run log), **Needs attention** (Skip / Do not contact), Campaigns (settings), Import, Suppression, Mailboxes, Offers, Settings (new "Daily run" section: schedule, cut-off, credit limits, footer text, white-label line, style, tools by industry, example emails, excluded domains/titles, banned phrases, holidays).

**Verified:** lint, typecheck; core unit tests (59, incl. 19 for the SRS rules: quote check, 40% rule, score, top-N, schedule/holidays, credit guard, email rules); worker integration tests against the dev database with mock adapters: the whole Apollo run end to end (drafts in Gmail with label + note + footer, only approved leads revealed, ledger flags all false, nothing sent), resume repeats no paid step, CSV clean/skip reasons + one rewrite + draft-failed in Needs attention, dry run, credit guard refusals (not approved, daily/monthly cap, dry run, never twice, uncertain), and the send safety tests (no send without approval, SENDING_ENABLED off by default, changed draft / inactive inbox / DNC / suppression block the send, exactly-once, unknown Gmail failure never resent, price row + spend cap before live calls).

**How to test it in the UI (mock mode, no keys needed):** see the end of the chat message / README "Try the core flow".

## Phase 3 - CSV/XLSX import (2026-10-26)

**Built**
- `packages/importer` (pure, unit-tested): encoding detection (UTF-8, BOM, UTF-16, Windows-1252), delimiter detection, quoted commas/newlines, blank rows (original row numbers kept), duplicate headers renamed, header-row detection with override, XLSX via exceljs (worksheet list/picker, dates, numbers-as-text, formulas, hyperlinks, rich text), 50,000-row limit with a clear message, column alias auto-detect, Apollo preset, normalisation (emails lowercased for matching but original kept, URLs/domains, free-mail and social domains never become a company, names incl. Hindi/accents intact, employee counts, email status), campaign validation (research-first allows no email), 3-key dedupe (email, profile URL, company+name accent-insensitive), suppression and DNC check, mode logic (add new / update existing / skip duplicates), formula-injection-safe error CSV.
- Worker: `import.run` job (chunks of 500, bulk writes with row-by-row fallback, idempotent, resumable from the rows already recorded, progress in `import_batches.totals`, contacts/companies/leads/`lead_events`), DB-backed job runner (atomic claim, retries with backoff, stale-job recovery; pg-boss replaces polling in Phase 4).
- Web: Import list + upload (private `imports` bucket, SHA-256 file hash, same-file warning), preview of the first 20 rows, sheet picker, header override, mapping UI with auto-detect / Apollo preset / saved templates, modes + dry run, live progress, summary (imported, updated, duplicate, invalid, suppressed, skipped, failed), per-row reasons, "not imported" CSV download.
- Migration `20261026120000_import_support.sql` (applied by hand in the SQL editor after the MCP declined it): modes, `updated`/`failed` row statuses, `import_templates` (RLS + audit), `contacts.company_name`.

**Verified:** lint, typecheck; 67 unit tests (core 23, importer 30, adapters 10 ...) plus 20 worker tests, of which 11 run against the real dev database and clean up after themselves (0 residue verified); 26 Playwright tests (health, auth, roles, setup screens, and the full import flow incl. dry run, real run, duplicate re-upload, Excel, research-first, 50,001 rows, Windows-1252). Bugs the tests caught and fixed: jsonb lost column order in the CSV, forms were wiped on validation error, sign-out revoked a shared session.

**Notes:** e2e signs in once per role and reuses the session (hosted sign-in rate limit); run the suite at most a few times in a row. The worker must be running for imports (`pnpm dev` starts it). Integration tests remove their data with a direct DB connection, so they need `DATABASE_URL`; without it they are skipped with a warning.

**How to verify in the UI:** Import > choose a campaign and an Apollo CSV > check the preview and mapping > dry run > review the summary > run for real > Leads shows the new people; download the not-imported CSV.

## Phase 2 - Auth and setup screens (2026-10-26)

**Built**
- Supabase Auth: email + password and optional magic link (never creates accounts). `src/proxy.ts` (Next 16 name for middleware) refreshes the session with `getClaims()` and sends anonymous visitors to /login (with a safe `next`). Authorization is re-checked against the database on every page and every server action (`lib/auth.ts`: `requireUser`, `guardAction`, pure `evaluateGuard`).
- Roles, one matrix in `packages/core/src/permissions.ts` (UI, pages, actions) mirrored by RLS: reviewer = review/edit/approve a Gmail DRAFT only; **only sender and admin approve or send**; operator runs campaigns/offers/suppression; admin owns settings, inboxes, suppression removal, audit view.
- Disabled users: `profiles.disabled` makes `private.app_role()` return null, so RLS denies everything at once; pages send them to /no-access on the next request.
- App shell with all 13 nav items, filtered by role. Real screens: Dashboard (counts), Campaigns (list, 4-step wizard with ICP editor, roles, thresholds, caps, offer, tone, CTA, inbox, send window; edit; archive = soft delete), Offers + case studies (CRUD, allowed claims, allowed numbers), Suppression (add email/domain, global or per campaign, CSV upload with row-level reporting, admin-only removal), Inboxes (limits; Google connect is Phase 10), Settings (models per task, research depth, feature flags CRUNCHBASE_ENABLED / REPLY_TRACKING_ENABLED / SENDING_ENABLED default off, price table, spend caps, recent audit log), Leads (read-only list). Import, Review, Sending, Follow-ups, Jobs, Usage & Cost are labelled placeholders for their phases.
- Every config change writes `audit_log` by database trigger (campaigns, offers, case studies, suppression, settings, prices, caps, inboxes, profiles; refresh tokens are redacted), so no code path can forget it.
- Forms keep what the user typed when validation fails (shared `useActionForm`; React 19 would otherwise reset the form).
- `pnpm user:create --email x --role admin` bootstraps users (prints a one-time password); `--disable` / `--enable` toggles access.
- Migration `20261026101009_disabled_users_and_audit.sql` (applied through the MCP).

**Verified:** lint, typecheck, 65 unit/DB tests (core 23, db 7 incl. 4 SQL suites, adapters 10, worker 8, web 17), 19 Playwright tests: zero-key mock server (health + login explains missing DB) and the real dev project (login, wrong password, wizard validation and create, offer + case study, suppression form + CSV + admin remove, settings/price/cap validation + audit, disabled user locked out on next request, sign-out, navigation per role, forbidden URLs per role, read-only views). Teardown disables the e2e accounts and archives e2e data; verified 0 usable accounts left.

**How to verify in the UI:** `pnpm user:create --email you@x.com --role admin`, `pnpm dev`, sign in at http://localhost:3000, create a campaign, an offer and a suppression row; sign in as a reviewer and confirm Settings is absent and /settings shows "Not allowed".

## Phase 0 - Foundation (2026-10-26)

**Built**
- pnpm workspace (exact-pinned deps via `.npmrc save-exact`): `apps/web` (Next 16 App Router, TS strict, Tailwind 4, shadcn/ui), `apps/worker` (Node + tsx), `packages/core`, `packages/db`, `packages/adapters`.
- `packages/core`: `normalizeEmail/Domain`, `computeCostUsd` (usage x editable price table, throws `MissingPriceError` when a unit has no price), `formatKolkata`.
- `packages/db`: browser / server / service Supabase clients (service client normalises pasted URLs and works on Node 20 via `ws`), generated types, heartbeat helpers, the SQL-suite test runner.
- `packages/adapters`: interfaces + mock + live selection for llm, search, fetcher, crunchbase, apollo, verifier, gmail (+ a separate `GmailSender`). `ADAPTER_<NAME>=mock|live`, default mock; live mode names every missing env var at once. Real sending additionally needs `ALLOW_LIVE_SEND=true` (enforced in Phase 11).
- Architecture test: the Gmail send API may appear only in `apps/worker/src/jobs/send.ts`; `gmailSender` may only be wired in the adapters package and that job.
- `env.ts` (zod) in web and worker: one error listing all problems; mock mode needs zero keys; empty values count as unset.
- `/api/health` (DB + worker heartbeat, pure `buildHealth` logic), home page health badge, worker heartbeat loop writing `worker_heartbeats`.
- ESLint (shared flat config + eslint-config-next), Prettier, Vitest, Playwright, tsx; scripts `dev build lint typecheck test e2e format`.
- Worker `Dockerfile`, GitHub Actions CI (lint, typecheck, test, e2e), `.env.example` with every variable, README, CLAUDE.md, BLOCKERS.md.

**Verified:** lint, typecheck, test (33 tests across 5 packages, 0 skipped, incl. the 3 DB SQL suites against the dev project), e2e (2 Playwright tests on a production build in mock mode with no keys). Worker run against the dev DB wrote a heartbeat row.

**Deviations from the plan (intentional)**
- Live adapters are implemented in the phase that needs them (6 search/fetcher, 7 crunchbase, 8 apollo/verifier, 9 llm, 10 gmail, 11 sender). Until then a live adapter throws `LiveAdapterNotImplementedError`, so a half-configured setup fails loudly. Mocks are complete.
- Mastra and pg-boss are installed in Phase 4 (their docs must be checked against the installed versions first, per the rules).
- Dockerfile and CI workflow are written but not executed here (no Docker/GitHub runner in this session).

**How to verify in the UI:** `pnpm install && pnpm dev`, open http://localhost:3000: heading "AI Outreach Engine" and a green "Healthy" badge; http://localhost:3000/api/health returns JSON `status: "ok"`.

## Phase 1 - Database (2026-10-26)

**Built** (5 migrations in `supabase/migrations/`, applied through the Supabase MCP, versions match `list_migrations`):
- 28 tables from the plan, all with `id uuid`, `created_at`, `updated_at` (timestamptz, UTC) and an `updated_at` trigger; plus `worker_heartbeats` (29).
- Constraints: `contacts.email_lower` generated (lowercased, original kept) UNIQUE NULLS DISTINCT, `profile_url` UNIQUE, `companies.domain` UNIQUE lowercase, `UNIQUE(campaign_id, contact_id)`, idempotency keys on drafts/jobs/sends, one evidence row per (company, url).
- Guards: `email_sends` INSERT trigger (approval of the exact body hash, recipient == lead contact, DNC, global/campaign/domain suppression, one active-or-sent row per lead+step, active inbox, daily cap in Asia/Kolkata days); re-check of DNC/suppression on the move to `sending`; sent rows cannot regress; approved drafts are immutable; `lead_events`, `audit_log`, `send_approvals` are append-only (privileges revoked + triggers, incl. TRUNCATE); campaigns/leads/contacts/companies/drafts/sends/replies cannot be hard-deleted (soft delete via `deleted_at`, FKs are RESTRICT).
- RLS on every table, policies by `profiles.role` (admin / operator / reviewer / sender) through `private.app_role()`; `anon` has no access; `inboxes.encrypted_refresh_token` is not readable or writable by any user role (column-level grants; service role only).
- Views (security_invoker): `v_daily_metrics`, `v_campaign_performance`, `v_cost_summary`, `v_followups_due`.
- Seed (now `supabase/defaults.sql` for the time zones and global caps, and `supabase/test-data/demo_seed.sql` for the demo rows; both idempotent, loaded by hand only, never by the app): 1 demo campaign, 2 offers, 2 case studies, 3 suppression rows, 10 fake leads on `acme-NN.example.com`, a disconnected demo inbox, display-timezone setting, global spend caps ($5/day, $50/month). `price_table` is intentionally empty: enter provider prices in the UI (Phase 2) before any paid call.
- Generated types: `packages/db/src/database.types.ts`.
- Advisors: security = no findings (fixed the pre-existing `rls_auto_enable()` RPC exposure). Performance = only INFO "unused index" on a near-empty DB.

**Tests** (`supabase/tests/`): `001_send_guard.sql`, `002_history_and_structure.sql`, `003_rls_roles.sql` (+ `_helpers.sql`). Each runs in one DO block that ends with `raise exception 'SUITE_OK'`, so all fixtures roll back. They run in `pnpm test` (packages/db) against `DATABASE_URL`; a negative control confirmed the assertions can fail.

**How to verify in the UI:** Supabase dashboard > Table editor: 29 tables, RLS badge on each; `campaigns` has "Demo campaign"; `campaign_leads` has 10 rows; `suppression` has 3. Database > Advisors shows no security issues. Try `delete from campaigns` or `update lead_events ...` in the SQL editor: both are rejected.

**Sender-only send approval (2026-10-26, migration `20261026100000_send_approval_by_sender.sql`)**
- Roles: reviewer = review, edit, regenerate, skip, mark DNC, approve a Gmail DRAFT only. sender and admin = the only roles that can approve SENDING (`send_approvals` insert, in their own name) or send. Operators cannot approve.
- DB guard also rejects any email whose contact `email_status` is `invalid`.
- Applied by hand in the Supabase SQL editor (the MCP declined it), so `supabase_migrations` history does not list it; the DDL is idempotent (drop policy / create or replace) and verified live. Tests 001 and 003 cover: reviewer approval fails, sender and admin approval succeed, invalid-email send blocked.

**Notes for later phases**
- No profile row is created on sign-up. The first admin must be inserted into `profiles` (service role / SQL editor). Phase 2 handles bootstrap.
- Phase 2 role guards must follow the sender-only rule above (UI and server actions).
- Drafts must store `body_hash`; approvals must copy the same hash. Changing a draft after approval requires a new version.
