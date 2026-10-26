# AI Outreach Engine – project rules

Sources of truth: docs/SPEC.docx (v2; Section 23 overrides older sending wording), docs/IMPLEMENTATION_PLAN.md, PROGRESS.md, BLOCKERS.md.

## Non-negotiable rules
- No email is ever sent without an explicit, recorded user approval for that email or a reviewed batch. Draft creation and sending are separate stages.
- The Gmail send call exists in exactly one module (the send job). Tests prove unapproved, suppressed, already-sent or capped emails cannot be sent.
- Check Do Not Contact at import, before research spend, before drafting, and immediately before every send.
- Never invent facts. Every personalization claim links to a stored evidence row (URL + retrieval date). Unsupported claims fail the quality check.
- Every job is idempotent (unique keys) and resumable from its last completed step.
- Secrets only in env vars. OAuth refresh tokens encrypted (AES-256-GCM). The Supabase service-role/secret key is used only server-side and in the worker.
- RLS is enabled on every table. No paid call happens without a spend-cap check.
- Costs are calculated from recorded usage x editable price table; never hard-coded.
- Never scrape Crunchbase or LinkedIn; never bypass paywalls, logins or CAPTCHAs.
- Pin dependency versions. Before using Mastra, Gmail or Anthropic SDK APIs, check the installed version's docs.

## Workflow
- DB changes: apply via Supabase MCP AND save the SQL in supabase/migrations/ (repo is the record).
- A phase is DONE only when lint, typecheck, tests pass, advisors show no new errors, PROGRESS.md is updated and a commit "phase <n>: <title>" exists.
- Missing credentials: real adapter + mock adapter behind one interface, env-flag selected, item added to BLOCKERS.md.
- Timestamps are stored in UTC (timestamptz) and displayed in Asia/Kolkata.

## Roles
- reviewer: review/edit/regenerate/skip/mark DNC/approve a Gmail DRAFT only. sender + admin: the only roles that approve SENDING or send. Enforced in RLS, server actions and UI.
- An email with email_status = invalid can never be queued.

## Standing rules for the autopilot run (owner decision, 2026-10-26)
- Migrations may touch any schema WE own (public, pgboss, new ones). Never write into Supabase-managed schemas (storage, auth, realtime, vault); dashboard-only needs go to BLOCKERS.md "Dashboard steps for owner".
- If apply_migration is declined, retry once. If it is declined again: do NOT stop the run. Save the SQL in supabase/manual/, list it in BLOCKERS.md under "SQL for owner to run" (exact clicks + a verify query), continue with the code and tests that do not need it, and make tests that need it skip with a loud warning until the object exists. Never apply DDL through execute_sql or a direct connection to get around a decline.
- Stop the whole run ONLY for: a real email send, real money beyond the configured caps, or deleting data in a non-dev database.
