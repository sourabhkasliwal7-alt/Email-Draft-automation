# BLOCKERS

Nothing blocks progress. The build continues on mock adapters; the items below need a human at some point.

## Keys and accounts

| # | Need | Where to put it | Needed by |
|---|------|-----------------|-----------|
| 1 | Node 22+ recommended (supabase-js deprecates Node 20; CI and Docker use 22; local Node 20 works through a `ws` fallback) | install Node 22 | before deploy |
| 2 | Anthropic API key | `.env` `ANTHROPIC_API_KEY`, `ADAPTER_LLM=live` | Phase 9 |
| 3 | Serper API key | `.env` `SERPER_API_KEY`, `ADAPTER_SEARCH=live` | Phase 6 |
| 4 | Google Cloud OAuth client + Gmail API; `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) | `.env` | Phase 10 |
| 5 | Email verifier + Apollo keys; Crunchbase licence decision | `.env` | Phases 7-8 |
| 6 | Hosting: Vercel (web) + VPS/Railway/Render (worker) | n/a | Phase 13 |
| 7 | First admin: `pnpm user:create --email you@company.com --role admin` | terminal | now |
| 8 | `pnpm e2e` creates five `e2e-*@example.com` accounts in the Supabase project (disabled and banned afterwards). Use a separate dev project if you do not want that in the main one | n/a | optional |

## Dashboard steps for owner

Migrations never write into Supabase-managed schemas (storage, auth, realtime, vault). Anything that needs the dashboard is listed here with exact clicks; the build continues with a mock or a check that skips it.

| # | Step | Exact clicks | Status |
|---|------|--------------|--------|
| D1 | Private `imports` Storage bucket (25 MB limit) | Storage > New bucket > name `imports`, Public OFF, file size limit 25 MB | DONE (verified through the MCP) |
| D2 | Leaked password protection | Authentication > Sign In / Providers > Email > enable "Prevent use of leaked passwords" (may need a paid plan; this is the only open security advisor) | open |
| D3 | Close self sign-up | Authentication > Sign In / Providers > turn OFF "Allow new users to sign up" (users are created with `pnpm user:create`; a self-signed-up user has no profile and no access anyway) | open |
| D4 | Redirect URL for magic links (only if you use them) | Authentication > URL Configuration > add `http://localhost:3000/auth/callback` and your production URL | open |
