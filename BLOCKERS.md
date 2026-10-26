# BLOCKERS

Nothing blocks progress yet. Items below need a human at some point; the build continues on mock adapters meanwhile.

| # | Need | Where to put it | How to verify | Needed by |
|---|------|-----------------|---------------|-----------|
| 1 | Node 22+ recommended (supabase-js deprecates Node 20; CI and Docker already use 22). Local Node 20 works through a `ws` fallback | Install Node 22 | `node -v` | before deploy |
| 2 | Anthropic API key | `.env` `ANTHROPIC_API_KEY`, `ADAPTER_LLM=live` | Phase 9 | 9 |
| 3 | Serper API key | `.env` `SERPER_API_KEY`, `ADAPTER_SEARCH=live` | Phase 6 | 6 |
| 4 | Google Cloud OAuth client + Gmail API, `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) | `.env` | Phase 10 | 10 |
| 5 | Email verifier + Apollo keys; Crunchbase licence decision | `.env` | Phases 7-8 | 7-8 |
| 6 | Hosting: Vercel (web) + VPS/Railway/Render (worker) | n/a | Phase 13 | 13 |
| 7 | Supabase Auth: turn on **Leaked password protection** (advisor warning; Auth > Sign In / Providers > Password; may need a paid plan) and turn **off** "Allow new users to sign up" (users are created with `pnpm user:create`; a self-signed-up user has no profile and gets no access anyway) | Supabase dashboard | Advisors > Security shows no warning | before deploy |
| 8 | Create your first admin: `pnpm user:create --email you@company.com --role admin` | terminal | sign in at /login | now |
| 9 | e2e creates five `e2e-*@example.com` accounts in the Supabase project during `pnpm e2e` (disabled + banned afterwards). Use a separate dev project if you do not want that in the main one | n/a | `select * from profiles where full_name like 'E2E %'` shows disabled=true | optional |
