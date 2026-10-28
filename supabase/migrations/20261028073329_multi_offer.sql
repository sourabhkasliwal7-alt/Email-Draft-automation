-- Multiple offers per campaign (SRS E7): the offer is chosen per lead by rules, not by the model.
--   offers.match_terms    business types / industries / keywords the offer fits ("agency", "web design", "healthcare")
--   offers.trigger_types  optional trigger types it fits best (hiring-developers, funding, new-product, ...)
--   campaigns.offer_ids   the offers a campaign may use; campaigns.offer_id stays and is the DEFAULT offer
--   campaign_leads.offer_reason  why the rules chose the offer for the lead (shown on the run page and in the run report)
alter table public.offers add column if not exists match_terms text[] not null default '{}';
alter table public.offers add column if not exists trigger_types text[] not null default '{}';

alter table public.campaigns add column if not exists offer_ids uuid[] not null default '{}';
-- existing campaigns keep working: their current offer becomes the only offer and the default
update public.campaigns set offer_ids = array[offer_id] where offer_id is not null and offer_ids = '{}';
alter table public.campaigns drop constraint if exists campaigns_default_offer_in_offer_ids;
alter table public.campaigns add constraint campaigns_default_offer_in_offer_ids check (offer_id is null or offer_id = any (offer_ids));

alter table public.campaign_leads add column if not exists offer_reason text;
