-- supabase_notes/pin-lockout.sql
--
-- PIN brute-force lockout state for manage-pin (finding 4).
-- One row per user. Only the service role (edge functions) may touch it;
-- there are deliberately NO client policies, so no logged-in user can read
-- or reset anyone's attempt count.
-- Run once in the SQL editor. Re-runnable.

create table if not exists public.pin_attempts (
  user_id uuid primary key,
  attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.pin_attempts add column if not exists attempts integer not null default 0;
alter table public.pin_attempts add column if not exists locked_until timestamptz;
alter table public.pin_attempts add column if not exists updated_at timestamptz not null default now();

alter table public.pin_attempts enable row level security;

-- No client policies on purpose: with RLS on and no policy, authenticated/anon
-- get nothing; the service role (manage-pin) bypasses RLS and can read/write.
drop policy if exists "pin_attempts_select_own" on public.pin_attempts;
drop policy if exists "pin_attempts_all_own" on public.pin_attempts;
drop policy if exists "pin_attempts_insert_own" on public.pin_attempts;
drop policy if exists "pin_attempts_update_own" on public.pin_attempts;
drop policy if exists "pin_attempts_delete_own" on public.pin_attempts;

-- Atomic failed-attempt recording (review issue 1).
-- The old manage-pin read the count, added one, and upserted it — two
-- simultaneous guesses could read the same count and overwrite each other,
-- letting more than 5 guesses through before the lockout. This single
-- statement increments atomically (the row is locked during the upsert),
-- so concurrent guesses can never lose a count.
-- Lockout rule: 5 consecutive failures locks the PIN for 15 minutes. A
-- failure while already locked keeps the existing lock (it is not extended
-- indefinitely); after the lock expires, the next failure re-locks it.
-- A successful verify clears the row (manage-pin deletes it).
create or replace function public.record_pin_attempt(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_locked_until timestamptz;
begin
  insert into public.pin_attempts (user_id, attempts, locked_until, updated_at)
  values (p_user_id, 1, null, now())
  on conflict (user_id) do update
    set attempts = public.pin_attempts.attempts + 1,
        locked_until = case
          when public.pin_attempts.locked_until is not null
           and public.pin_attempts.locked_until > now()
            then public.pin_attempts.locked_until
          when public.pin_attempts.attempts + 1 >= 5
            then now() + interval '15 minutes'
          else null
        end,
        updated_at = now()
  returning attempts, locked_until into v_attempts, v_locked_until;

  return jsonb_build_object('attempts', v_attempts, 'locked_until', v_locked_until);
end;
$$;

-- Service role only (manage-pin). The PUBLIC default grant is revoked too:
-- revoking from anon/authenticated alone does NOT remove it.
revoke all on function public.record_pin_attempt(uuid) from public, anon, authenticated;
grant execute on function public.record_pin_attempt(uuid) to service_role;
