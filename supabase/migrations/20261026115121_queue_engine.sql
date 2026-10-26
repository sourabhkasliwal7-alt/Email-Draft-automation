-- Phase 4: queue and workflow engine (public + private schemas only).
-- * pipeline_batches: one row per "Start" of a campaign run (running / paused / cancelled / completed)
-- * jobs gets batch_id, campaign_lead_id, dispatched_at, queue_job_id, result; failed == dead-letter state
-- * job_steps.output; usage_records reservations (idempotent, status reserved/recorded/released, is_mock)
-- * research_runs.idempotency_key
-- * private.reserve_spend / settle_spend / release_spend: atomic spend-cap guard (windows in Asia/Kolkata)

-- ---------------------------------------------------------------- pipeline_batches
create table public.pipeline_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  label text,
  status text not null default 'running' check (status in ('running', 'paused', 'cancelled', 'completed')),
  pause_reason text check (pause_reason is null or pause_reason in ('manual', 'cap', 'missing_price', 'campaign_paused', 'worker_stopping')),
  pause_detail jsonb not null default '{}'::jsonb,
  estimate jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  fanout_done boolean not null default false,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pipeline_batches_campaign_id_idx on public.pipeline_batches (campaign_id);
create index pipeline_batches_started_by_idx on public.pipeline_batches (started_by);
create index pipeline_batches_status_idx on public.pipeline_batches (status);
-- one active (running or paused) batch per campaign
create unique index pipeline_batches_one_active on public.pipeline_batches (campaign_id) where status in ('running', 'paused');

create or replace function private.guard_batch_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if (old.status = 'running' and new.status in ('paused', 'cancelled', 'completed'))
     or (old.status = 'paused' and new.status in ('running', 'cancelled'))
     or (old.status = 'completed' and new.status = 'running') then
    return new;
  end if;
  raise exception 'illegal batch transition %->%', old.status, new.status using errcode = 'P0001';
end $$;

create trigger guard_batch_transition before update of status on public.pipeline_batches
  for each row execute function private.guard_batch_transition();
create trigger set_updated_at before update on public.pipeline_batches for each row execute function private.set_updated_at();
-- progress counters (totals) change every few seconds and are not audited; lifecycle changes are
create trigger audit_change after insert or delete or update of status, pause_reason, pause_detail on public.pipeline_batches for each row execute function private.audit_change();
create trigger block_delete before delete on public.pipeline_batches for each row execute function private.block_delete();
create trigger block_truncate before truncate on public.pipeline_batches for each statement execute function private.block_delete();

alter table public.pipeline_batches enable row level security;
-- reads for admin/operator only; writes happen through the service role (server actions + worker)
create policy pipeline_batches_select on public.pipeline_batches for select to authenticated
  using ((select private.app_role()) in ('admin', 'operator'));
revoke all on public.pipeline_batches from anon;
revoke insert, update, delete, truncate, references, trigger on public.pipeline_batches from authenticated;

-- ---------------------------------------------------------------- jobs
alter table public.jobs
  add column batch_id uuid references public.pipeline_batches(id) on delete restrict,
  add column campaign_lead_id uuid references public.campaign_leads(id) on delete restrict,
  add column dispatched_at timestamptz,
  add column queue_job_id text,
  add column result jsonb not null default '{}'::jsonb;
create index jobs_batch_id_idx on public.jobs (batch_id);
create index jobs_campaign_lead_id_idx on public.jobs (campaign_lead_id);
create index if not exists jobs_campaign_id_idx on public.jobs (campaign_id);
create index jobs_dispatch_idx on public.jobs (run_after) where status = 'pending' and dispatched_at is null and type = 'lead.pipeline';

-- ---------------------------------------------------------------- job_steps
alter table public.job_steps add column output jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- usage_records (reservations)
alter table public.usage_records
  add column idempotency_key text,
  add column status text not null default 'recorded' check (status in ('reserved', 'recorded', 'released')),
  add column is_mock boolean not null default false,
  add column step text;
