# BLOCKERS

Nothing blocks progress yet. Items below need a human at some point; the build continues on mock adapters meanwhile.

| # | Need | Where to put it | How to verify | Needed by |
|---|------|-----------------|---------------|-----------|
| 1 | `.env` has `NEXT_PUBLIC_SUPABASE_URL=.../rest/v1/`. Code now tolerates it, but the value should be the bare project URL | `.env`: `https://jeawtevsdfcuztpmsquv.supabase.co` | n/a | cosmetic |
| 2 | Node 22+ recommended (supabase-js deprecates Node 20; CI and Docker already use 22). Local Node 20 works through a `ws` fallback | Install Node 22 | `node -v` | before deploy |
| 3 | Anthropic API key | `.env` `ANTHROPIC_API_KEY`, `ADAPTER_LLM=live` | Phase 9 | 9 |
| 4 | Serper API key | `.env` `SERPER_API_KEY`, `ADAPTER_SEARCH=live` | Phase 6 | 6 |
| 5 | Google Cloud OAuth client + Gmail API, `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) | `.env` | Phase 10 | 10 |
| 6 | Email verifier + Apollo keys; Crunchbase licence decision | `.env` | Phases 7-8 | 7-8 |
| 7 | Hosting: Vercel (web) + VPS/Railway/Render (worker) | n/a | Phase 13 | 13 |
