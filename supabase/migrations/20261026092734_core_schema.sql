-- Phase 1 / migration 1: core schema (tables, constraints, indexes, updated_at triggers)
-- All timestamps are timestamptz (UTC); the UI displays them in Asia/Kolkata.

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- identity
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'operator' check (role in ('admin','operator','reviewer','sender')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inboxes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_lower text generated always as (lower(btrim(email))) stored,
  display_name text,
  status text not null default 'disconnected' check (status in ('disconnected','active','paused','error')),
  encrypted_refresh_token text,            -- AES-256-GCM ciphertext; never readable by end-user roles
  scopes text[] not null default '{}',
  daily_draft_cap int not null default 50 check (daily_draft_cap >= 0),
  daily_send_cap int not null default 20 check (daily_send_cap >= 0),
  min_seconds_between_sends int not null default 60 check (min_seconds_between_sends >= 0),
  last_health_check timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inboxes_email_lower_key on public.inboxes (email_lower) where deleted_at is null;

-- ---------------------------------------------------------------- offers
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  allowed_claims text[] not null default '{}',
  cta_options text[] not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.case_studies (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references public.offers(id) on delete restrict,
  title text not null,
  summary text,
  allowed_numbers jsonb not null default '{}'::jsonb,
  industries text[] not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- campaigns
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icp jsonb not null default '{}'::jsonb,
  target_roles text[] not null default '{}',
  regions text[] not null default '{}',
  score_draft_min int not null default 70 check (score_draft_min between 0 and 100),
  score_review_min int not null default 50 check (score_review_min between 0 and 100),
  daily_cap int not null default 20 check (daily_cap >= 0),
  offer_id uuid references public.offers(id) on delete restrict,
  tone text,
  cta text,
  inbox_id uuid references public.inboxes(id) on delete restrict,
  research_depth text not null default 'standard' check (research_depth in ('light','standard','deep')),
  send_window jsonb not null default '{"tz":"Asia/Kolkata","days":[1,2,3,4,5],"start":"10:00","end":"17:00"}'::jsonb,
  status text not null default 'draft' check (status in ('draft','active','paused','completed','archived')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (score_review_min <= score_draft_min)
);

-- ---------------------------------------------------------------- companies / contacts
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  name text,
  country text,
  industry text,
  employee_count int check (employee_count is null or employee_count >= 0),
  website text,
  summary text,
  research_cached_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (domain = lower(domain))
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  first_name text,
  last_name text,
  job_title text,
  email text,                               -- original casing preserved
  email_lower text generated always as (lower(btrim(email))) stored,
  email_status text not null default 'unknown' check (email_status in ('unknown','valid','risky','invalid','catch_all')),
  profile_url text,
  company_id uuid references public.companies(id) on delete restrict,
  country text,
  dnc boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_email_lower_key unique nulls distinct (email_lower),
  constraint contacts_profile_url_key unique nulls distinct (profile_url)
);

create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  lead_source text,
  icp_segment text,
  lead_score int check (lead_score is null or lead_score between 0 and 100),
  score_components jsonb not null default '{}'::jsonb,
  reason_codes text[] not null default '{}',
  status text not null default 'imported' check (status in (
    'imported','researching','researched','scored','drafting','draft_ready','needs_review',
    'approved','queued','sent','replied','bounced','opted_out','nurture','closed','disqualified','failed')),
  trigger text,
  trigger_date date,
  trigger_source text,
  offer_id uuid references public.offers(id) on delete restrict,
  case_study_id uuid references public.case_studies(id) on delete restrict,
  owner_id uuid references auth.users(id) on delete set null,
  last_contact_date date,
  next_action text,
  next_action_date date,
  nurture_date date,
  opportunity_value numeric(14,2) check (opportunity_value is null or opportunity_value >= 0),
  review_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

-- ---------------------------------------------------------------- imports
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_hash text not null,
  storage_path text,
  sheet text,
  mapping jsonb not null default '{}'::jsonb,
  mode text not null default 'append' check (mode in ('append','update','dry_run')),
  totals jsonb not null default '{}'::jsonb,
  status text not null default 'uploaded' check (status in ('uploaded','mapped','validating','ready','importing','completed','failed','cancelled')),
  user_id uuid references auth.users(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete restrict,
  row_number int not null check (row_number >= 1),
  original jsonb not null,
  normalized jsonb,
  status text not null default 'pending' check (status in ('pending','valid','invalid','duplicate','suppressed','imported','skipped')),
  errors text[] not null default '{}',
  contact_id uuid references public.contacts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

-- ---------------------------------------------------------------- research
create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  campaign_lead_id uuid references public.campaign_leads(id) on delete restrict,
  depth text not null default 'standard' check (depth in ('light','standard','deep')),
  status text not null default 'pending' check (status in ('pending','running','completed','failed','cancelled')),
  provider text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  research_run_id uuid references public.research_runs(id) on delete restrict,
  url text not null,
  title text,
  snippet text,
  retrieved_at timestamptz not null default now(),
  source_type text not null default 'web' check (source_type in ('web','news','company_site','job_post','filing','provider','manual')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, url)
);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  type text not null check (type in ('funding','hiring','expansion','launch','leadership','other')),
  description text not null,
  source_url text,
  source_name text,
  signal_date date,
  retrieved_at timestamptz not null default now(),
  verification text not null default 'possible' check (verification in ('verified','possible','stale')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  provider text,
  evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (company_id, type, source_url)
);

create table public.enrichment_results (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  provider text not null,
  result jsonb not null default '{}'::jsonb,
  credits_used numeric(12,4) not null default 0 check (credits_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- drafts / approvals / sends
create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  campaign_lead_id uuid not null references public.campaign_leads(id) on delete restrict,
  step int not null default 0 check (step >= 0),        -- 0 = first touch, 1.. = follow-ups
  version int not null default 1 check (version >= 1),
  subject text not null,
  body_text text not null,
  body_html text,
  facts jsonb not null default '[]'::jsonb,              -- array of evidence_items ids
  claim_check jsonb not null default '{}'::jsonb,
  quality_score int check (quality_score is null or quality_score between 0 and 100),
  warnings text[] not null default '{}',
  status text not null default 'draft' check (status in (
    'draft','needs_review','approved','rejected','queued','sent','failed','superseded')),
  inbox_id uuid references public.inboxes(id) on delete restrict,
  gmail_draft_id text,
  gmail_message_id_header text,
  body_hash text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_lead_id, step, version)
);

create table public.send_approvals (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.email_drafts(id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  body_hash text,                                        -- hash of the exact body that was approved
  batch_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_sends (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.email_drafts(id) on delete restrict,
  send_key text not null unique,
  inbox_id uuid not null references public.inboxes(id) on delete restrict,
  recipient_name text,
  recipient_email text not null,
  company text,
  subject text not null,
  body_text text not null,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled','unknown')),
  failure_reason text,
  attempt int not null default 0 check (attempt >= 0),
  sent_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.email_sends(id) on delete restrict,
  received_at timestamptz not null default now(),
  kind text not null check (kind in ('reply','auto_reply','bounce','opt_out')),
  snippet text,
  gmail_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls distinct (gmail_message_id)
);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  campaign_lead_id uuid not null references public.campaign_leads(id) on delete restrict,
  step int not null check (step >= 1),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','drafted','sent','skipped','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_lead_id, step)
);

-- ---------------------------------------------------------------- history (append-only)
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  campaign_lead_id uuid references public.campaign_leads(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete restrict,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null default 'system',
  action text not null,
  entity text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- suppression
create table public.suppression (
  id uuid primary key default gen_random_uuid(),
  email_lower text check (email_lower is null or email_lower = lower(email_lower)),
  domain text check (domain is null or domain = lower(domain)),
  scope text not null default 'global' check (scope in ('global','campaign')),
  campaign_id uuid references public.campaigns(id) on delete restrict,
  reason text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email_lower is not null or domain is not null),
  check ((scope = 'campaign') = (campaign_id is not null))
);
create unique index suppression_uniq on public.suppression
  (coalesce(email_lower,''), coalesce(domain,''), scope, coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------- jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  attempts int not null default 0 check (attempts >= 0),
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  step text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','skipped')),
  attempts int not null default 0 check (attempts >= 0),
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  output_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, step)
);

