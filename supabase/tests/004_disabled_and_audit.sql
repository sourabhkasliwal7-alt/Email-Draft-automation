-- Suite 004: disabled users lose access at once; every config change is audited (with secrets redacted).
do $$
declare
  u_admin uuid := pg_temp.mk_user('da-admin@test.invalid');
  u_op uuid := pg_temp.mk_user('da-op@test.invalid');
  v_inbox uuid; v_offer uuid; v_camp uuid;
  r text; n int; p jsonb;
begin
  insert into public.profiles (user_id, role) values (u_admin, 'admin'), (u_op, 'operator');
  insert into public.inboxes (email, status, encrypted_refresh_token) values ('da-inbox@test.invalid', 'active', 'SECRET-CIPHERTEXT') returning id into v_inbox;
  insert into public.campaigns (name) values ('DA campaign') returning id into v_camp;

  -- active operator works
  perform pg_temp.expect('operator reads campaigns', pg_temp.try_as('authenticated', u_op, 'select 1 from public.campaigns'), '^ok:[1-9]');
  perform pg_temp.expect('operator inserts', pg_temp.try_as('authenticated', u_op, $q$insert into public.offers (name) values ('da-offer-1')$q$), '^ok:1$');

  -- disable: access is gone immediately, for reads and writes
  update public.profiles set disabled = true where user_id = u_op;
  perform pg_temp.expect('disabled user reads nothing', pg_temp.try_as('authenticated', u_op, 'select 1 from public.campaigns'), '^ok:0$');
  perform pg_temp.expect('disabled user cannot write', pg_temp.try_as('authenticated', u_op, $q$insert into public.offers (name) values ('da-offer-2')$q$), 'err:.*row-level security');
  perform pg_temp.expect('disabled user cannot update', pg_temp.try_as('authenticated', u_op, $q$update public.campaigns set name = 'x'$q$), '^ok:0$');
  update public.profiles set disabled = false where user_id = u_op;
  perform pg_temp.expect('re-enabled user works again', pg_temp.try_as('authenticated', u_op, 'select 1 from public.campaigns'), '^ok:[1-9]');

  -- audit: insert, update, delete are recorded with the acting user
  select count(*) into n from public.audit_log where entity = 'offers' and action = 'insert' and actor = u_op::text and payload -> 'new' ->> 'name' = 'da-offer-1';
  if n <> 1 then raise exception 'FAIL [offer insert audited with actor]: %', n; end if;
  perform pg_temp.expect('admin edits a setting', pg_temp.try_as('authenticated', u_admin, $q$insert into public.settings (key, value) values ('da-flag', 'true')$q$), '^ok:1$');
  perform pg_temp.expect('admin changes it', pg_temp.try_as('authenticated', u_admin, $q$update public.settings set value = 'false' where key = 'da-flag'$q$), '^ok:1$');
  select payload into p from public.audit_log where entity = 'settings' and action = 'update' and actor = u_admin::text and payload -> 'new' ->> 'key' = 'da-flag';
  if p -> 'old' ->> 'value' <> 'true' or p -> 'new' ->> 'value' <> 'false' then raise exception 'FAIL [update audit holds old and new]: %', p; end if;
  perform pg_temp.expect('admin deletes it', pg_temp.try_as('authenticated', u_admin, $q$delete from public.settings where key = 'da-flag'$q$), '^ok:1$');
  select count(*) into n from public.audit_log where entity = 'settings' and action = 'delete' and actor = u_admin::text;
  if n <> 1 then raise exception 'FAIL [delete audited]: %', n; end if;

  -- refresh tokens never reach the audit log
  update public.inboxes set display_name = 'renamed', encrypted_refresh_token = 'NEW-SECRET' where id = v_inbox;
  select count(*) into n from public.audit_log where entity = 'inboxes' and entity_id = v_inbox and payload::text like '%SECRET%';
  if n <> 0 then raise exception 'FAIL [token leaked into audit_log]: % rows', n; end if;
  select count(*) into n from public.audit_log where entity = 'inboxes' and entity_id = v_inbox and action = 'update';
  if n <> 1 then raise exception 'FAIL [inbox update audited]: %', n; end if;

  -- service role / worker changes are attributed to system
  perform pg_temp.expect('service role edits campaign', pg_temp.try_as('service_role', null, format($q$update public.campaigns set status = 'paused' where id = %L$q$, v_camp)), '^ok:1$');
  select count(*) into n from public.audit_log where entity = 'campaigns' and entity_id = v_camp and actor = 'system' and action = 'update';
  if n <> 1 then raise exception 'FAIL [system actor]: %', n; end if;

  -- the audit log itself stays append-only and admin-only
  perform pg_temp.expect('operator cannot read audit log', pg_temp.try_as('authenticated', u_op, 'select 1 from public.audit_log'), '^ok:0$');
  perform pg_temp.expect('admin can read audit log', pg_temp.try_as('authenticated', u_admin, 'select 1 from public.audit_log'), '^ok:[1-9]');

  raise exception 'SUITE_OK';
end $$;
