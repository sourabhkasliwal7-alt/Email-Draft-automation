-- Apollo credits used today and this month (IST days), for Home. One row per real/mock so test runs never mix with real ones.
-- Credits = email reveals (credit_ledger) + search credits that cost something (usage_records of provider apollo).
create or replace view public.v_apollo_credits with (security_invoker = true) as
with bounds as (
  select (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as day_start,
         (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as month_start
), used as (
  select l.is_mock, l.credits::numeric as credits, l.started_at as at
  from public.credit_ledger l where l.status in ('started', 'done', 'uncertain')
  union all
  select u.is_mock, coalesce((u.units ->> 'credit')::numeric, 0), u.created_at
  from public.usage_records u where u.provider = 'apollo' and u.status in ('reserved', 'recorded')
)
select used.is_mock,
       coalesce(sum(used.credits) filter (where used.at >= b.day_start), 0)::int as today,
       coalesce(sum(used.credits) filter (where used.at >= b.month_start), 0)::int as month
from used cross join bounds b
group by used.is_mock;
