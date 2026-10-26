-- Phase 2: (1) a disabled user loses ALL database access at once (app_role() returns null),
-- (2) every configuration change is written to audit_log by trigger, so no code path can forget it.

alter table public.profiles add column disabled boolean not null default false;

create or replace function private.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id = (select auth.uid()) and not disabled
$$;

create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old) - 'encrypted_refresh_token'; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new) - 'encrypted_refresh_token'; end if;
  v_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  insert into public.audit_log (actor, action, entity, entity_id, payload)
  values (coalesce((select auth.uid())::text, 'system'), lower(tg_op), tg_table_name, v_id,
          jsonb_build_object('old', v_old, 'new', v_new));
  return null;
end $$;
revoke all on function private.audit_change() from public;

do $$
declare t text;
begin
  foreach t in array array['campaigns','offers','case_studies','suppression','settings','price_table','spend_caps','inboxes','profiles'] loop
    execute format('create trigger audit_change after insert or update or delete on public.%I
                    for each row execute function private.audit_change()', t);
  end loop;
end $$;
