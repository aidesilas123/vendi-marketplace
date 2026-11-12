-- supabase_notes/process-monnify-funding.sql
--
-- Wallet top-up credit (called by monnify-webhook on SUCCESSFUL_TRANSACTION).
-- This function was MISSING from the repo — it only existed in the live
-- database. Saved here so it is version-controlled.
--
-- SECURITY FIX (2026-11-12): the original had no caller check and no execute
-- revoke, so any logged-in user could call it directly through the API and
-- credit their own wallet with any amount — free money. Fixed two ways:
--   (a) the function itself refuses any caller that is not the service role
--       (the webhook), and refuses a non-positive amount;
--   (b) execute is revoked from anon/authenticated, so only the service role
--       can call it at all.
--
-- DEDUP (verified from the live definition): the wallet row lock
-- (SELECT ... FOR UPDATE) serialises concurrent webhooks for the same wallet,
-- the reference EXISTS check returns 'duplicate' instead of crediting twice,
-- and the unique index on transactions.reference is a backstop — a duplicate
-- insert would fail and roll the whole credit back. A replay cannot double-credit.
--
-- RUN in the Supabase SQL editor, then redeploy monnify-webhook (the webhook
-- now gates the funding push on the RPC answering 'credited').

create or replace function public.process_monnify_funding(p_account_number text, p_amount numeric, p_reference text, p_metadata jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_wallet public.wallets%rowtype;
begin
  -- Only the service role (monnify-webhook) may credit a wallet. A direct
  -- API call from a logged-in user is refused — otherwise anyone could mint
  -- money in their own wallet.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'process_monnify_funding: service role only';
  end if;

  -- A credit must be a strictly positive amount.
  if p_amount is null or p_amount <= 0 then
    raise exception 'process_monnify_funding: amount must be positive';
  end if;

  -- Lock the wallet row: concurrent webhooks for the same wallet queue up here
  select * into v_wallet
  from public.wallets
  where virtual_account_number = p_account_number
  for update;

  if not found then
    return jsonb_build_object('status', 'wallet_not_found');
  end if;

  -- Already processed this Monnify reference? Do nothing.
  if exists (select 1 from public.transactions where reference = p_reference) then
    return jsonb_build_object('status', 'duplicate', 'wallet_id', v_wallet.id);
  end if;

  update public.wallets
  set balance = balance + p_amount,
      updated_at = now()
  where id = v_wallet.id;

  insert into public.transactions (wallet_id, user_id, type, amount, title, status, reference, metadata)
  values (
    v_wallet.id,
    v_wallet.user_id,
    'credit',
    p_amount,
    'Wallet top-up',
    'successful',
    p_reference,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('account_number', p_account_number)
  );

  return jsonb_build_object('status', 'credited', 'wallet_id', v_wallet.id);
end;
$function$;

-- Belt and braces with the role check above: even if the check is ever
-- removed, no client role can execute this function.
revoke execute on function public.process_monnify_funding(text, numeric, text, jsonb) from anon, authenticated;
