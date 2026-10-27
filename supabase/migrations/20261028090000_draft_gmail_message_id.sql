-- "Open in Gmail": Gmail opens a draft by its message id (the draft id alone is not enough for a link).
alter table public.email_drafts add column if not exists gmail_message_id text;
