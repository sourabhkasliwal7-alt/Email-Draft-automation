-- Phase 1 / migration 3: reporting views (security_invoker so RLS of the caller applies; days in Asia/Kolkata)

create view public.v_daily_metrics with (security_invoker = true) as
with days as (
  select (created_at at time zone 'Asia/Kolkata')::date as day, 'drafts_created' as metric, 1 as n from public.email_drafts
  union all select (approved_at at time zone 'Asia/Kolkata')::date, 'approvals', 1 from public.send_approvals
  union all select (sent_at at time zone 'Asia/Kolkata')::date, 'sent', 1 from public.email_sends where status = 'sent'
  union all select (created_at at time zone 'Asia/Kolkata')::date, 'failed', 1 from public.email_sends where status = 'failed'
  union all select (received_at at time zone 'Asia/Kolkata')::date, 'replies', 1 from public.replies where kind = 'reply'
  union all select (received_at at time zone 'Asia/Kolkata')::date, 'bounces', 1 from public.replies where kind = 'bounce'
  union all select (received_at at time zone 'Asia/Kolkata')::date, 'opt_outs', 1 from public.replies where kind = 'opt_out'
)
select day,
  count(*) filter (where metric = 'drafts_created') as drafts_created,
  count(*) filter (where metric = 'approvals') as approvals,
  count(*) filter (where metric = 'sent') as sent,
  count(*) filter (where metric = 'failed') as failed,
  count(*) filter (where metric = 'replies') as replies,
  count(*) filter (where metric = 'bounces') as bounces,
  count(*) filter (where metric = 'opt_outs') as opt_outs
from days where day is not null group by day;

create view public.v_campaign_performance with (security_invoker = true) as
select c.id as campaign_id, c.name, c.status,
  (select count(*) from public.campaign_leads cl where cl.campaign_id = c.id) as leads,
  (select count(*) from public.campaign_leads cl where cl.campaign_id = c.id and cl.status in ('approved','queued','sent','replied')) as approved_or_later,
  (select count(*) from public.email_sends es where es.campaign_id = c.id and es.status = 'sent') as sent,
  (select count(*) from public.replies r join public.email_sends es on es.id = r.send_id
     where es.campaign_id = c.id and r.kind = 'reply') as replies,
  (select count(*) from public.replies r join public.email_sends es on es.id = r.send_id
     where es.campaign_id = c.id and r.kind = 'bounce') as bounces,
  (select count(*) from public.replies r join public.email_sends es on es.id = r.send_id
     where es.campaign_id = c.id and r.kind = 'opt_out') as opt_outs,
  coalesce((select sum(u.cost_usd) from public.usage_records u where u.campaign_id = c.id), 0) as cost_usd
from public.campaigns c
where c.deleted_at is null;

create view public.v_cost_summary with (security_invoker = true) as
select date_trunc('month', u.created_at at time zone 'Asia/Kolkata')::date as month,
  u.provider, u.campaign_id, sum(u.cost_usd) as cost_usd, count(*) as calls
from public.usage_records u
group by 1, 2, 3;

create view public.v_followups_due with (security_invoker = true) as
select f.id as followup_id, f.campaign_lead_id, f.step, f.due_date, cl.campaign_id, cl.contact_id,
  c.full_name, c.email, cl.status as lead_status
from public.followups f
join public.campaign_leads cl on cl.id = f.campaign_lead_id
join public.contacts c on c.id = cl.contact_id
where f.status = 'pending'
  and f.due_date <= (now() at time zone 'Asia/Kolkata')::date
  and cl.status not in ('replied','bounced','opted_out','closed','disqualified')
  and not c.dnc;

revoke all on public.v_daily_metrics, public.v_campaign_performance, public.v_cost_summary, public.v_followups_due from anon;
