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

## Try the core flow (mock mode, no keys, nothing real is sent)

The workflow follows `docs/SRS.docx`. With the default `ADAPTER_*=mock` it searches mock Apollo people, checks and researches mock company sites, scores, "reveals" mock emails for the best leads and puts drafts in a mock Gmail. Real Gmail, Apollo and Anthropic arrive with the live adapters (see `PROGRESS.md` > Later).

1. `pnpm dev` (web on :3000 and the worker). Sign in as an admin.
2. **Offers**: create an offer (name only is enough). **Mailboxes**: add a mailbox (any email, status Active, display name e.g. "Sam"). **Settings > Daily run**: fill *Postal address* and *Opt-out line* and press **Save run settings** (real drafts are refused without them).
3. **Campaigns > New campaign**: name it, in step 1 set *Lead source* to **Apollo**, pick the offer and the mailbox, set *Daily cap* to e.g. 6, save.
4. **Runs**: choose the campaign, tick **Dry run** for a first look (nothing is made), press **Start**, confirm. Then run it again without Dry run.
5. Watch the row on **Runs** change step by step; open **Log** for the counts per step (search, clean, quick check, research and score, approve, reveal and verify, drafts) and why leads were skipped.
6. The drafts: open the run (**Log**). **Gmail drafts from this run** lists every draft with its subject, recipient, score and full text (click a row). In mock mode the "Gmail" is a stand-in, so this list is where you read them; with the live Gmail adapter the same drafts appear in the mailbox under the label `AI-Outreach`, each with the bracketed note on top. Leads with a problem appear on **Needs attention**.

## Live test: one Gmail account, 5 CSV leads (real services, drafts only, nothing is sent)

Needs the Google Cloud steps D5 in `BLOCKERS.md` (redirect URI `http://localhost:3000/api/google/callback`, scopes `gmail.compose` + `gmail.labels`, your Gmail as a Test user) and the keys in `.env`. Keep every `ADAPTER_*` on `mock` until step 3.

1. **Gmail**: `pnpm dev`, sign in as admin, **Mailboxes > Add mailbox** (your Gmail address) > **Connect Gmail**, tick both permissions. Press **Create test draft**: a draft addressed to yourself appears in Gmail > Drafts (this works while `ADAPTER_GMAIL=mock`).
2. **Providers**: **Settings > Price table**: one row per unit (anthropic `input_token` + `output_token`, serper `search`, verifier `verification`; use your plan's real prices). **Settings > Connections > Test connection** for Claude, Serper, ZeroBounce.
3. **Go live** in `.env`: `ADAPTER_LLM=live`, `ADAPTER_SEARCH=live`, `ADAPTER_FETCHER=live`, `ADAPTER_VERIFIER=live`, `ADAPTER_GMAIL=live` (leave `ADAPTER_APOLLO=mock`), then restart `pnpm dev`.
4. **CSV**: columns `First Name, Last Name, Title, Company, Website, Email`: five real small-company websites, and as the email your own address with a tag (`you+lead1@gmail.com` ...), so even a mistaken send only reaches you. **Campaigns > New campaign**: *Lead source* = CSV import, your mailbox. **Import** the file into it.
5. **Runs**: tick **Dry run**, Start. Then Start again without Dry run. Drafts appear in the mailbox's Gmail Drafts; each begins with the bracketed `[AI note ...]` line to delete.

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
