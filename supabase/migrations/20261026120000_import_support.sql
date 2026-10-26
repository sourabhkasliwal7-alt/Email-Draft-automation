-- Phase 3: import support.
-- * import modes match the plan: add_new | update_existing | skip_duplicates (+ a separate dry_run flag)
-- * import_rows can end as updated / failed
-- * saved mapping templates
-- * contacts keep a free-text company name when the file has no usable domain
-- (The private `imports` Storage bucket is created in the dashboard; see BLOCKERS.md.)

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.import_batches'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%mode%' loop
    execute format('alter table public.import_batches drop constraint %I', c);
  end loop;
  for c in select conname from pg_constraint
           where conrelid = 'public.import_rows'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.import_rows drop constraint %I', c);
  end loop;
end $$;

alter table public.import_batches alter column mode set default 'add_new';
update public.import_batches set mode = case mode when 'update' then 'update_existing' when 'dry_run' then 'add_new' else 'add_new' end;
alter table public.import_batches
  add constraint import_batches_mode_check check (mode in ('add_new', 'update_existing', 'skip_duplicates')),
  add column dry_run boolean not null default false,
  add column file_size bigint check (file_size is null or file_size >= 0),
  add column runs int not null default 0 check (runs >= 0),
  add column error text;

alter table public.import_rows
  add constraint import_rows_status_check
  check (status in ('pending', 'valid', 'invalid', 'duplicate', 'suppressed', 'imported', 'updated', 'skipped', 'failed'));

alter table public.contacts add column company_name text;

create table public.import_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mapping jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index import_templates_name_key on public.import_templates (lower(name));
create index import_templates_created_by_idx on public.import_templates (created_by);
create trigger set_updated_at before update on public.import_templates for each row execute function private.set_updated_at();
create trigger audit_change after insert or update or delete on public.import_templates for each row execute function private.audit_change();
alter table public.import_templates enable row level security;
create policy import_templates_select on public.import_templates for select to authenticated
  using ((select private.app_role()) in ('admin', 'operator'));
create policy import_templates_insert on public.import_templates for insert to authenticated
  with check ((select private.app_role()) in ('admin', 'operator'));
create policy import_templates_update on public.import_templates for update to authenticated
  using ((select private.app_role()) in ('admin', 'operator')) with check ((select private.app_role()) in ('admin', 'operator'));
create policy import_templates_delete on public.import_templates for delete to authenticated
  using ((select private.app_role()) in ('admin', 'operator'));
revoke all on public.import_templates from anon;
revoke truncate, references, trigger on public.import_templates from authenticated;

-- import_batches / import_rows: only the worker (service role) writes rows; operators create batches.
create index import_rows_batch_status_idx on public.import_rows (batch_id, row_number);