-- ---------------------------------------------------------------- cost & config
create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  units jsonb not null default '{}'::jsonb,             -- raw usage, e.g. {"input_tokens":1200,"output_tokens":300}
  cost_usd numeric(14,6) not null default 0 check (cost_usd >= 0),  -- computed from units x price_table at record time
  campaign_id uuid references public.campaigns(id) on delete restrict,
  campaign_lead_id uuid references public.campaign_leads(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_table (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  unit text not null,                                   -- e.g. input_token, output_token, search, credit
  usd_per_unit numeric(18,10) not null check (usd_per_unit >= 0),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, unit, effective_from)
);

create table public.spend_caps (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'global' check (scope in ('global','campaign','provider')),
  campaign_id uuid references public.campaigns(id) on delete restrict,
  provider text,
  period text not null check (period in ('daily','monthly','total')),
  cap_usd numeric(14,2) not null check (cap_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'campaign') = (campaign_id is not null)),
  check ((scope = 'provider') = (provider is not null))
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes (FKs, status, email_lower, domain, created_at)
create index inboxes_status_idx on public.inboxes (status);
create index case_studies_offer_id_idx on public.case_studies (offer_id);
create index campaigns_offer_id_idx on public.campaigns (offer_id);
create index campaigns_inbox_id_idx on public.campaigns (inbox_id);
create index campaigns_status_idx on public.campaigns (status);
create index campaigns_created_at_idx on public.campaigns (created_at);
create index companies_created_at_idx on public.companies (created_at);
create index contacts_company_id_idx on public.contacts (company_id);
create index contacts_created_at_idx on public.contacts (created_at);
create index contacts_dnc_idx on public.contacts (dnc) where dnc;
create index campaign_leads_contact_id_idx on public.campaign_leads (contact_id);
create index campaign_leads_status_idx on public.campaign_leads (campaign_id, status);
create index campaign_leads_offer_id_idx on public.campaign_leads (offer_id);
create index campaign_leads_case_study_id_idx on public.campaign_leads (case_study_id);
create index campaign_leads_owner_id_idx on public.campaign_leads (owner_id);
create index campaign_leads_next_action_date_idx on public.campaign_leads (next_action_date);
create index campaign_leads_created_at_idx on public.campaign_leads (created_at);
create index import_batches_user_id_idx on public.import_batches (user_id);
create index import_batches_campaign_id_idx on public.import_batches (campaign_id);
create index import_batches_file_hash_idx on public.import_batches (file_hash);
create index import_batches_status_idx on public.import_batches (status);
create index import_rows_contact_id_idx on public.import_rows (contact_id);
create index import_rows_status_idx on public.import_rows (batch_id, status);
create index research_runs_company_id_idx on public.research_runs (company_id);
create index research_runs_campaign_lead_id_idx on public.research_runs (campaign_lead_id);
create index research_runs_status_idx on public.research_runs (status);
create index evidence_items_research_run_id_idx on public.evidence_items (research_run_id);
create index signals_company_id_idx on public.signals (company_id);
create index signals_evidence_item_id_idx on public.signals (evidence_item_id);
create index signals_verification_idx on public.signals (verification);
create index enrichment_results_contact_id_idx on public.enrichment_results (contact_id);
create index email_drafts_inbox_id_idx on public.email_drafts (inbox_id);
create index email_drafts_status_idx on public.email_drafts (status);
create index email_drafts_created_at_idx on public.email_drafts (created_at);
create index send_approvals_approved_by_idx on public.send_approvals (approved_by);
create index email_sends_draft_id_idx on public.email_sends (draft_id);
create index email_sends_inbox_id_idx on public.email_sends (inbox_id, created_at);
create index email_sends_campaign_id_idx on public.email_sends (campaign_id);
create index email_sends_status_idx on public.email_sends (status);
create index email_sends_recipient_idx on public.email_sends (lower(recipient_email));
create index replies_send_id_idx on public.replies (send_id);
create index replies_kind_idx on public.replies (kind);
create index followups_status_due_idx on public.followups (status, due_date);
create index lead_events_campaign_lead_id_idx on public.lead_events (campaign_lead_id, created_at);
create index lead_events_contact_id_idx on public.lead_events (contact_id);
create index lead_events_type_idx on public.lead_events (type);
create index audit_log_created_at_idx on public.audit_log (created_at);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index suppression_email_lower_idx on public.suppression (email_lower) where email_lower is not null;
create index suppression_domain_idx on public.suppression (domain) where domain is not null;
create index suppression_campaign_id_idx on public.suppression (campaign_id);
create index jobs_status_run_after_idx on public.jobs (status, run_after);
create index jobs_campaign_id_idx on public.jobs (campaign_id);
create index usage_records_campaign_id_idx on public.usage_records (campaign_id);
create index usage_records_campaign_lead_id_idx on public.usage_records (campaign_lead_id);
create index usage_records_job_id_idx on public.usage_records (job_id);
create index usage_records_created_at_idx on public.usage_records (created_at);
create index price_table_lookup_idx on public.price_table (provider, unit, effective_from desc);
create index spend_caps_campaign_id_idx on public.spend_caps (campaign_id);

-- ---------------------------------------------------------------- updated_at triggers on every table
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;
