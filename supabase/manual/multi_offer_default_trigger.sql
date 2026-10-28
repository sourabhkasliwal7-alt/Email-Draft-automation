-- NOT APPLIED: the Supabase MCP declined it twice. Optional hardening; see BLOCKERS.md "SQL for owner to run".
-- The default offer is always one of the campaign's offers. A trigger keeps that true for every writer (the form, scripts, tests)
-- instead of a CHECK constraint that would reject code that only knows campaigns.offer_id.
alter table public.campaigns drop constraint if exists campaigns_default_offer_in_offer_ids;

create or replace function public.campaigns_keep_default_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.offer_id is not null and not (new.offer_id = any (new.offer_ids)) then
    new.offer_ids := array_append(new.offer_ids, new.offer_id);
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_keep_default_offer on public.campaigns;
create trigger campaigns_keep_default_offer
  before insert or update on public.campaigns
  for each row execute function public.campaigns_keep_default_offer();

revoke execute on function public.campaigns_keep_default_offer() from public, anon, authenticated;
