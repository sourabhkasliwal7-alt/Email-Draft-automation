# PROGRESS

| Phase | Title | Status | Date |
|-------|-------|--------|------|
| 0 | Foundation (monorepo, adapters, CI) | **NOT DONE** - only a minimal scaffold exists (root workspace, packages/db, CLAUDE.md, BLOCKERS.md). Apps, adapters, env.ts, ESLint/Prettier/Playwright, Dockerfile, CI, README still to build. | |
| 1 | Database | DONE (see caveat) | 2026-10-26 |
| 2 | Auth and setup screens | next | |

## Phase 1 - Database (2026-10-26)

**Built** (5 migrations in `supabase/migrations/`, applied through the Supabase MCP, versions match `list_migrations`):
- 28 tables from the plan, all with `id uuid`, `created_at`, `updated_at` (timestamptz, UTC) and an `updated_at` trigger; plus `worker_heartbeats` for the Phase 0 health check.
- Constraints: `contacts.email_lower` generated (lowercased, original kept) UNIQUE NULLS DISTINCT, `profile_url` UNIQUE, `companies.domain` UNIQUE lowercase, `UNIQUE(campaign_id, contact_id)`, idempotency keys on drafts/jobs/sends, one evidence row per (company, url).
- Guards: `email_sends` INSERT trigger (approval of the exact body hash, recipient == lead contact, DNC, global/campaign/domain suppression, one active-or-sent row per lead+step, active inbox, daily cap in Asia/Kolkata days); re-check of DNC/suppression on the move to `sending`; sent rows cannot regress; approved drafts are immutable; `lead_events`, `audit_log`, `send_approvals` are append-only (privileges revoked + triggers, incl. TRUNCATE); campaigns/leads/contacts/companies/drafts/sends/replies cannot be hard-deleted (soft delete via `deleted_at`, FKs are RESTRICT).
- RLS on every table, policies by `profiles.role` (admin / operator / reviewer / sender) through `private.app_role()`; `anon` has no access; `inboxes.encrypted_refresh_token` is not readable or writable by any user role (column-level grants; service role only).
- Views (security_invoker): `v_daily_metrics`, `v_campaign_performance`, `v_cost_summary`, `v_followups_due`.
- Seed (`supabase/seed.sql`, idempotent, applied): 1 demo campaign, 2 offers, 2 case studies, 3 suppression rows, 10 fake leads on `acme-NN.example.com`, a disconnected demo inbox, display-timezone setting, global spend caps ($5/day, $50/month). `price_table` is intentionally empty: enter provider prices in the UI (Phase 2) before any paid call.
- Generated types: `packages/db/src/database.types.ts`.
- Advisors: security = no findings (fixed the pre-existing `rls_auto_enable()` RPC exposure). Performance = only INFO "unused index" on an empty DB.

**Tests** (`supabase/tests/`): `001_send_guard.sql`, `002_history_and_structure.sql`, `003_rls_roles.sql` (+ `_helpers.sql`). Each runs in one DO block that ends with `raise exception 'SUITE_OK'`, so all fixtures roll back. All three returned SUITE_OK against the dev project through the MCP, a negative control confirmed the assertions can fail, and a leak check showed no test rows remained.

**Caveat:** `pnpm test` currently runs the file-level check and *skips* the 3 DB suites because `.env` `DATABASE_URL` is still a placeholder (BLOCKERS #2). The suites were verified through the MCP, not through vitest. Once the URL is set, `pnpm test` runs them.

**How to verify in the UI:** Supabase dashboard > Table editor: 29 tables, RLS badge on each; `campaigns` has "Demo campaign"; `campaign_leads` has 10 rows; `suppression` has 3. Database > Advisors shows no security issues. Try `delete from campaigns` or `update lead_events ...` in the SQL editor: both are rejected.

**Notes for later phases**
- No profile row is created on sign-up. The first admin must be inserted into `profiles` (service role / SQL editor). Phase 2 should handle bootstrap.
- Drafts must store `body_hash`; approvals must copy the same hash. Changing a draft after approval requires a new version.
