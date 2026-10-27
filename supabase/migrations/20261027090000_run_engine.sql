-- SRS core flow: the credit ledger (one reveal per person, ever), a longer list of batch pause reasons.
-- The run lock and the workflow config live in `settings` (keys run_lock, workflow), so no other table is needed.

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  campaign_lead_id uuid references public.campaign_leads(id) on delete restrict,
  batch_id uuid references public.pipeline_batches(id) on delete restrict,
  provider text not null default 'apollo',
  apollo_person_id text,
  -- started = row written BEFORE the call; done / no_email / failed = written after; uncertain = the call may have spent a credit but the result was lost
  status text not null default 'started' check (status in ('started', 'done', 'no_email', 'failed', 'uncertain')),
  credits int not null default 1 check (credits >= 0),
  flags jsonb not null default '{}'::jsonb,
  is_mock boolean not null default false,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- "never twice": one reveal row per person per provider
create unique index credit_ledger_one_reveal on public.credit_ledger (contact_id, provider);
create index credit_ledger_lead_idx on public.credit_ledger (campaign_lead_id);
create index credit_ledger_batch_idx on public.credit_ledger (batch_id);
create index credit_ledger_started_idx on public.credit_ledger (started_at);

create trigger set_updated_at before update on public.credit_ledger for each row execute function private.set_updated_at();
create trigger block_delete before delete on public.credit_ledger for each row execute function private.block_delete();
create trigger block_truncate before truncate on public.credit_ledger for each statement execute function private.block_delete();

alter table public.credit_ledger enable row level security;
create policy credit_ledger_select on public.credit_ledger for select to authenticated
  using ((select private.app_role()) in ('admin', 'operator'));
revoke all on public.credit_ledger from anon;
revoke insert, update, delete, truncate, references, trigger on public.credit_ledger from authenticated;

alter table public.pipeline_batches drop constraint pipeline_batches_pause_reason_check;
alter table public.pipeline_batches add constraint pipeline_batches_pause_reason_check
  check (pause_reason is null or pause_reason in ('manual', 'cap', 'missing_price', 'campaign_paused', 'worker_stopping', 'time_limit'));
