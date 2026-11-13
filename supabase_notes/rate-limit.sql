-- supabase_notes/rate-limit.sql
--
-- Atomic per-user rate limit (review rounds 6 and 7): a count followed by
-- an insert is racy — two simultaneous requests can both see fewer than the
-- limit and both proceed. This RPC counts AND inserts in one database
-- transaction, AND it serializes concurrent checks for the same user and
-- function with pg_advisory_xact_lock. Without the lock, PostgreSQL's
-- default READ COMMITTED isolation still lets two concurrent transactions
-- both count 9, both decide the limit of 10 is not reached, and both insert.
-- The advisory lock makes concurrent checks for the same (user, fn) wait
-- for one another, so the count is always current when it is read.
--
-- Usage (from an edge function, service role only):
--   select check_rate_limit('<user_id>', 'reconcile-withdrawals', 10, 60);
-- Returns true when the call is allowed (and records it), false when the
-- user is over the limit. The window is the last p_window_minutes minutes.
--
-- The edge_rate_limits table (one row per call) is defined in
-- security-hardening.sql. Old rows are never deleted by this function;
-- prune them with a scheduled cleanup (e.g. delete where created_at <
-- now() - interval '7 days') if the table grows.
--
-- Run once in the SQL editor. Re-runnable.

-- Index supporting the count (also created in security-hardening.sql;
-- included here so this file is self-contained).
create index if not exists edge_rate_limits_user_fn_created_idx
on public.edge_rate_limits (user_id, fn, created_at);

create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_fn text,
  p_limit integer,
  p_window_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_fn is null or length(trim(p_fn)) = 0 then
    raise exception 'check_rate_limit: user_id and fn are required';
  end if;
  if p_limit is null or p_limit <= 0 then
    raise exception 'check_rate_limit: limit must be positive';
  end if;
  if p_window_minutes is null or p_window_minutes <= 0 then
    raise exception 'check_rate_limit: window must be positive';
  end if;

  -- Serialize concurrent checks for this (user, fn): without this lock,
  -- two transactions can both count 9 and both insert under READ COMMITTED.
  -- The lock is released automatically when this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_fn, 0));

  -- Count calls in the window, then insert this call — in one transaction,
  -- so two concurrent calls cannot both slip under the limit. clock_timestamp()
  -- (not now()) is used: now() is the transaction start time, so a request
  -- that waited on the advisory lock would count against a slightly outdated
  -- timestamp. clock_timestamp() is the actual current time.
  select count(*) into v_count
  from public.edge_rate_limits
  where user_id = p_user_id
    and fn = p_fn
    and created_at > clock_timestamp() - make_interval(mins => p_window_minutes);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.edge_rate_limits (user_id, fn, created_at) values (p_user_id, p_fn, clock_timestamp());
  return true;
end;
$$;

-- Only the service role (edge functions) may call it. Revoking from PUBLIC
-- as well: the default PUBLIC grant survives a revoke from anon/authenticated.
revoke all on function public.check_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(uuid, text, integer, integer) to service_role;
