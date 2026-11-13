-- supabase_notes/initiate-withdrawal.sql
--
-- Atomic withdrawal start (findings 1 + 2): debits the wallet AND creates the
-- pending ledger row in ONE database transaction, so a crash between the two
-- can no longer leave money taken with no record.
--
-- Idempotency: the reference doubles as the idempotency key.
-- If a transaction with this reference already exists, the function returns
-- it WITHOUT touching the money again, so a retried submit cannot double-pay.
-- The caller (process-withdrawal) returns a duplicate as-is, whatever its
-- status — one key is one attempt, and a failed attempt is NOT retried
-- automatically (the frontend generates a new key for a new attempt).
--
-- Ownership + amount + fingerprint checks (review issues 5 and 6): a
-- duplicate is only returned when it belongs to the SAME user and wallet,
-- has the SAME amount, AND the SAME request fingerprint (bank code,
-- account number, currency). Without the fingerprint, the same key reused
-- with a different destination would silently return the original
-- transaction — no second transfer, but a misleading response. A mismatched
-- owner, amount or fingerprint is an error, never a silent return.
--
-- Concurrency (review issue 5): the reference is checked BEFORE the wallet
-- lock (fast path) and AGAIN AFTER the lock. Two simultaneous requests with
-- the same reference both pass the first check; the second one waits on the
-- wallet lock, then sees the first one's insert and returns it cleanly
-- instead of failing on the unique constraint.
--
-- Permissions (review issue 4): PostgreSQL grants EXECUTE to PUBLIC by
-- default, and revoking from anon/authenticated alone does NOT remove that
-- grant. So this revokes from PUBLIC as well and grants only to service_role.
--
-- Run once in the SQL editor. Re-runnable.