create unique index usage_records_idempotency_key on public.usage_records (idempotency_key) where idempotency_key is not null;
create index usage_records_provider_created_idx on public.usage_records (provider, created_at);

-- ---------------------------------------------------------------- research_runs
alter table public.research_runs add column idempotency_key text;
create unique index research_runs_idempotency_key on public.research_runs (idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------- spend guard (worker only; not API-exposed)
create or replace function private.reserve_spend(
  p_idem text, p_provider text, p_operation text, p_est_usd numeric, p_campaign uuid, p_lead uuid, p_job uuid,
  p_step text, p_mock boolean default false, p_now timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing record;
  v_day timestamptz := date_trunc('day', p_now at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_month timestamptz := date_trunc('month', p_now at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_cap record;
  v_from timestamptz;
  v_spent numeric;
  v_worst jsonb := null;
  v_worst_remaining numeric := null;
  v_usage uuid;
begin
  perform pg_advisory_xact_lock(hashtext('outreach_spend_guard'));

  select id, status into v_existing from public.usage_records where idempotency_key = p_idem;
  if found then
    return jsonb_build_object('ok', true, 'usage_id', v_existing.id, 'reused', true, 'status', v_existing.status);
  end if;

  for v_cap in
    select * from public.spend_caps
    where scope = 'global'
       or (scope = 'provider' and provider = p_provider)
       or (scope = 'campaign' and campaign_id = p_campaign)
  loop
    v_from := case v_cap.period when 'daily' then v_day when 'monthly' then v_month else '-infinity'::timestamptz end;
    select coalesce(sum(u.cost_usd), 0) into v_spent
    from public.usage_records u
    where u.status in ('reserved', 'recorded')
      and u.created_at >= v_from and u.created_at <= p_now
      and case v_cap.scope
            when 'global' then true
            when 'provider' then u.provider = v_cap.provider
            else u.campaign_id = v_cap.campaign_id
          end;
    if v_spent + p_est_usd > v_cap.cap_usd then
      if v_worst_remaining is null or (v_cap.cap_usd - v_spent) < v_worst_remaining then
        v_worst_remaining := v_cap.cap_usd - v_spent;
        v_worst := jsonb_build_object('ok', false, 'reason', 'cap', 'cap_id', v_cap.id, 'scope', v_cap.scope,
          'period', v_cap.period, 'provider', v_cap.provider, 'campaign_id', v_cap.campaign_id,
          'cap_usd', v_cap.cap_usd, 'spent_usd', v_spent, 'requested_usd', p_est_usd);
      end if;
    end if;
  end loop;
  if v_worst is not null then return v_worst; end if;

  insert into public.usage_records (provider, operation, units, cost_usd, campaign_id, campaign_lead_id, job_id,
                                    idempotency_key, status, is_mock, step, created_at)
  values (p_provider, p_operation, '{}'::jsonb, p_est_usd, p_campaign, p_lead, p_job, p_idem, 'reserved', p_mock, p_step, p_now)
  returning id into v_usage;
  return jsonb_build_object('ok', true, 'usage_id', v_usage, 'reused', false, 'status', 'reserved');
end $$;

create or replace function private.settle_spend(p_usage_id uuid, p_units jsonb, p_cost_usd numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.usage_records set status = 'recorded', units = p_units, cost_usd = p_cost_usd
  where id = p_usage_id and status in ('reserved', 'recorded');
end $$;

create or replace function private.release_spend(p_usage_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.usage_records set status = 'released', cost_usd = 0 where id = p_usage_id and status = 'reserved';
end $$;

revoke all on function private.reserve_spend(text, text, text, numeric, uuid, uuid, uuid, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function private.settle_spend(uuid, jsonb, numeric) from public, anon, authenticated;
revoke all on function private.release_spend(uuid) from public, anon, authenticated;
revoke all on function private.guard_batch_transition() from public, anon, authenticated;
