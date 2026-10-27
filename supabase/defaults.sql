-- Required defaults for a new project (NOT demo data): display/storage time zones and the global daily and monthly spend caps.
-- Idempotent. Safe to run on a real project. Nothing here is created by the app at startup; run it by hand once.

insert into public.settings (key, value) values
  ('display_timezone', '"Asia/Kolkata"'),
  ('storage_timezone', '"UTC"')
on conflict (key) do nothing;

insert into public.spend_caps (scope, period, cap_usd)
select 'global', p, c from (values ('daily', 5), ('monthly', 50)) v(p, c)
where not exists (select 1 from public.spend_caps where scope = 'global' and period = v.p);
