-- Dev seed (idempotent). Demo data only: example.com domains, no real recipients.

insert into public.settings (key, value) values
  ('display_timezone', '"Asia/Kolkata"'),
  ('storage_timezone', '"UTC"')
on conflict (key) do nothing;

insert into public.spend_caps (scope, period, cap_usd)
select 'global', p, c from (values ('daily', 5), ('monthly', 50)) v(p, c)
where not exists (select 1 from public.spend_caps where scope = 'global' and period = v.p);

insert into public.offers (id, name, description, allowed_claims, cta_options) values
  ('00000000-0000-4000-8000-0000000000a1', 'Nuance: AI workflow audit',
   'A fixed-scope audit of manual workflows with a prioritised automation roadmap.',
   array['Fixed-scope, two-week audit','Roadmap delivered as a written report'],
   array['Open to a 20-minute call next week?','Want me to send a one-page sample audit?']),
  ('00000000-0000-4000-8000-0000000000a2', 'Nuance: Outreach automation build',
   'Design and build of a reviewed, human-approved outbound pipeline.',
   array['Every email is human-approved before sending','Built on your own inbox'],
   array['Worth a quick chat?','Shall I share how it works?'])
on conflict (id) do nothing;

insert into public.case_studies (id, offer_id, title, summary, allowed_numbers, industries) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1',
   'Demo: Logistics ops audit', 'Illustrative demo case study (not a real client).',
   '{"hours_saved_per_week": 12}'::jsonb, array['logistics']),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a2',
   'Demo: SaaS outbound pipeline', 'Illustrative demo case study (not a real client).',
   '{"drafts_per_day": 30}'::jsonb, array['saas'])
on conflict (id) do nothing;

insert into public.inboxes (id, email, display_name, status)
values ('00000000-0000-4000-8000-0000000000c1', 'demo-sender@example.com', 'Demo Sender', 'disconnected')
on conflict (id) do nothing;

insert into public.campaigns (id, name, icp, target_roles, regions, offer_id, tone, cta, inbox_id, status)
values ('00000000-0000-4000-8000-0000000000d1', 'Demo campaign',
        '{"industries":["saas","logistics"],"employee_range":[20,500]}'::jsonb,
        array['Head of Operations','COO'], array['IN','US'],
        '00000000-0000-4000-8000-0000000000a1', 'plain, specific, short',
        'Open to a 20-minute call next week?', '00000000-0000-4000-8000-0000000000c1', 'draft')
on conflict (id) do nothing;

insert into public.suppression (email_lower, domain, scope, campaign_id, reason, source)
select * from (values
  ('optout@example.com', null, 'global', null::uuid, 'Replied: unsubscribe', 'seed'),
  (null, 'blocked.example.com', 'global', null::uuid, 'Customer asked us not to contact the domain', 'seed'),
  ('paused@example.com', null, 'campaign', '00000000-0000-4000-8000-0000000000d1'::uuid, 'Paused by account owner for this campaign', 'seed')
) v(email_lower, domain, scope, campaign_id, reason, source)
where not exists (
  select 1 from public.suppression s
  where coalesce(s.email_lower,'') = coalesce(v.email_lower,'') and coalesce(s.domain,'') = coalesce(v.domain,'')
    and s.scope = v.scope);

-- 10 fake leads: acme-01..10.example.com
with n as (select g from generate_series(1, 10) g),
co as (
  insert into public.companies (domain, name, country, industry, employee_count, website, summary)
  select format('acme-%s.example.com', lpad(g::text, 2, '0')), format('Acme %s Ltd', g),
         case when g % 2 = 0 then 'IN' else 'US' end,
         case when g % 2 = 0 then 'saas' else 'logistics' end,
         20 + g * 30, format('https://acme-%s.example.com', lpad(g::text, 2, '0')), 'Fake demo company.'
  from n on conflict (domain) do update set name = excluded.name
  returning id, domain
),
ct as (
  insert into public.contacts (full_name, first_name, last_name, job_title, email, company_id, country)
  select format('Demo Person%s', g), 'Demo', format('Person%s', g),
         case when g % 2 = 0 then 'Head of Operations' else 'COO' end,
         format('Person%s@acme-%s.example.com', g, lpad(g::text, 2, '0')), co.id,
         case when g % 2 = 0 then 'IN' else 'US' end
  from n join co on co.domain = format('acme-%s.example.com', lpad(g::text, 2, '0'))
  on conflict (email_lower) do update set full_name = excluded.full_name
  returning id
)
insert into public.campaign_leads (campaign_id, contact_id, lead_source, icp_segment, lead_score, status)
select '00000000-0000-4000-8000-0000000000d1', ct.id, 'seed', 'demo', 40 + (random() * 55)::int, 'imported'
from ct
on conflict (campaign_id, contact_id) do nothing;
