# PROGRESS

| Phase | Title | Status | Date |
|-------|-------|--------|------|
| 0 | Foundation | DONE (see deviations) | 2026-10-26 |
| 1 | Database | DONE | 2026-10-26 |
| 2 | Auth and setup screens | next | |
| 3-13 | | not started | |

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
- Seed (`supabase/seed.sql`, idempotent, applied): 1 demo campaign, 2 offers, 2 case studies, 3 suppression rows, 10 fake leads on `acme-NN.example.com`, a disconnected demo inbox, display-timezone setting, global spend caps ($5/day, $50/month). `price_table` is intentionally empty: enter provider prices in the UI (Phase 2) before any paid call.
- Generated types: `packages/db/src/database.types.ts`.
- Advisors: security = no findings (fixed the pre-existing `rls_auto_enable()` RPC exposure). Performance = only INFO "unused index" on a near-empty DB.

**Tests** (`supabase/tests/`): `001_send_guard.sql`, `002_history_and_structure.sql`, `003_rls_roles.sql` (+ `_helpers.sql`). Each runs in one DO block that ends with `raise exception 'SUITE_OK'`, so all fixtures roll back. They run in `pnpm test` (packages/db) against `DATABASE_URL`; a negative control confirmed the assertions can fail.

**How to verify in the UI:** Supabase dashboard > Table editor: 29 tables, RLS badge on each; `campaigns` has "Demo campaign"; `campaign_leads` has 10 rows; `suppression` has 3. Database > Advisors shows no security issues. Try `delete from campaigns` or `update lead_events ...` in the SQL editor: both are rejected.

**Notes for later phases**
- No profile row is created on sign-up. The first admin must be inserted into `profiles` (service role / SQL editor). Phase 2 handles bootstrap.
- Drafts must store `body_hash`; approvals must copy the same hash. Changing a draft after approval requires a new version.
