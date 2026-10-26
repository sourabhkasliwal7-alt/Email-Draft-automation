-- SPEC 23.3: approving a draft for Gmail is NOT approval for sending. Only users with sender permission
-- (admin or sender) may record a send approval, and only in their own name.
drop policy send_approvals_insert on public.send_approvals;
create policy send_approvals_insert on public.send_approvals for insert to authenticated
  with check ((select private.app_role()) in ('admin','sender') and approved_by = (select auth.uid()));

-- SPEC 23.3: re-check "verified or accepted email status" - an address verified as invalid can never be queued.
create or replace function private.guard_email_send() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d public.email_drafts%rowtype;
  a public.send_approvals%rowtype;
  v_campaign uuid;
  v_contact_email text;
  v_dnc boolean;
  v_email_status text;
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

  select cl.campaign_id, c.email_lower, c.dnc, c.email_status into v_campaign, v_contact_email, v_dnc, v_email_status
    from public.campaign_leads cl join public.contacts c on c.id = cl.contact_id
   where cl.id = d.campaign_lead_id;
  if v_contact_email is null or lower(btrim(new.recipient_email)) <> v_contact_email then
    raise exception 'send blocked: recipient does not match the lead contact' using errcode = 'P0001';
  end if;
  if v_dnc then
    raise exception 'send blocked: contact is marked do-not-contact' using errcode = 'P0001';
  end if;
  if v_email_status = 'invalid' then
    raise exception 'send blocked: email address is verified invalid' using errcode = 'P0001';
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
