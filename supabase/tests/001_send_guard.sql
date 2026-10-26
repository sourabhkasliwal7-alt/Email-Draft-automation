-- Suite 001: the email_sends insert/update guard. Runs as service_role to prove even the worker's role is blocked.
do $$
declare
  v_admin uuid := pg_temp.mk_user('sg-admin@test.invalid');
  v_inbox uuid; v_camp uuid; v_camp2 uuid;
  d uuid; d2 uuid; d3 uuid; s1 uuid;
  r text;
begin
  insert into public.inboxes (email, status, daily_send_cap) values ('sg-inbox@test.invalid', 'active', 50) returning id into v_inbox;
  insert into public.campaigns (name, inbox_id) values ('SG campaign', v_inbox) returning id into v_camp;
  insert into public.campaigns (name, inbox_id) values ('SG campaign 2', v_inbox) returning id into v_camp2;

  -- 1. no approval -> blocked
  d := pg_temp.mk_draft(v_camp, v_inbox, 'Lead@SG-Test.invalid', 'sg1');
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k1', %L, 'lead@sg-test.invalid', 's', 'b', %L)$q$, d, v_inbox, v_camp));
  perform pg_temp.expect('unapproved blocked', r, 'err:.*no recorded approval');

  -- 2. approve; body changed after approval -> blocked; approved draft text is immutable
  insert into public.send_approvals (draft_id, approved_by, body_hash) values (d, v_admin, 'hash-sg1');
  update public.email_drafts set body_hash = 'tampered' where id = d;
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k1', %L, 'lead@sg-test.invalid', 's', 'b', %L)$q$, d, v_inbox, v_camp));
  perform pg_temp.expect('hash mismatch blocked', r, 'err:.*changed after approval');
  update public.email_drafts set body_hash = 'hash-sg1' where id = d;
  r := pg_temp.try_as('service_role', null, format('update public.email_drafts set body_text = ''edited'' where id = %L', d));
  perform pg_temp.expect('approved draft immutable', r, 'err:.*immutable');

  -- 3. recipient mismatch, must be inserted as queued
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k1', %L, 'someone-else@sg-test.invalid', 's', 'b', %L)$q$, d, v_inbox, v_camp));
  perform pg_temp.expect('recipient mismatch', r, 'err:.*does not match');
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id, status)
        values (%L, 'k1', %L, 'lead@sg-test.invalid', 's', 'b', %L, 'sent')$q$, d, v_inbox, v_camp));
  perform pg_temp.expect('must insert queued', r, 'err:.*inserted as queued');

  -- 4. happy path (recipient compared case-insensitively)
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k1', %L, 'LEAD@SG-TEST.INVALID', 's', 'b', %L)$q$, d, v_inbox, v_camp));
  perform pg_temp.expect('approved send queues', r, '^ok:1$');
  select id into s1 from public.email_sends where send_key = 'k1';

  -- 5. same lead+step cannot be queued twice; duplicate send_key rejected
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k2', %L, 'lead@sg-test.invalid', 's', 'b', %L)$q$, d, v_inbox, v_camp));
  perform pg_temp.expect('duplicate step queued', r, 'err:.*already queued or sent');
  d2 := pg_temp.mk_draft(v_camp, v_inbox, 'second@sg-test.invalid', 'sg2', v_admin);
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k1', %L, 'second@sg-test.invalid', 's', 'b', %L)$q$, d2, v_inbox, v_camp));
  perform pg_temp.expect('duplicate send_key', r, 'err:.*duplicate key');

  -- 6. lifecycle: sending -> sent; a sent row blocks any new send for that lead+step and cannot regress
  r := pg_temp.try_as('service_role', null, format('update public.email_sends set status = ''sending'' where id = %L', s1));
  perform pg_temp.expect('to sending', r, '^ok:1$');
  r := pg_temp.try_as('service_role', null, format('update public.email_sends set status = ''sent'', sent_at = now() where id = %L', s1));
  perform pg_temp.expect('to sent', r, '^ok:1$');
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k3', %L, 'lead@sg-test.invalid', 's', 'b', %L)$q$, d, v_inbox, v_camp));
  perform pg_temp.expect('already sent blocked', r, 'err:.*already queued or sent');
  r := pg_temp.try_as('service_role', null, format('update public.email_sends set status = ''queued'' where id = %L', s1));
  perform pg_temp.expect('sent cannot regress', r, 'err:.*sent email cannot change');
  r := pg_temp.try_as('service_role', null, format('update public.email_sends set recipient_email = ''x@y.invalid'' where id = %L', s1));
  perform pg_temp.expect('identity immutable', r, 'err:.*immutable');

  -- 7. a failed attempt may be retried (new send_key)
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k4', %L, 'second@sg-test.invalid', 's', 'b', %L)$q$, d2, v_inbox, v_camp));
  perform pg_temp.expect('queue second lead', r, '^ok:1$');
  update public.email_sends set status = 'failed', failure_reason = 'smtp 4xx' where send_key = 'k4';
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k5', %L, 'second@sg-test.invalid', 's', 'b', %L)$q$, d2, v_inbox, v_camp));
  perform pg_temp.expect('retry after failure', r, '^ok:1$');

  -- 8. DNC contact
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'dnc@sg-test.invalid', 'sg3', v_admin);
  update public.contacts set dnc = true where email_lower = 'dnc@sg-test.invalid';
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k6', %L, 'dnc@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('dnc blocked', r, 'err:.*do-not-contact');

  -- 9. suppression: email (global), domain (global), campaign-scoped (only that campaign)
  insert into public.suppression (email_lower, reason) values ('sup-email@sg-test.invalid', 'test');
  insert into public.suppression (domain, reason) values ('sup-domain.invalid', 'test');
  insert into public.suppression (email_lower, scope, campaign_id, reason) values ('only-c1@sg-test.invalid', 'campaign', v_camp, 'test');
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'sup-email@sg-test.invalid', 'sg4', v_admin);
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k7', %L, 'sup-email@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('suppressed email', r, 'err:.*suppressed');
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'anyone@SUP-DOMAIN.invalid', 'sg5', v_admin);
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k8', %L, 'anyone@sup-domain.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('suppressed domain', r, 'err:.*suppressed');
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'only-c1@sg-test.invalid', 'sg6', v_admin);
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k9', %L, 'only-c1@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('campaign-scoped suppression blocks that campaign', r, 'err:.*suppressed');
  d3 := pg_temp.mk_draft(v_camp2, v_inbox, 'only-c1@sg-test.invalid', 'sg7', v_admin);
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k10', %L, 'only-c1@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp2));
  perform pg_temp.expect('campaign-scoped suppression leaves other campaigns', r, '^ok:1$');

  -- 10. becomes suppressed / DNC between queueing and sending
  update public.email_sends set status = 'cancelled' where send_key = 'k10';
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'late@sg-test.invalid', 'sg8', v_admin);
  insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
    values (d3, 'k11', v_inbox, 'late@sg-test.invalid', 's', 'b', v_camp);
  insert into public.suppression (email_lower, reason) values ('late@sg-test.invalid', 'opted out after queueing');
  r := pg_temp.try_as('service_role', null, 'update public.email_sends set status = ''sending'' where send_key = ''k11''');
  perform pg_temp.expect('suppressed before send', r, 'err:.*became suppressed');
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'late2@sg-test.invalid', 'sg9', v_admin);
  insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
    values (d3, 'k12', v_inbox, 'late2@sg-test.invalid', 's', 'b', v_camp);
  update public.contacts set dnc = true where email_lower = 'late2@sg-test.invalid';
  r := pg_temp.try_as('service_role', null, 'update public.email_sends set status = ''sending'' where send_key = ''k12''');
  perform pg_temp.expect('dnc before send', r, 'err:.*became suppressed');

  -- 11. inbox must be active
  -- an address verified as invalid can never be queued (SPEC 23.3)
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'bounce-invalid@sg-test.invalid', 'sg11', v_admin);
  update public.contacts set email_status = 'invalid' where email_lower = 'bounce-invalid@sg-test.invalid';
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k15', %L, 'bounce-invalid@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('invalid email blocked', r, 'err:.*verified invalid');
  update public.contacts set email_status = 'risky' where email_lower = 'bounce-invalid@sg-test.invalid';
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k16', %L, 'bounce-invalid@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('non-invalid statuses are accepted', r, '^ok:1$');
  update public.email_sends set status = 'cancelled' where send_key = 'k16';

  update public.inboxes set status = 'paused' where id = v_inbox;
  d3 := pg_temp.mk_draft(v_camp, v_inbox, 'paused@sg-test.invalid', 'sg10', v_admin);
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k13', %L, 'paused@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('inactive inbox', r, 'err:.*inbox is not active');
  update public.inboxes set status = 'active' where id = v_inbox;

  -- 12. daily cap (counted in Asia/Kolkata days over queued/sending/sent/unknown)
  update public.inboxes set daily_send_cap = (select count(*) from public.email_sends
     where inbox_id = v_inbox and status in ('queued','sending','sent','unknown')) where id = v_inbox;
  r := pg_temp.try_as('service_role', null, format($q$insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
        values (%L, 'k14', %L, 'paused@sg-test.invalid', 's', 'b', %L)$q$, d3, v_inbox, v_camp));
  perform pg_temp.expect('daily cap', r, 'err:.*daily send cap');

  raise exception 'SUITE_OK';
end $$;
