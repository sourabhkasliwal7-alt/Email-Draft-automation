-- Phase 1 / migration 4: advisor fix. Supabase's rls_auto_enable() event-trigger helper must not be RPC-callable.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
