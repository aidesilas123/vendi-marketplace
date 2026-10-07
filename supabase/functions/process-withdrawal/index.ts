import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';
const MIN_WITHDRAWAL = 100; // keep in sync with MIN_WITHDRAWAL in WithdrawPage.tsx

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Changes a wallet balance safely. The update only applies if the balance is still what we
 * read (optimistic lock), so two requests – or a deposit landing at the same moment – can
 * never overwrite each other. Retries a few times when it loses the race.
 */
async function adjustBalance(walletId: string, delta: number, requireSufficient = false) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('balance').eq('id', walletId).single();
    if (error || !w) throw new Error('Wallet not found');

    const next = round2(Number(w.balance) + delta);
    if (requireSufficient && next < 0) throw new Error('Insufficient verified funds');

    const { data: updated, error: updateError } = await supabase
      .from('wallets')
      .update({ balance: next, updated_at: new Date().toISOString() })
      .eq('id', walletId)
      .eq('balance', w.balance)
      .select('id');
    if (updateError) throw new Error('Failed to update balance');
    if (updated && updated.length > 0) return next;

    await sleep(40 * (attempt + 1));
  }
  throw new Error('Your wallet is busy. Please try again.');
}

/** Asks the existing manage-pin function to verify the PIN, so the check can't be skipped. */
async function verifyPin(authHeader: string, pin: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/manage-pin`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', pin }),
  });
  if (!res.ok) {
    let message = 'Incorrect PIN';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
}

async function monnifyLogin(): Promise<string> {
  const base64Auth = btoa(`${Deno.env.get('MONNIFY_API_KEY')!}:${Deno.env.get('MONNIFY_SECRET_KEY')!}`);
  const res = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${base64Auth}` },
  });
  if (!res.ok) throw new Error('Banking provider is offline. Please try again shortly.');
  return (await res.json()).responseBody.accessToken;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Bookkeeping so the catch block knows whether money has been taken yet
  let walletId: string | null = null;
  let amount = 0;
  let debited = false;
  let transferAttempted = false;
  let reference = '';

  try {
    // 1. Authenticate request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // 2. Validate input
    const body = await req.json();
    amount = round2(Number(body.amount));
    const accountNumber = String(body.accountNumber ?? '').trim();
    const bankCode = String(body.bankCode ?? '').trim();
    const bankName = String(body.bankName ?? '').trim();
    const accountName = String(body.accountName ?? '').trim();
    const pin = String(body.pin ?? '');

    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL) {
      throw new Error(`Minimum withdrawal is ₦${MIN_WITHDRAWAL}`);
    }
    if (!/^\d{10}$/.test(accountNumber)) throw new Error('Enter a valid 10-digit account number');
    if (!bankCode) throw new Error('Select a bank');
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your 4-digit PIN');

    // 3. PIN is verified HERE on the server (previously the app verified it separately,
    //    so anyone with a login token could call this function and skip the PIN)
    await verifyPin(authHeader, pin);

    // 4. Check the real balance on the server
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .single();
    if (walletError || !wallet) throw new Error('Wallet not found');
    walletId = wallet.id;
    if (Number(wallet.balance) < amount) throw new Error('Insufficient verified funds');

    // 5. Log in to Monnify BEFORE touching the balance, so "provider offline" never leaves a debit behind
    const accessToken = await monnifyLogin();

    // 6. Lock funds + create the pending ledger record
    reference = `VENDI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await adjustBalance(wallet.id, -amount, true);
    debited = true;

    const { data: txRow, error: txError } = await supabase
      .from('transactions')
      .insert({
        wallet_id: wallet.id,
        user_id: user.id,
        amount: -amount,
        type: 'debit',
        status: 'pending',
        title: `Withdrawal to ${bankName || 'bank'}`,
        reference,
        metadata: {
          beneficiary_name: accountName || null,
          bank_name: bankName || null,
          bank_code: bankCode,
          account_number: accountNumber,
          fee: 0,
          provider: 'monnify',
        },
      })
      .select()
      .single();

    if (txError || !txRow) {
      await adjustBalance(wallet.id, amount); // nothing was sent: give the money back
      debited = false;
      throw new Error('Failed to create ledger record');
    }

    // 7. Trigger the actual money transfer (disbursement)
    const sourceAccount = Deno.env.get('MONNIFY_WALLET_ACCOUNT_NUMBER')!;
    let transferData: any;
    transferAttempted = true;
    try {
      const transferRes = await fetch(`${MONNIFY_BASE}/api/v2/disbursements/single`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          reference,
          narration: 'Vendi Withdrawal',
          destinationBankCode: bankCode,
          destinationAccountNumber: accountNumber,
          currency: 'NGN',
          sourceAccountNumber: sourceAccount,
        }),
      });
      transferData = await transferRes.json();
    } catch (networkError) {
      // We don't know whether the bank got the instruction. Refunding now could pay the
      // user twice, so we leave it pending; monnify-webhook settles it either way.
      console.error('Disbursement outcome unknown:', reference, networkError);
      return json({
        success: true,
        status: 'pending',
        reference,
        transaction: txRow,
        message: 'Your withdrawal is being processed.',
      });
    }

    const providerStatus = String(transferData?.responseBody?.status ?? '').toUpperCase();
    // PENDING_AUTHORIZATION = Monnify is waiting for an OTP in the dashboard; an API-driven
    // wallet can't complete that, so treat it as a failure and return the money.
    const rejected =
      !transferData?.requestSuccessful ||
      providerStatus === 'FAILED' ||
      providerStatus === 'PENDING_AUTHORIZATION';

    if (rejected) {
      const { data: failed } = await supabase
        .from('transactions')
        .update({ status: 'failed' })
        .eq('reference', reference)
        .eq('status', 'pending')
        .select('id');
      if (failed && failed.length > 0) await adjustBalance(wallet.id, amount);
      debited = false;

      const reason =
        providerStatus === 'PENDING_AUTHORIZATION'
          ? 'Transfers need OTP approval on the provider account. Turn off OTP for API transfers in Monnify, then retry.'
          : transferData?.responseMessage || 'Bank transfer failed. Funds refunded.';
      throw new Error(reason);
    }

    // 8. Accepted. SUCCESS can be final immediately; anything else stays pending until the webhook.
    const finalStatus = providerStatus === 'SUCCESS' ? 'successful' : 'pending';
    const fee = Number(transferData?.responseBody?.totalFee ?? 0);
    const { data: finalTx } = await supabase
      .from('transactions')
      .update({
        status: finalStatus,
        metadata: { ...(txRow.metadata ?? {}), provider_status: providerStatus, provider_fee: fee },
      })
      .eq('id', txRow.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    return json({
      success: true,
      status: finalStatus,
      reference,
      transaction: finalTx ?? { ...txRow, status: finalStatus },
    });
  } catch (error: any) {
    console.error('Withdrawal Error:', error);

    // Only auto-refund if we took the money but never reached the bank
    if (debited && !transferAttempted && walletId) {
      try {
        await adjustBalance(walletId, amount);
        await supabase.from('transactions').update({ status: 'failed' }).eq('reference', reference);
      } catch (refundError) {
        console.error('REFUND FAILED – reconcile manually:', reference, refundError);
      }
    }
    return json({ error: error.message }, 400);
  }
});