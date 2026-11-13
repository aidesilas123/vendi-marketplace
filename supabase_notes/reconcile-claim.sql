// supabase_notes/reconcile-claim.sql
//
// Prevents the scheduled reconciliation sweep from starving withdrawals
// (review round 11).
//
// Problem: the sweep always selected the oldest 20 pending withdrawals. If
// those 20 all return UNKNOWN from Monnify, they stay pending, so the next
// run selects the same 20 again — withdrawal 21 and every newer one may
// never be checked.
//
// Fix: a `reconcile_checked_at` timestamp, stamped whenever a pending
// withdrawal is checked (including when Monnify returns UNKNOWN), and an
// RPC that claims due withdrawals atomically. The sweep now selects
// withdrawals that are due for another check, prioritizing those never
// checked or checked longest ago. `SKIP LOCKED` prevents overlapping
// scheduled runs from claiming the same rows.
//
// Run once in the SQL editor. Re-runnable.

alter table public.transactions
add column if not exists reconcile_checked_at timestamptz;

create index if not exists idx_withdrawals_reconcile_due
on public.transactions (reconcile_checked_at, created_at)
where type = 'debit'
  and status = 'pending'
  and reference like 'VENDI-%'
  and metadata->>'transaction_kind' = 'withdrawal';

-- Claims up to p_limit pending withdrawals that are due for a check, and
-- stamps them as checked (so the next run moves on to the next batch).
-- A withdrawal is due when it has never been checked, or when it was last
-- checked more than 5 minutes ago (30 seconds for a forced check of one
-- specific reference by its owner). Only withdrawals older than 5 minutes
-- are eligible at all (a fresh pending withdrawal is still being settled
-- by the webhook, not stale). FOR UPDATE SKIP LOCKED means two overlapping
-- runs never claim the same row.
create or replace function public.claim_withdrawals_for_reconciliation(
  p_user_id uuid default null,
  p_reference text default null,
  p_limit integer default 20,
  p_force boolean default false
)
returns table (
  id uuid,
  reference text,
  amount numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'Invalid reconciliation batch size';
  end if;

  -- A forced check is allowed only for one authenticated user's
  -- explicitly requested reference.
  if p_force and (p_user_id is null or p_reference is null) then
    raise exception 'Invalid forced reconciliation request';
  end if;

  if p_reference is not null and p_reference not like 'VENDI-%' then
    raise exception 'Invalid withdrawal reference';
  end if;

  return query
  with candidates as (
    select t.id
    from public.transactions as t
    where t.type = 'debit'
      and t.status = 'pending'
      and t.reference like 'VENDI-%'
      and t.metadata->>'transaction_kind' = 'withdrawal'
      and t.created_at <= clock_timestamp() - interval '5 minutes'
      and (p_user_id is null or t.user_id = p_user_id)
      and (p_reference is null or t.reference = p_reference)
      and (
        (
          p_force
          and (
            t.reconcile_checked_at is null
            or t.reconcile_checked_at <= clock_timestamp() - interval '30 seconds'
          )
        )
        or
        (
          not p_force
          and (
            t.reconcile_checked_at is null
            or t.reconcile_checked_at <= clock_timestamp() - interval '5 minutes'
          )
        )
      )
    order by
      t.reconcile_checked_at asc nulls first,
      t.created_at asc
    limit p_limit
    for update of t skip locked
  ),
  claimed as (
    update public.transactions as t
    set reconcile_checked_at = clock_timestamp()
    from candidates as c
    where t.id = c.id
      and t.status = 'pending'
    returning t.id, t.reference, t.amount, t.created_at
  )
  select
    claimed.id,
    claimed.reference,
    claimed.amount,
    claimed.created_at
  from claimed;
end;
$$;

revoke all on function public.claim_withdrawals_for_reconciliation(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_withdrawals_for_reconciliation(uuid, text, integer, boolean) to service_role;

-- MANUAL REVIEW: withdrawals that stay pending for a long time (for example,
-- more than 24 hours) despite repeated checks are usually the
-- crash-before-dispatch case — the wallet was debited but Monnify never
-- received the transfer, so the summary returns UNKNOWN forever. Do NOT
-- auto-refund them: an UNKNOWN result must never trigger a refund, and a
-- resend is only safe once Monnify confirms the reference was never
-- accepted or guarantees the same reference cannot pay twice. Find them
-- with:
--   select id, user_id, reference, amount, created_at, reconcile_checked_at
--   from public.transactions
--   where type = 'debit' and status = 'pending'
--     and reference like 'VENDI-%'
--     and metadata->>'transaction_kind' = 'withdrawal'
--     and created_at <= now() - interval '24 hours'
--   order by created_at asc;
