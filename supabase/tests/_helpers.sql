-- Test helpers (temp functions; vanish with the session). Each suite is: helpers + one DO block that
-- ends with `raise exception 'SUITE_OK'` so that every fixture row is rolled back no matter the runner.

-- Run p_sql as p_role (anon/authenticated/service_role/postgres) with JWT sub = p_uid.
-- Returns 'ok:<rowcount>' or 'err:<message>'.
create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare rc bigint; res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics rc = row_count;
    res := 'ok:' || rc;
  exception when others then
    res := 'err:' || sqlerrm;
  end;
  reset role;
  return res;
end $$;

create or replace function pg_temp.expect(p_label text, p_actual text, p_pattern text) returns void
language plpgsql as $$
begin
  if p_actual !~ p_pattern then
    raise exception 'FAIL [%]: expected /%/ but got: %', p_label, p_pattern, p_actual;
  end if;
end $$;

-- Create company + contact + campaign_lead + draft (+ approval when p_approver is not null).
-- Returns the draft id.
create or replace function pg_temp.mk_draft(p_campaign uuid, p_inbox uuid, p_email text, p_key text,
                                            p_approver uuid default null, p_step int default 0) returns uuid
language plpgsql as $$
declare v_co uuid; v_ct uuid; v_lead uuid; v_draft uuid; v_domain text := lower(split_part(p_email, '@', 2));
begin
  insert into public.companies (domain) values (v_domain) on conflict (domain) do nothing;
  select id into v_co from public.companies where domain = v_domain;
  insert into public.contacts (email, company_id) values (p_email, v_co)
    on conflict (email_lower) do update set updated_at = now() returning id into v_ct;
  insert into public.campaign_leads (campaign_id, contact_id) values (p_campaign, v_ct)
    on conflict (campaign_id, contact_id) do update set updated_at = now() returning id into v_lead;
  insert into public.email_drafts (campaign_lead_id, step, subject, body_text, body_hash, idempotency_key, inbox_id)
    values (v_lead, p_step, 'Subject ' || p_key, 'Body ' || p_key, 'hash-' || p_key, p_key, p_inbox)
    returning id into v_draft;
  if p_approver is not null then
    insert into public.send_approvals (draft_id, approved_by, body_hash) values (v_draft, p_approver, 'hash-' || p_key);
  end if;
  return v_draft;
end $$;

create or replace function pg_temp.mk_user(p_email text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v, p_email);
  return v;
end $$;
