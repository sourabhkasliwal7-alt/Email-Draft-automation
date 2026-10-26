-- Suite 002: append-only history, soft delete, email normalisation, structural guarantees.
do $$
declare
  v_admin uuid := pg_temp.mk_user('hs-admin@test.invalid');
  v_inbox uuid; v_camp uuid; v_offer uuid; v_lead uuid; v_ct uuid; v_co uuid; v_draft uuid; v_ev uuid; v_send uuid;
  t text; n int; r text;
begin
  insert into public.inboxes (email, status) values ('hs-inbox@test.invalid', 'active') returning id into v_inbox;
  insert into public.offers (name) values ('HS offer') returning id into v_offer;
  insert into public.campaigns (name, inbox_id, offer_id) values ('HS campaign', v_inbox, v_offer) returning id into v_camp;
  v_draft := pg_temp.mk_draft(v_camp, v_inbox, 'Hist.Lead@HS-Test.invalid', 'hs1', v_admin);
  select cl.id, cl.contact_id into v_lead, v_ct from public.campaign_leads cl join public.email_drafts d on d.campaign_lead_id = cl.id where d.id = v_draft;
  select company_id into v_co from public.contacts where id = v_ct;
  insert into public.email_sends (draft_id, send_key, inbox_id, recipient_email, subject, body_text, campaign_id)
    values (v_draft, 'hs-k1', v_inbox, 'hist.lead@hs-test.invalid', 's', 'b', v_camp) returning id into v_send;
  insert into public.replies (send_id, kind) values (v_send, 'reply');

  -- append-only tables: owner (trigger) and every API role
  insert into public.lead_events (campaign_lead_id, contact_id, type, actor) values (v_lead, v_ct, 'imported', 'test');
  insert into public.audit_log (action, entity) values ('test', 'x');
  foreach t in array array['lead_events','audit_log','send_approvals'] loop
    r := pg_temp.try_as('postgres', null, format('update public.%I set updated_at = now()', t));
    perform pg_temp.expect(t || ' update by owner', r, 'err:.*append-only');
    r := pg_temp.try_as('postgres', null, format('delete from public.%I', t));
    perform pg_temp.expect(t || ' delete by owner', r, 'err:.*append-only');
    r := pg_temp.try_as('postgres', null, format('truncate public.%I cascade', t));
    perform pg_temp.expect(t || ' truncate by owner', r, 'err:.*append-only');
    r := pg_temp.try_as('service_role', null, format('update public.%I set updated_at = now()', t));
    perform pg_temp.expect(t || ' update by service_role', r, 'err:.*(permission denied|append-only)');
    r := pg_temp.try_as('service_role', null, format('delete from public.%I', t));
    perform pg_temp.expect(t || ' delete by service_role', r, 'err:.*(permission denied|append-only)');
    r := pg_temp.try_as('authenticated', v_admin, format('update public.%I set updated_at = now()', t));
    perform pg_temp.expect(t || ' update by authenticated', r, 'err:.*(permission denied|append-only)');
    r := pg_temp.try_as('authenticated', v_admin, format('delete from public.%I', t));
    perform pg_temp.expect(t || ' delete by authenticated', r, 'err:.*(permission denied|append-only)');
  end loop;

  -- no hard deletes of history-bearing tables; campaigns are soft-deleted and history survives
  foreach t in array array['campaigns','campaign_leads','contacts','companies','email_drafts','email_sends','replies'] loop
    r := pg_temp.try_as('postgres', null, format('delete from public.%I', t));
    perform pg_temp.expect(t || ' hard delete', r, 'err:.*hard delete');
    r := pg_temp.try_as('postgres', null, format('truncate public.%I cascade', t));
    perform pg_temp.expect(t || ' truncate', r, 'err:.*(hard delete|append-only)');
  end loop;
  r := pg_temp.try_as('authenticated', v_admin, format('delete from public.campaigns where id = %L', v_camp));
  perform pg_temp.expect('campaign delete via API', r, 'err:.*permission denied');
  update public.campaigns set deleted_at = now(), status = 'archived' where id = v_camp;
  select count(*) into n from public.campaign_leads where campaign_id = v_camp;
  if n <> 1 then raise exception 'FAIL [history survives soft delete]: leads=%', n; end if;
  select count(*) into n from public.email_sends where campaign_id = v_camp;
  if n <> 1 then raise exception 'FAIL [history survives soft delete]: sends=%', n; end if;
  select count(*) into n from public.v_campaign_performance where campaign_id = v_camp;
  if n <> 0 then raise exception 'FAIL [soft-deleted campaign hidden from performance view]'; end if;
  r := pg_temp.try_as('postgres', null, format('delete from public.offers where id = %L', v_offer));
  perform pg_temp.expect('offer in use cannot be deleted', r, 'err:.*foreign key');

  -- email normalisation: lowercased for uniqueness, original kept
  select email_lower into r from public.contacts where id = v_ct;
  if r <> 'hist.lead@hs-test.invalid' then raise exception 'FAIL [email_lower]: %', r; end if;
  select email into r from public.contacts where id = v_ct;
  if r <> 'Hist.Lead@HS-Test.invalid' then raise exception 'FAIL [original email kept]: %', r; end if;
  r := pg_temp.try_as('postgres', null, $q$insert into public.contacts (email) values ('HIST.LEAD@hs-test.invalid')$q$);
  perform pg_temp.expect('case-insensitive email unique', r, 'err:.*duplicate key');
  r := pg_temp.try_as('postgres', null, $q$insert into public.contacts (email, profile_url) values (null, 'https://p.invalid/1'), (null, 'https://p.invalid/2')$q$);
  perform pg_temp.expect('null emails allowed (nulls distinct)', r, '^ok:2$');
  r := pg_temp.try_as('postgres', null, $q$insert into public.contacts (email, profile_url) values (null, 'https://p.invalid/1')$q$);
  perform pg_temp.expect('profile_url unique', r, 'err:.*duplicate key');
  r := pg_temp.try_as('postgres', null, $q$insert into public.companies (domain) values ('UPPER.invalid')$q$);
  perform pg_temp.expect('domain must be lowercase', r, 'err:.*check constraint');
  r := pg_temp.try_as('postgres', null, format('insert into public.campaign_leads (campaign_id, contact_id) values (%L, %L)', v_camp, v_ct));
  perform pg_temp.expect('lead unique per campaign', r, 'err:.*duplicate key');

  -- idempotency keys
  r := pg_temp.try_as('postgres', null, format($q$insert into public.email_drafts (campaign_lead_id, subject, body_text, idempotency_key, version) values (%L,'s','b','hs1',2)$q$, v_lead));
  perform pg_temp.expect('draft idempotency_key unique', r, 'err:.*duplicate key');
  insert into public.jobs (type, idempotency_key) values ('t', 'job-1');
  r := pg_temp.try_as('postgres', null, $q$insert into public.jobs (type, idempotency_key) values ('t', 'job-1')$q$);
  perform pg_temp.expect('job idempotency_key unique', r, 'err:.*duplicate key');

  -- evidence: URL per company is unique (no duplicate evidence rows from retried research)
  insert into public.evidence_items (company_id, url) values (v_co, 'https://e.invalid/a') returning id into v_ev;
  r := pg_temp.try_as('postgres', null, format($q$insert into public.evidence_items (company_id, url) values (%L, 'https://e.invalid/a')$q$, v_co));
  perform pg_temp.expect('evidence unique', r, 'err:.*duplicate key');

  -- structure: RLS everywhere, uuid id + UTC timestamps + updated_at trigger on every table, every FK indexed
  select count(*) into n from pg_tables where schemaname = 'public' and not rowsecurity;
  if n <> 0 then raise exception 'FAIL [rls enabled on every table]: % tables without RLS', n; end if;
  select count(*) into n from pg_tables tb where schemaname = 'public' and not exists (
    select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = tb.tablename);
  if n <> 0 then raise exception 'FAIL [every table has at least one policy]: %', n; end if;
  select count(*) into n from pg_tables tb where schemaname = 'public' and (
    not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.tablename and c.column_name='id' and c.data_type='uuid')
    or not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.tablename and c.column_name='created_at' and c.data_type='timestamp with time zone')
    or not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tb.tablename and c.column_name='updated_at' and c.data_type='timestamp with time zone'));
  if n <> 0 then raise exception 'FAIL [id/created_at/updated_at (timestamptz) on every table]: %', n; end if;
  select count(*) into n from information_schema.columns
   where table_schema='public' and data_type = 'timestamp without time zone';
  if n <> 0 then raise exception 'FAIL [all timestamps are timestamptz]: %', n; end if;
  select count(*) into n from pg_tables tb where schemaname = 'public' and not exists (
    select 1 from pg_trigger g where g.tgrelid = ('public.' || quote_ident(tb.tablename))::regclass and g.tgname = 'set_updated_at');
  if n <> 0 then raise exception 'FAIL [updated_at trigger on every table]: %', n; end if;
  select count(*) into n from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]);
  if n <> 0 then raise exception 'FAIL [every foreign key is indexed]: % unindexed', n; end if;

  raise exception 'SUITE_OK';
end $$;
