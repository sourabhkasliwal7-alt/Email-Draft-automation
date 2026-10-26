# BLOCKERS

| # | Need | Where to put it | How to verify |
|---|------|-----------------|---------------|
| 1 | Phase 0 is not finished (monorepo apps, adapters, CI) | Build it (next task) | `pnpm dev`, `pnpm lint/typecheck/test` pass |
| 2 | Real Postgres connection strings: `DATABASE_URL` (session pooler) and `DATABASE_POOLER_URL` (transaction pooler) are placeholders in `.env` | Supabase dashboard > Connect > copy the pooler URLs, with the DB password, into `.env` | `pnpm --filter @outreach/db test` runs 3 SQL suites (none skipped) |
