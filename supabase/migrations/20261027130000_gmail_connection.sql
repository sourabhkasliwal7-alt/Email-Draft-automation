-- Gmail connection: a mailbox can now say "needs reconnect" (Google no longer accepts its sign-in), and the UI shows when it was
-- connected (for the 7-day expiry warning while the Google app is in Testing mode) and the last error.
-- The encrypted refresh token itself stays unreadable and unwritable for every user role (service role only).

alter table public.inboxes add column if not exists connected_at timestamptz;
alter table public.inboxes add column if not exists last_error text;

alter table public.inboxes drop constraint if exists inboxes_status_check;
alter table public.inboxes add constraint inboxes_status_check
  check (status in ('disconnected', 'active', 'paused', 'error', 'needs_reconnect'));

-- column-level grants: the new columns are readable like the other safe columns, never writable by a user role
grant select (connected_at, last_error) on public.inboxes to authenticated;
