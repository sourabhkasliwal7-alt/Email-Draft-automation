-- Phase 1 / migration 5: worker heartbeat (Phase 0 health check reads it; the worker writes with the service role)
create table public.worker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null unique,
  last_seen_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.worker_heartbeats
  for each row execute function private.set_updated_at();
alter table public.worker_heartbeats enable row level security;
create policy worker_heartbeats_select on public.worker_heartbeats for select to authenticated
  using ((select private.app_role()) in ('admin','operator'));
revoke all on public.worker_heartbeats from anon;
revoke truncate, references, trigger on public.worker_heartbeats from authenticated;
