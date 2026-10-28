-- Web discovery: remember which search query found a lead (and, for other sources, a short detail such as the file name).
alter table public.campaign_leads add column if not exists source_detail text;
