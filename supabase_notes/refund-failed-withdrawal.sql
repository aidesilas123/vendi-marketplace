-- supabase_notes/refund-failed-withdrawal.sql
--
-- Atomic failed-withdrawal refund (fixes the non-atomic failAndRefund in
-- monnify-webhook: the old code flipped the transaction to 'failed' first,
-- then refunded the wallet in a separate call, so a crash in between lost
-- the money — and a Monnify retry could not fix it, because the row was
-- already 'failed' and the retry only looks for 'pending' rows).
--
-- This RPC flips the status AND credits the wallet in ONE database
-- transaction, so they either both happen or neither does. Exactly once:
-- the conditional UPDATE claims the row, so a retry (or a concurrent call)
-- finds it already 'failed' and does nothing.
--
-- RUN in the Supabase SQL editor, then redeploy monnify-webhook (the webhook
-- now calls this RPC instead of doing the two writes itself).

create or replace function public.refund_failed_withdrawal(p_reference text, p_from_statuses text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transactions%rowtype;
begin
  -- The reference must be a real one; an empty reference would silently
  -- match nothing and return null, hiding a caller bug. It must also be a
  -- Vendi withdrawal reference (VENDI-<key>): this RPC must never refund a
  -- checkout, fee, or any other kind of transaction, no matter who calls it.
  -- The webhook and the other callers filter by VENDI-% too, but this is the
  -- authoritative enforcement — filtering in the caller alone is not enough.
  if p_reference is null or length(trim(p_reference)) = 0 then
    raise exception 'Reference is required';
  end if;
  if p_reference not like 'VENDI-%' then
    raise exception 'Reference is not a withdrawal';
  end if;

  -- Only 'pending' and 'successful' may ever be refunded. 'pending' is a
  -- transfer that never completed; 'successful' is one the bank reversed
  -- after it completed (REVERSED_DISBURSEMENT — the money came back, so the
  -- user must be credited). 'failed', 'cancelled', 'disputed' and
  -- 'processing' must never be refunded: crediting one of those would pay
  -- the user twice. The caller supplies the list, but the function enforces
  -- the allowlist — a buggy or malicious caller cannot widen it.
  if p_from_statuses is null or array_length(p_from_statuses, 1) is null then
    raise exception 'from_statuses is required';
  end if;
  -- Reject NULL elements: a NULL inside the array makes `s not in (...)`
  -- evaluate to NULL (not true), so the allowlist check below would silently
  -- let it through. A NULL status must never be an accepted input.
  if exists (select 1 from unnest(p_from_statuses) s where s is null) then
    raise exception 'from_statuses must not contain null';
  end if;
  if exists (select 1 from unnest(p_from_statuses) s where s not in ('pending', 'successful')) then
    raise exception 'Only pending or successful withdrawals can be refunded';
  end if;

  -- Claim the withdrawal exactly once: flip to 'failed' only if it is still
  -- in one of the given statuses and is a withdrawal (type 'debit', VENDI-%
  -- reference, AND metadata transaction_kind = 'withdrawal'). The
  -- transaction_kind is an independent marker set at creation: a reference
  -- prefix and debit type alone do not prove a row is a withdrawal, so the
  -- RPC requires all three. Two concurrent calls can only claim it once
  -- (row lock + re-check).
  update public.transactions
     set status = 'failed'
   where reference = p_reference
     and reference like 'VENDI-%'
     and status = any(p_from_statuses)
     and type = 'debit'
     and metadata->>'transaction_kind' = 'withdrawal'
  returning * into v_tx;

  if not found then
    return null;
  end if;

  -- Withdrawals are stored as negative amounts. A zero or positive amount
  -- here means bad data, and crediting abs() of it would pay money that was
  -- never taken. Refuse loudly instead of refunding it.
  if v_tx.amount >= 0 then
    raise exception 'Invalid withdrawal amount for refund';
  end if;

  -- Same transaction as the flip above: a crash can never leave the status
  -- changed without the refund. The refund goes back to the withdrawable
  -- balance (the withdrawal was debited from balance).
  update public.wallets
     set balance = balance + abs(v_tx.amount),
         updated_at = now()
   where id = v_tx.wallet_id;

  if not found then
    raise exception 'refund_failed_withdrawal: wallet % not found for reference %', v_tx.wallet_id, p_reference;
  end if;

  return jsonb_build_object(
    'id', v_tx.id,
    'wallet_id', v_tx.wallet_id,
    'amount', v_tx.amount,
    'reference', v_tx.reference
  );
end;
$$;

-- Only the service role (the webhook / process-withdrawal / reconcile) may
-- call this. A client calling it directly could flip someone's pending
-- withdrawal to 'failed'. Revoking from PUBLIC as well: the default PUBLIC
-- grant survives a revoke from anon/authenticated alone.
revoke all on function public.refund_failed_withdrawal(text, text[]) from public, anon, authenticated;
grant execute on function public.refund_failed_withdrawal(text, text[]) to service_role;

-- ONE-TIME BACKFILL (run once, before deploying the new code): withdrawals
-- created before transaction_kind existed have no marker in metadata, so
-- the strict check above would never match them. Stamp them now.
--
-- CAUTION: do NOT blindly stamp every VENDI-% debit row. A reference prefix
-- alone does not prove a row is a withdrawal — a checkout or fee transaction
-- could match it. INSPECT first:
--   select id, user_id, amount, reference, title, metadata
--   from public.transactions
--   where type = 'debit'
--     and reference like 'VENDI-%'
--     and metadata->>'transaction_kind' is null;
-- Only stamp rows you can positively identify as withdrawals. The update
-- below narrows to rows whose metadata carries withdrawal-specific fields
-- (bank_code + account_number) — a checkout or fee transaction does not
-- have those. If any row in the inspection has neither field, do not stamp
-- it; investigate it first.
update public.transactions
   set metadata = coalesce(metadata, '{}'::jsonb) || '{"transaction_kind": "withdrawal"}'::jsonb
 where type = 'debit'
   and reference like 'VENDI-%'
   and metadata->>'transaction_kind' is null
   and metadata->>'bank_code' is not null
   and metadata->>'account_number' is not null;
