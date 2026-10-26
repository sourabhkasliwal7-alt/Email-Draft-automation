-- Suite 003: RLS per role (admin / operator / reviewer / sender / user without profile / anon / service_role).
do $$
declare
  u_admin uuid := pg_temp.mk_user('rl-admin@test.invalid');
  u_op uuid := pg_temp.mk_user('rl-op@test.invalid');
  u_rev uuid := pg_temp.mk_user('rl-rev@test.invalid');
  u_snd uuid := pg_temp.mk_user('rl-snd@test.invalid');
  u_none uuid := pg_temp.mk_user('rl-none@test.invalid');
  v_inbox uuid; v_camp uuid; d uuid; d_rev uuid; d_snd uuid;
  r text; n int;
begin
  insert into public.profiles (user_id, role, full_name) values
    (u_admin, 'admin', 'A'), (u_op, 'operator', 'O'), (u_rev, 'reviewer', 'R'), (u_snd, 'sender', 'S');
  insert into public.inboxes (email, status, encrypted_refresh_token) values ('rl-inbox@test.invalid', 'active', 'ciphertext') returning id into v_inbox;
  insert into public.campaigns (name, inbox_id) values ('RL campaign', v_inbox) returning id into v_camp;
  insert into public.usage_records (provider, operation, cost_usd) values ('test', 'op', 0.01);
  insert into public.audit_log (action) values ('rl-test');
  insert into public.settings (key, value) values ('rl-key', '1');
  d := pg_temp.mk_draft(v_camp, v_inbox, 'rl-lead@rl-test.invalid', 'rl1');

  -- anon: nothing at all
  r := pg_temp.try_as('anon', null, 'select 1 from public.campaigns');
  perform pg_temp.expect('anon cannot read campaigns', r, 'err:.*permission denied');
  r := pg_temp.try_as('anon', null, 'select 1 from public.v_cost_summary');
  perform pg_temp.expect('anon cannot read views', r, 'err:.*permission denied');
  r := pg_temp.try_as('anon', null, 'select 1 from public.contacts');
  perform pg_temp.expect('anon cannot read contacts', r, 'err:.*permission denied');

  -- authenticated user without a profile sees nothing and writes nothing
  r := pg_temp.try_as('authenticated', u_none, 'select 1 from public.campaigns');
  perform pg_temp.expect('no-profile user reads 0 campaigns', r, '^ok:0$');
  r := pg_temp.try_as('authenticated', u_none, $q$insert into public.campaigns (name) values ('x')$q$);
  perform pg_temp.expect('no-profile user cannot insert', r, 'err:.*row-level security');

  -- everyone with a role can read the core tables
  foreach r in array array[u_admin::text, u_op::text, u_rev::text, u_snd::text] loop
    perform pg_temp.expect('role reads campaigns', pg_temp.try_as('authenticated', r::uuid, 'select 1 from public.campaigns'), '^ok:[1-9]');
    perform pg_temp.expect('role reads drafts', pg_temp.try_as('authenticated', r::uuid, 'select 1 from public.email_drafts'), '^ok:[1-9]');
  end loop;

  -- campaigns: admin + operator write, reviewer + sender do not
  perform pg_temp.expect('operator inserts campaign', pg_temp.try_as('authenticated', u_op, $q$insert into public.campaigns (name) values ('op')$q$), '^ok:1$');
  perform pg_temp.expect('admin inserts campaign', pg_temp.try_as('authenticated', u_admin, $q$insert into public.campaigns (name) values ('ad')$q$), '^ok:1$');
  perform pg_temp.expect('reviewer cannot insert campaign', pg_temp.try_as('authenticated', u_rev, $q$insert into public.campaigns (name) values ('rv')$q$), 'err:.*row-level security');
  perform pg_temp.expect('sender cannot insert campaign', pg_temp.try_as('authenticated', u_snd, $q$insert into public.campaigns (name) values ('sd')$q$), 'err:.*row-level security');
  perform pg_temp.expect('reviewer update hits 0 rows', pg_temp.try_as('authenticated', u_rev, $q$update public.campaigns set name = 'hacked'$q$), '^ok:0$');

  -- cost / config / audit visibility
  perform pg_temp.expect('operator reads usage', pg_temp.try_as('authenticated', u_op, 'select 1 from public.usage_records'), '^ok:[1-9]');
  perform pg_temp.expect('reviewer cannot read usage', pg_temp.try_as('authenticated', u_rev, 'select 1 from public.usage_records'), '^ok:0$');
  perform pg_temp.expect('sender cannot read usage', pg_temp.try_as('authenticated', u_snd, 'select 1 from public.usage_records'), '^ok:0$');
  perform pg_temp.expect('view respects caller RLS (reviewer)', pg_temp.try_as('authenticated', u_rev, 'select 1 from public.v_cost_summary'), '^ok:0$');
  perform pg_temp.expect('view works for operator', pg_temp.try_as('authenticated', u_op, 'select 1 from public.v_cost_summary'), '^ok:[1-9]');
  perform pg_temp.expect('admin reads audit_log', pg_temp.try_as('authenticated', u_admin, 'select 1 from public.audit_log'), '^ok:[1-9]');
  perform pg_temp.expect('operator cannot read audit_log', pg_temp.try_as('authenticated', u_op, 'select 1 from public.audit_log'), '^ok:0$');
  perform pg_temp.expect('reviewer cannot read settings', pg_temp.try_as('authenticated', u_rev, 'select 1 from public.settings'), '^ok:0$');
  perform pg_temp.expect('operator cannot write settings', pg_temp.try_as('authenticated', u_op, $q$insert into public.settings (key) values ('op-key')$q$), 'err:.*row-level security');
  perform pg_temp.expect('admin writes settings', pg_temp.try_as('authenticated', u_admin, $q$insert into public.settings (key) values ('ad-key')$q$), '^ok:1$');
  perform pg_temp.expect('operator cannot edit price_table', pg_temp.try_as('authenticated', u_op, $q$insert into public.price_table (provider, unit, usd_per_unit) values ('p','u',1)$q$), 'err:.*row-level security');
  perform pg_temp.expect('admin edits price_table', pg_temp.try_as('authenticated', u_admin, $q$insert into public.price_table (provider, unit, usd_per_unit) values ('p','u',1)$q$), '^ok:1$');

  -- inbox refresh tokens never reach user roles (not even admin); service role can use them
  perform pg_temp.expect('admin cannot read token', pg_temp.try_as('authenticated', u_admin, 'select encrypted_refresh_token from public.inboxes'), 'err:.*permission denied');
  perform pg_temp.expect('admin cannot select *', pg_temp.try_as('authenticated', u_admin, 'select * from public.inboxes'), 'err:.*permission denied');
  perform pg_temp.expect('admin cannot write token', pg_temp.try_as('authenticated', u_admin, $q$update public.inboxes set encrypted_refresh_token = 'x'$q$), 'err:.*permission denied');
  perform pg_temp.expect('admin reads inbox safe columns', pg_temp.try_as('authenticated', u_admin, 'select id, email, status from public.inboxes'), '^ok:[1-9]');
  perform pg_temp.expect('operator cannot edit inbox', pg_temp.try_as('authenticated', u_op, $q$update public.inboxes set status = 'paused'$q$), '^ok:0$');
  perform pg_temp.expect('service role reads token', pg_temp.try_as('service_role', null, 'select encrypted_refresh_token from public.inboxes'), '^ok:[1-9]');

  -- profiles: no self-promotion; users see only their own row, admin sees all
  perform pg_temp.expect('operator cannot promote self', pg_temp.try_as('authenticated', u_op, format($q$update public.profiles set role = 'admin' where user_id = %L$q$, u_op)), '^ok:0$');
  select role into r from public.profiles where user_id = u_op;
  if r <> 'operator' then raise exception 'FAIL [role unchanged]: %', r; end if;
  perform pg_temp.expect('operator cannot create profile', pg_temp.try_as('authenticated', u_op, format($q$insert into public.profiles (user_id, role) values (%L, 'admin')$q$, u_none)), 'err:.*row-level security');
  perform pg_temp.expect('operator sees only own profile', pg_temp.try_as('authenticated', u_op, 'select 1 from public.profiles'), '^ok:1$');
  perform pg_temp.expect('admin sees all profiles', pg_temp.try_as('authenticated', u_admin, format('select 1 from public.profiles where user_id in (%L,%L,%L,%L)', u_admin, u_op, u_rev, u_snd)), '^ok:4$');
  perform pg_temp.expect('admin changes a role', pg_temp.try_as('authenticated', u_admin, format($q$update public.profiles set role = 'reviewer' where user_id = %L$q$, u_snd)), '^ok:1$');
  update public.profiles set role = 'sender' where user_id = u_snd;

  -- approvals: reviewer/admin only, only as themselves, and immutable
  perform pg_temp.expect('operator cannot approve', pg_temp.try_as('authenticated', u_op, format($q$insert into public.send_approvals (draft_id, approved_by) values (%L, %L)$q$, d, u_op)), 'err:.*row-level security');
  perform pg_temp.expect('sender cannot approve', pg_temp.try_as('authenticated', u_snd, format($q$insert into public.send_approvals (draft_id, approved_by) values (%L, %L)$q$, d, u_snd)), 'err:.*row-level security');
  perform pg_temp.expect('reviewer cannot approve as someone else', pg_temp.try_as('authenticated', u_rev, format($q$insert into public.send_approvals (draft_id, approved_by) values (%L, %L)$q$, d, u_admin)), 'err:.*row-level security');
  perform pg_temp.expect('reviewer approves as self', pg_temp.try_as('authenticated', u_rev, format($q$insert into public.send_approvals (draft_id, approved_by, body_hash) values (%L, %L, 'hash-rl1')$q$, d, u_rev)), '^ok:1$');
  perform pg_temp.expect('approval cannot be revoked by editing', pg_temp.try_as('authenticated', u_rev, format($q$update public.send_approvals set approved_by = %L$q$, u_admin)), 'err:.*(permission denied|append-only)');

  -- drafts: reviewer may change status; sender may not
  perform pg_temp.expect('reviewer updates draft status', pg_temp.try_as('authenticated', u_rev, format($q$update public.email_drafts set status = 'needs_review' where id = %L$q$, d)), '^ok:1$');
  perform pg_temp.expect('sender cannot update draft', pg_temp.try_as('authenticated', u_snd, format($q$update public.email_drafts set status = 'rejected' where id = %L$q$, d)), '^ok:0$');

  -- sends: sender/admin may queue (DB guard still applies); operator/reviewer may not
  perform pg_temp.expect('operator cannot queue send', pg_temp.try_as('authenticated', u_op, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id) values (%L,'rl-k1',%L,'rl-lead@rl-test.invalid','s','b',%L)$q$, d, v_inbox, v_camp)), 'err:.*row-level security');
  perform pg_temp.expect('reviewer cannot queue send', pg_temp.try_as('authenticated', u_rev, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id) values (%L,'rl-k1',%L,'rl-lead@rl-test.invalid','s','b',%L)$q$, d, v_inbox, v_camp)), 'err:.*row-level security');
  d_snd := pg_temp.mk_draft(v_camp, v_inbox, 'rl-unapproved@rl-test.invalid', 'rl2');
  perform pg_temp.expect('sender blocked by DB guard when unapproved', pg_temp.try_as('authenticated', u_snd, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id) values (%L,'rl-k2',%L,'rl-unapproved@rl-test.invalid','s','b',%L)$q$, d_snd, v_inbox, v_camp)), 'err:.*no recorded approval');
  perform pg_temp.expect('sender queues approved send', pg_temp.try_as('authenticated', u_snd, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id) values (%L,'rl-k1',%L,'rl-lead@rl-test.invalid','s','b',%L)$q$, d, v_inbox, v_camp)), '^ok:1$');

  -- history: any role may append lead events, nobody may edit them
  perform pg_temp.expect('reviewer appends event', pg_temp.try_as('authenticated', u_rev, $q$insert into public.lead_events (type, actor) values ('note','rev')$q$), '^ok:1$');
  perform pg_temp.expect('reviewer cannot edit event', pg_temp.try_as('authenticated', u_rev, $q$update public.lead_events set type = 'x'$q$), 'err:.*(permission denied|append-only)');

  -- suppression: operator adds, only admin removes
  perform pg_temp.expect('operator adds suppression', pg_temp.try_as('authenticated', u_op, $q$insert into public.suppression (email_lower, reason) values ('rl-sup@test.invalid','manual')$q$), '^ok:1$');
  perform pg_temp.expect('operator cannot remove suppression', pg_temp.try_as('authenticated', u_op, $q$delete from public.suppression where email_lower = 'rl-sup@test.invalid'$q$), '^ok:0$');
  perform pg_temp.expect('admin removes suppression', pg_temp.try_as('authenticated', u_admin, $q$delete from public.suppression where email_lower = 'rl-sup@test.invalid'$q$), '^ok:1$');

  -- jobs: operator/admin enqueue; sender cannot; worker heartbeat visible to operator only
  perform pg_temp.expect('operator enqueues job', pg_temp.try_as('authenticated', u_op, $q$insert into public.jobs (type, idempotency_key) values ('t','rl-j1')$q$), '^ok:1$');
  perform pg_temp.expect('sender cannot enqueue job', pg_temp.try_as('authenticated', u_snd, $q$insert into public.jobs (type, idempotency_key) values ('t','rl-j2')$q$), 'err:.*row-level security');
  insert into public.worker_heartbeats (worker_id) values ('rl-worker');
  perform pg_temp.expect('operator sees heartbeat', pg_temp.try_as('authenticated', u_op, 'select 1 from public.worker_heartbeats'), '^ok:[1-9]');
  perform pg_temp.expect('reviewer cannot see heartbeat', pg_temp.try_as('authenticated', u_rev, 'select 1 from public.worker_heartbeats'), '^ok:0$');
  perform pg_temp.expect('user roles cannot write heartbeat', pg_temp.try_as('authenticated', u_admin, $q$insert into public.worker_heartbeats (worker_id) values ('x')$q$), 'err:.*row-level security');

  -- worker (service role) bypasses RLS but not the DB guards
  perform pg_temp.expect('service role reads everything', pg_temp.try_as('service_role', null, 'select 1 from public.campaigns'), '^ok:[1-9]');
  perform pg_temp.expect('service role writes heartbeat', pg_temp.try_as('service_role', null, $q$update public.worker_heartbeats set last_seen_at = now() where worker_id = 'rl-worker'$q$), '^ok:1$');

  raise exception 'SUITE_OK';
end $$;
