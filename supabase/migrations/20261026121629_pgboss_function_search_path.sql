-- Advisor fix on the pgboss schema (owned by us, hand-applied schema in supabase/manual/pgboss_schema.sql):
-- pin search_path on pg-boss's two helper functions.
alter function pgboss.create_queue(text, json) set search_path = pgboss, pg_temp;
alter function pgboss.delete_queue(text) set search_path = pgboss, pg_temp;
