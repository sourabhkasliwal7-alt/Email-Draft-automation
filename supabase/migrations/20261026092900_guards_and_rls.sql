-- Phase 1 / migration 2: database guards (send trigger, append-only, soft delete) + RLS by role

-- ---------------------------------------------------------------- helpers
create or replace function private.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id = (select auth.uid())
$$;
revoke all on function private.app_role() from public;
grant usage on schema private to authenticated;
grant execute on function private.app_role() to authenticated;

create or replace function private.is_suppressed(p_email text, p_campaign uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.suppression s
    where (s.scope = 'global' or s.campaign_id = p_campaign)
      and (s.email_lower is null or s.email_lower = lower(btrim(p_email)))
      and (s.domain is null or s.domain = lower(split_part(btrim(p_email), '@', 2)))
  )
$$;
revoke all on function private.is_suppressed(text, uuid) from public;

-- ---------------------------------------------------------------- append-only / no hard delete
create or replace function private.block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op using errcode = 'P0001';
end $$;

create or replace function private.block_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'hard delete on % is not allowed; use soft delete (deleted_at) or a status', tg_table_name
    using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  foreach t in array array['lead_events','audit_log','send_approvals'] loop
    execute format('create trigger block_mutation before update or delete on public.%I
                    for each row execute function private.block_mutation()', t);
    execute format('create trigger block_truncate before truncate on public.%I
                    for each statement execute function private.block_mutation()', t);
  end loop;
  foreach t in array array['campaigns','campaign_leads','contacts','companies','email_drafts','email_sends','replies'] loop
    execute format('create trigger block_delete before delete on public.%I
                    for each row execute function private.block_delete()', t);
    execute format('create trigger block_truncate before truncate on public.%I
                    for each statement execute function private.block_delete()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- approved drafts are immutable
create or replace function private.guard_draft_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.subject, new.body_text, new.body_html, new.campaign_lead_id, new.step)
       is distinct from (old.subject, old.body_text, old.body_html, old.campaign_lead_id, old.step)
     and exists (select 1 from public.send_approvals a where a.draft_id = old.id) then
    raise exception 'draft % was approved and is immutable; create a new version', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_draft_update before update on public.email_drafts
  for each row execute function private.guard_draft_update();

-- ---------------------------------------------------------------- THE SEND GUARD (defense in depth)
-- An email_sends row can only be created when: the draft has a recorded approval of the exact body,
-- the recipient is the lead's contact and is neither suppressed nor DNC, no active/sent row exists for
-- the same campaign_lead + step, the inbox is active and under its daily send cap.
create or replace function private.guard_email_send() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d public.email_drafts%rowtype;
  a public.send_approvals%rowtype;
  v_campaign uuid;
  v_contact_email text;
  v_dnc boolean;
  v_inbox public.inboxes%rowtype;
  v_today int;
begin
  if new.status <> 'queued' then
    raise exception 'send blocked: email_sends must be inserted as queued' using errcode = 'P0001';
  end if;

  select * into d from public.email_drafts where id = new.draft_id;
  if not found then
    raise exception 'send blocked: draft % not found', new.draft_id using errcode = 'P0001';
  end if;

  select * into a from public.send_approvals where draft_id = new.draft_id;
  if not found then
    raise exception 'send blocked: draft % has no recorded approval', new.draft_id using errcode = 'P0001';
  end if;
  if a.body_hash is distinct from d.body_hash then
    raise exception 'send blocked: draft % changed after approval', new.draft_id using errcode = 'P0001';
  end if;

  select cl.campaign_id, c.email_lower, c.dnc into v_campaign, v_contact_email, v_dnc
    from public.campaign_leads cl join public.contacts c on c.id = cl.contact_id
   where cl.id = d.campaign_lead_id;
  if v_contact_email is null or lower(btrim(new.recipient_email)) <> v_contact_email then
    raise exception 'send blocked: recipient does not match the lead contact' using errcode = 'P0001';
  end if;
  if v_dnc then
    raise exception 'send blocked: contact is marked do-not-contact' using errcode = 'P0001';
  end if;
  if private.is_suppressed(new.recipient_email, v_campaign) then
    raise exception 'send blocked: recipient is suppressed' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lead:' || d.campaign_lead_id || ':' || d.step, 0));
  if exists (
    select 1 from public.email_sends es join public.email_drafts ed on ed.id = es.draft_id
     where ed.campaign_lead_id = d.campaign_lead_id and ed.step = d.step
       and es.status in ('queued','sending','sent','unknown')
  ) then
    raise exception 'send blocked: step % for this lead is already queued or sent', d.step using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inbox:' || new.inbox_id, 0));
  select * into v_inbox from public.inboxes where id = new.inbox_id and deleted_at is null;
  if not found or v_inbox.status <> 'active' then
    raise exception 'send blocked: inbox is not active' using errcode = 'P0001';
  end if;
  select count(*) into v_today from public.email_sends es
   where es.inbox_id = new.inbox_id
     and es.status in ('queued','sending','sent','unknown')
     and (es.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;
  if v_today >= v_inbox.daily_send_cap then
    raise exception 'send blocked: inbox daily send cap (%) reached', v_inbox.daily_send_cap using errcode = 'P0001';
  end if;

  return new;
end $$;
create trigger guard_email_send before insert on public.email_sends
  for each row execute function private.guard_email_send();

-- Re-check suppression/DNC at the moment a row moves to 'sending'; identity fields are immutable.
create or replace function private.guard_email_send_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_campaign uuid; v_dnc boolean;
begin
  if (new.draft_id, new.recipient_email, new.inbox_id, new.send_key)
       is distinct from (old.draft_id, old.recipient_email, old.inbox_id, old.send_key) then
    raise exception 'email_sends identity fields are immutable' using errcode = 'P0001';
  end if;
  if old.status = 'sent' and new.status <> 'sent' then
    raise exception 'a sent email cannot change status' using errcode = 'P0001';
  end if;
  if new.status = 'sending' and old.status <> 'sending' then
    select cl.campaign_id, c.dnc into v_campaign, v_dnc
      from public.email_drafts ed
      join public.campaign_leads cl on cl.id = ed.campaign_lead_id
      join public.contacts c on c.id = cl.contact_id
     where ed.id = new.draft_id;
    if v_dnc or private.is_suppressed(new.recipient_email, v_campaign) then
      raise exception 'send blocked: recipient became suppressed or do-not-contact' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger guard_email_send_update before update on public.email_sends
  for each row execute function private.guard_email_send_update();

-- ---------------------------------------------------------------- privileges
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

revoke update, delete, truncate on public.lead_events, public.audit_log, public.send_approvals
  from public, anon, authenticated, service_role;
revoke delete, truncate on public.campaigns, public.campaign_leads, public.contacts, public.companies,
  public.email_drafts, public.email_sends, public.replies from authenticated, service_role;

-- inbox refresh tokens are never readable/writable by end-user roles (service role only)
revoke all on public.inboxes from authenticated;
grant select (id, email, email_lower, display_name, status, scopes, daily_draft_cap, daily_send_cap,
              min_seconds_between_sends, last_health_check, deleted_at, created_at, updated_at)
  on public.inboxes to authenticated;
grant insert (email, display_name, status, scopes, daily_draft_cap, daily_send_cap, min_seconds_between_sends)
  on public.inboxes to authenticated;
grant update (display_name, status, daily_draft_cap, daily_send_cap, min_seconds_between_sends, deleted_at)
  on public.inboxes to authenticated;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare
  all_roles text := $r$'admin','operator','reviewer','sender'$r$;
  ops text := $r$'admin','operator'$r$;
  t text; cmd text; roles text; extra text;
  -- table, select roles
  sel text[][] := array[
    ['campaigns',all_roles],['campaign_leads',all_roles],['contacts',all_roles],['companies',all_roles],
    ['offers',all_roles],['case_studies',all_roles],['inboxes',all_roles],['import_batches',all_roles],
    ['import_rows',all_roles],['research_runs',all_roles],['evidence_items',all_roles],['signals',all_roles],
    ['enrichment_results',all_roles],['email_drafts',all_roles],['send_approvals',all_roles],
    ['email_sends',all_roles],['replies',all_roles],['followups',all_roles],['lead_events',all_roles],
    ['suppression',all_roles],['jobs',ops],['job_steps',ops],['usage_records',ops],['price_table',ops],
    ['spend_caps',ops],['settings',ops],['audit_log',$r$'admin'$r$]
  ];
  -- table, command, roles
  wr text[][] := array[
    ['offers','insert',ops],['offers','update',ops],['case_studies','insert',ops],['case_studies','update',ops],
    ['campaigns','insert',ops],['campaigns','update',ops],
    ['companies','insert',ops],['companies','update',ops],['contacts','insert',ops],['contacts','update',ops],
    ['campaign_leads','insert',ops],['campaign_leads','update',ops],
    ['import_batches','insert',ops],['import_batches','update',ops],
    ['import_rows','insert',ops],['import_rows','update',ops],
    ['research_runs','insert',ops],['research_runs','update',ops],
    ['evidence_items','insert',ops],['evidence_items','update',ops],
    ['signals','insert',ops],['signals','update',ops],
    ['enrichment_results','insert',ops],['enrichment_results','update',ops],
    ['followups','insert',ops],['followups','update',ops],
    ['suppression','insert',ops],['suppression','update',ops],['suppression','delete',$r$'admin'$r$],
    ['email_drafts','insert',ops],['email_drafts','update',$r$'admin','operator','reviewer'$r$],
    ['email_sends','insert',$r$'admin','sender'$r$],['email_sends','update',$r$'admin','sender'$r$],
    ['lead_events','insert',all_roles],
    ['jobs','insert',ops],
    ['inboxes','insert',$r$'admin'$r$],['inboxes','update',$r$'admin'$r$],
    ['price_table','insert',$r$'admin'$r$],['price_table','update',$r$'admin'$r$],['price_table','delete',$r$'admin'$r$],
    ['spend_caps','insert',$r$'admin'$r$],['spend_caps','update',$r$'admin'$r$],['spend_caps','delete',$r$'admin'$r$],
    ['settings','insert',$r$'admin'$r$],['settings','update',$r$'admin'$r$],['settings','delete',$r$'admin'$r$],
    ['profiles','insert',$r$'admin'$r$],['profiles','update',$r$'admin'$r$],['profiles','delete',$r$'admin'$r$]
  ];
  i int;
begin
  for i in 1 .. array_length(sel, 1) loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.app_role()) in (%s))',
                   sel[i][1] || '_select', sel[i][1], sel[i][2]);
  end loop;

  for i in 1 .. array_length(wr, 1) loop
    t := wr[i][1]; cmd := wr[i][2]; roles := wr[i][3];
    if cmd = 'insert' then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select private.app_role()) in (%s))',
                     t || '_insert', t, roles);
    elsif cmd = 'update' then
      execute format('create policy %I on public.%I for update to authenticated using ((select private.app_role()) in (%s)) with check ((select private.app_role()) in (%s))',
                     t || '_update', t, roles, roles);
    else
      execute format('create policy %I on public.%I for delete to authenticated using ((select private.app_role()) in (%s))',
                     t || '_delete', t, roles);
    end if;
  end loop;
end $$;

-- profiles: a user reads their own row; admins read all
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.app_role()) = 'admin');

-- approvals: only reviewers/admins, and only in their own name
create policy send_approvals_insert on public.send_approvals for insert to authenticated
  with check ((select private.app_role()) in ('admin','reviewer') and approved_by = (select auth.uid()));
