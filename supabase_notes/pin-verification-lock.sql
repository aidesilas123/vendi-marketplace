// supabase_notes/pin-verification-lock.sql
//
// Serializes PIN verification attempts per user (review round 10).
//
// Problem: record_pin_attempt increments failed attempts atomically, but
// manage-pin checks the lockout FIRST and verifies the PIN afterwards.
// Several requests arriving at the same time all read the same unlocked
// state, all verify different PIN guesses, and only afterwards record their
// failures. More than five guesses can be processed concurrently before the
// lockout takes effect.
//
// Fix: a short-lived per-user lock, held across the whole verification
// (lockout check + PIN check + attempt recording). Only one request per
// user can verify a PIN at a time; a second concurrent request gets a 429
// and retries. The lock expires after 2 minutes on its own, so a crashed
// edge function can never leave a user locked out forever.
//
// Run once in the SQL editor. Re-runnable.

create table if not exists public.pin_verification_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);

alter table public.pin_verification_locks enable row level security;

-- No client access at all; only the service role (manage-pin) may use it.
revoke all on public.pin_verification_locks from public, anon, authenticated;
grant all on public.pin_verification_locks to service_role;

-- Try to take the lock for this user. Returns true only when this call
-- actually holds the lock (a fresh insert, or an expired lock it replaced).
-- Returns false when another request currently holds a live lock.
create or replace function public.acquire_pin_verification_lock(
  p_user_id uuid,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if p_user_id is null or p_token is null then
    raise exception 'Invalid lock parameters';
  end if;

  insert into public.pin_verification_locks (user_id, token, expires_at)
  values (p_user_id, p_token, clock_timestamp() + interval '5 minutes')
  on conflict (user_id)
  do update set
    token = excluded.token,
    expires_at = excluded.expires_at
  where public.pin_verification_locks.expires_at <= clock_timestamp()
  returning token into v_token;

  return coalesce(v_token = p_token, false);
end;
$$;

revoke all on function public.acquire_pin_verification_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_pin_verification_lock(uuid, uuid) to service_role;

-- Release a lock, but only the one this caller holds (token must match).
create or replace function public.release_pin_verification_lock(
  p_user_id uuid,
  p_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pin_verification_locks
  where user_id = p_user_id
    and token = p_token;
end;
$$;

revoke all on function public.release_pin_verification_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_pin_verification_lock(uuid, uuid) to service_role;
