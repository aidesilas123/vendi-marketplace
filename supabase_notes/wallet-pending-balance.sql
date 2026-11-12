-- supabase_notes/wallet-pending-balance.sql
--
-- Wallet two-bucket split: withdrawable (balance) vs pending/held (pending_balance).
--   balance         = withdrawable NOW. Deposits + refunds land here immediately.
--   pending_balance = escrow payouts whose underlying Monnify collection has not
--                     settled yet. NOT withdrawable until due.
-- Existing money stays in balance (already settled, or deposited) — only NEW
-- escrow releases go to pending. No backfill needed.
--
-- How a payout settles: release-escrow credits pending_balance and stamps the
-- credit row with metadata.bucket = 'pending' and metadata.available_at (the
-- Monnify settlement time: bank transfer = same day 22:00 WAT, card = next
-- day). settle_wallet() moves matured pending credits into balance. It runs
-- lazily when the wallet loads (useWallet), so no cron is needed.
--
-- RUN FIRST, in the Supabase SQL editor, before applying the app + function
-- changes that use pending_balance.

alter table public.wallets
  add column if not exists pending_balance numeric not null default 0;

-- Moves matured pending payouts into the withdrawable balance.
-- Only credit rows stamped bucket='pending' are touched, so wallet fundings
-- (which land straight in balance) are never moved twice. Each row is marked
-- settled as it moves, so a second call — or a retry — moves nothing twice.
-- Only the wallet's owner can settle it. Returns the amount moved.
create or replace function public.settle_wallet(p_wallet_id uuid)
returns numeric
language plpgsql
security definer
as $$
declare
  v_owner uuid;
  v_pending numeric;
  v_moved numeric := 0;
  v_row record;
begin
  select user_id, pending_balance into v_owner, v_pending
    from public.wallets where id = p_wallet_id for update;
  if not found then
    return 0;
  end if;
  if v_owner <> auth.uid() then
    return 0;
  end if;

  for v_row in
    select id, amount
    from public.transactions
    where wallet_id = p_wallet_id
      and type = 'credit'
      and status = 'successful'
      and (metadata->>'bucket') = 'pending'
      and (metadata->>'available_at') is not null
      and (metadata->>'available_at')::timestamptz <= now()
      and coalesce((metadata->>'settled')::boolean, false) = false
    order by created_at asc
    for update
  loop
    v_moved := v_moved + v_row.amount;
    update public.transactions
      set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{settled}', 'true'::jsonb)
      where id = v_row.id;
  end loop;

  if v_moved > 0 then
    -- The settled flag above guarantees each credit moves exactly once, and
    -- release-escrow is the only writer to pending_balance, so v_moved can
    -- never exceed it; the greatest() is only a safety net.
    update public.wallets
      set balance = balance + v_moved,
          pending_balance = greatest(pending_balance - v_moved, 0),
          updated_at = now()
      where id = p_wallet_id;
  end if;

  return v_moved;
end;
$$;