create or replace function public.initiate_withdrawal(
  p_wallet_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_reference text,
  p_title text,
  p_metadata jsonb default '{}'::jsonb,
  p_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx jsonb;
  v_tx_id uuid;
  v_balance numeric;
  v_owner uuid;
  v_existing_user uuid;
  v_existing_wallet uuid;
  v_existing_amount numeric;
  v_existing_fingerprint text;
  v_existing_type text;
  v_existing_kind text;
  v_daily_total numeric := 0;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  -- Reject PostgreSQL numeric special values (NaN, Infinity) and amounts
  -- with more than two decimal places. These must be enforced in the RPC,
  -- not only in the Edge Function — the RPC is the authoritative check.
  -- p_amount is numeric, so a literal NaN/Infinity would arrive as the
  -- text 'NaN'/'Infinity' cast to numeric; the upper() test catches them.
  if upper(p_amount::text) in ('NAN', 'INFINITY', '-INFINITY') then
    raise exception 'Invalid withdrawal amount';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'Withdrawal amount cannot exceed two decimal places';
  end if;
  -- Maximum withdrawal amounts (Aide's numbers, 2026-11-12): ₦500,000 per
  -- transaction, ₦1,000,000 per day. The RPC is the authoritative
  -- enforcement point; the Edge Function and the frontend must match it.
  if p_amount > 500000 then
    raise exception 'Maximum withdrawal is ₦500,000';
  end if;
  if p_user_id is null then
    raise exception 'User ID is required';
  end if;
  if p_wallet_id is null then
    raise exception 'Wallet ID is required';
  end if;
  if p_reference is null or length(trim(p_reference)) = 0 then
    raise exception 'Reference is required';
  end if;
  -- The reference must be a withdrawal reference (VENDI-<key>). A
  -- non-withdrawal reference must never reach the duplicate lookup.
  if p_reference not like 'VENDI-%' then
    raise exception 'Reference must be a withdrawal reference';
  end if;
  -- The fingerprint is REQUIRED for every new withdrawal. A missing
  -- fingerprint must not let a duplicate slip through unchecked.
  if p_fingerprint is null or length(trim(p_fingerprint)) = 0 then
    raise exception 'Fingerprint is required';
  end if;
  -- The fingerprint stored in metadata must match the fingerprint argument.
  -- Otherwise the function could receive one fingerprint but store another.
  if (p_metadata->>'fingerprint') is distinct from p_fingerprint then
    raise exception 'Metadata fingerprint does not match';
  end if;
  -- The transaction must be marked as a withdrawal before it is created.
  -- Every row this RPC inserts must be eligible for the withdrawal
  -- settlement/refund workflow (the refund RPC and the webhook enforce
  -- transaction_kind = 'withdrawal'); a row without the marker could never
  -- be settled or refunded.
  if p_metadata->>'transaction_kind' is distinct from 'withdrawal' then
    raise exception 'Transaction must be marked as a withdrawal';
  end if;

  -- Fast path: this reference already exists. Only return it when it is
  -- the caller's own WITHDRAWAL (type 'debit', VENDI-% reference,
  -- metadata transaction_kind = 'withdrawal') for the same amount AND the
  -- same request fingerprint. A stored fingerprint is required — a row
  -- without one cannot be verified, so it is an error, not a silent return.
  -- Anything else is an error, never a silent return.
  select to_jsonb(t), t.user_id, t.wallet_id, t.amount, t.metadata->>'fingerprint', t.type, t.metadata->>'transaction_kind'
    into v_tx, v_existing_user, v_existing_wallet, v_existing_amount, v_existing_fingerprint, v_existing_type, v_existing_kind
  from public.transactions t
  where t.reference = p_reference;
  if v_tx is not null then
    if v_existing_type <> 'debit' or v_existing_kind <> 'withdrawal' then
      raise exception 'Reference is not a withdrawal';
    end if;
    if v_existing_user <> p_user_id or v_existing_wallet <> p_wallet_id then
      raise exception 'Reference already used by another withdrawal';
    end if;
    if v_existing_amount <> -p_amount then
      raise exception 'Reference already used with a different amount';
    end if;
    if v_existing_fingerprint is null then
      raise exception 'Existing withdrawal has no fingerprint; cannot verify';
    end if;
    if v_existing_fingerprint <> p_fingerprint then
      raise exception 'Reference already used with different withdrawal details';
    end if;
    return jsonb_build_object('transaction', v_tx, 'duplicate', true);
  end if;

  -- Serialize withdrawals at the USER level, before the wallet lock. The
  -- wallet row lock alone only serializes withdrawals against the SAME
  -- wallet. If a user somehow has multiple wallets, two withdrawals against
  -- different wallet rows could calculate the same daily total concurrently
  -- and both pass, exceeding the daily limit. This advisory lock makes all
  -- withdrawals for one user wait for one another, so the daily-total check
  -- below always sees the current total. Keep the wallet lock too — it
  -- protects the balance itself.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':withdrawal-daily', 0));

  -- Lock the wallet row so concurrent withdrawals serialise on this wallet.
  select balance, user_id into v_balance, v_owner
  from public.wallets
  where id = p_wallet_id
  for update;
  if not found then
    raise exception 'Wallet not found';
  end if;
  if v_owner <> p_user_id then
    raise exception 'Wallet does not belong to caller';
  end if;
  if v_balance < p_amount then
    raise exception 'Insufficient verified funds';
  end if;

  -- Recheck the reference AFTER the lock: a concurrent request may have
  -- inserted it while we were waiting. Same ownership + amount + fingerprint
  -- + withdrawal-type checks.
  v_tx := null;
  select to_jsonb(t), t.user_id, t.wallet_id, t.amount, t.metadata->>'fingerprint', t.type, t.metadata->>'transaction_kind'
    into v_tx, v_existing_user, v_existing_wallet, v_existing_amount, v_existing_fingerprint, v_existing_type, v_existing_kind
  from public.transactions t
  where t.reference = p_reference;
  if v_tx is not null then
    if v_existing_type <> 'debit' or v_existing_kind <> 'withdrawal' then
      raise exception 'Reference is not a withdrawal';
    end if;
    if v_existing_user <> p_user_id or v_existing_wallet <> p_wallet_id then
      raise exception 'Reference already used by another withdrawal';
    end if;
    if v_existing_amount <> -p_amount then
      raise exception 'Reference already used with a different amount';
    end if;
    if v_existing_fingerprint is null then
      raise exception 'Existing withdrawal has no fingerprint; cannot verify';
    end if;
    if v_existing_fingerprint <> p_fingerprint then
      raise exception 'Reference already used with different withdrawal details';
    end if;
    return jsonb_build_object('transaction', v_tx, 'duplicate', true);
  end if;

  -- Daily limit (Nigerian calendar day). Checked AFTER the wallet lock
  -- and AFTER the duplicate recheck, so concurrent withdrawals for the
  -- same wallet are serialized while the daily total is computed — two
  -- simultaneous requests cannot both slip under the cap. Counts pending
  -- + successful withdrawals only (failed/cancelled do not count).
  -- Aide's number (2026-11-12): ₦1,000,000 per day.
  select coalesce(sum(abs(amount)), 0) into v_daily_total
  from public.transactions
  where user_id = p_user_id
    and type = 'debit'
    and status in ('pending', 'successful')
    and metadata->>'transaction_kind' = 'withdrawal'
    and created_at >= date_trunc('day', clock_timestamp() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  if v_daily_total + p_amount > 1000000 then
    raise exception 'Daily withdrawal limit exceeded';
  end if;

  -- Debit + ledger insert in the same transaction: either both happen or neither.
  update public.wallets
  set balance = balance - p_amount,
      updated_at = now()
  where id = p_wallet_id;

  insert into public.transactions (wallet_id, user_id, amount, type, status, title, reference, metadata)
  values (p_wallet_id, p_user_id, -p_amount, 'debit', 'pending', p_title, p_reference, p_metadata)
  returning id into v_tx_id;

  select to_jsonb(t) into v_tx
  from public.transactions t
  where t.id = v_tx_id;

  return jsonb_build_object('transaction', v_tx, 'duplicate', false);
end;
$$;

-- Only the service role (edge functions) may call it. Revoking from PUBLIC
-- as well: the default PUBLIC grant survives a revoke from anon/authenticated.
revoke all on function public.initiate_withdrawal(uuid, uuid, numeric, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.initiate_withdrawal(uuid, uuid, numeric, text, text, jsonb, text) to service_role;
