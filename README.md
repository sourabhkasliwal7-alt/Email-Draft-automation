# AI Outreach Engine

Research leads, draft personalised emails with evidence, and send **only after explicit human approval**.
Read `CLAUDE.md` (rules), `docs/IMPLEMENTATION_PLAN.md` (phases) and `PROGRESS.md` (status) first.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js app (App Router, Tailwind, shadcn/ui). `/api/health` reports DB + worker liveness. |
| `apps/worker` | Long-running worker (heartbeat now; pg-boss + Mastra workflows from Phase 4). |
| `packages/core` | Pure domain logic: normalisation, cost math, time. |
| `packages/db` | Supabase clients (browser / server / service), generated types, heartbeat helpers. |
| `packages/adapters` | Interfaces + mock (+ live) for llm, search, fetcher, crunchbase, apollo, verifier, gmail. |
| `supabase/` | `migrations/` (the record of the schema), `seed.sql`, `tests/` (SQL suites). |

## Run locally (zero external keys)

```bash
pnpm install
cp .env.example .env        # leave everything empty to run in mock mode
pnpm dev                    # web on :3000, worker heartbeat
```

Open http://localhost:3000 - the badge turns green; `GET /api/health` returns the JSON report.
Add the Supabase variables to `.env` to use the real dev database; the worker then writes `worker_heartbeats`.

## First user

Sign-up is closed; users are created by an admin: `pnpm user:create --email you@company.com --role admin` (prints a one-time password). `--disable` / `--enable` turns access off or on immediately.

## Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e` (Playwright, needs `pnpm --filter @outreach/web exec playwright install chromium` once) · `pnpm build` · `pnpm format`

## Adapters

Each outside service is selected by `ADAPTER_<NAME>=mock|live` (default `mock`). Live mode checks its keys at startup and
lists everything missing. A live adapter whose phase has not been built yet throws a clear error instead of silently doing nothing.
Real sending needs `ADAPTER_GMAIL=live` **and** `ALLOW_LIVE_SEND=true`.

## Database tests

`supabase/tests/*.sql` are self-rolling-back suites (each ends with `raise exception 'SUITE_OK'`). With a real `DATABASE_URL`,
`pnpm --filter @outreach/db test` runs them; otherwise run them through the Supabase MCP / SQL editor.
