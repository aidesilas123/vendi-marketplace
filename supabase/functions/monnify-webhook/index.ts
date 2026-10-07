import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. Native Web Crypto HMAC-SHA512 Helper Function
async function verifyMonnifySignature(secret: string, payload: string, signature: string) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const hashBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload));
  const computedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computedHash === signature;
}

/** Optimistic-lock balance change (same helper as process-withdrawal). */
async function adjustBalance(walletId: string, delta: number) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('balance').eq('id', walletId).single();
    if (error || !w) throw new Error('Wallet not found');

    const { data: updated, error: updateError } = await supabase
      .from('wallets')
      .update({ balance: round2(Number(w.balance) + delta), updated_at: new Date().toISOString() })
      .eq('id', walletId)
      .eq('balance', w.balance)
      .select('id');
    if (updateError) throw new Error('Failed to update balance');
    if (updated && updated.length > 0) return;
    await sleep(40 * (attempt + 1));
  }
  throw new Error('Wallet busy');
}

/** Marks a pending withdrawal failed and returns the money – exactly once. */
async function failAndRefund(reference: string, fromStatuses: string[]) {
  const { data: tx } = await supabase
    .from('transactions')
    .update({ status: 'failed' })
    .eq('reference', reference)
    .in('status', fromStatuses)
    .select('id, wallet_id, amount')
    .maybeSingle();

  if (!tx) {
    console.log('Disbursement failure for', reference, '- nothing to refund (already settled or unknown)');
    return;
  }
  await adjustBalance(tx.wallet_id, Math.abs(Number(tx.amount)));
  console.log('Refunded', Math.abs(Number(tx.amount)), 'for failed withdrawal', reference);
}

const ok = (message: string) =>
  new Response(JSON.stringify({ message }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

Deno.serve(async (req) => {
  try {
    const monnifySignature = req.headers.get('monnify-signature');
    if (!monnifySignature) {
      console.warn('Webhook rejected: missing monnify-signature header');
      return new Response('Unauthorized', { status: 401 });
    }

    const payload = await req.text();
    const monnifySecret = Deno.env.get('MONNIFY_SECRET_KEY')!;

    // 2. Verify using the native crypto helper
    const isValid = await verifyMonnifySignature(monnifySecret, payload, monnifySignature);
    if (!isValid) {
      console.warn('Webhook rejected: invalid signature');
      return new Response('Invalid Signature', { status: 403 });
    }

    const data = JSON.parse(payload);
    const eventType: string = data.eventType;
    const ev = data.eventData ?? {};
    console.log('Monnify webhook received:', eventType, ev.transactionReference ?? ev.reference ?? '');

    /* ----------------------------- Money in ----------------------------- */
    if (eventType === 'SUCCESSFUL_TRANSACTION') {
      const paymentStatus = String(ev.paymentStatus ?? 'PAID').toUpperCase();
      if (paymentStatus !== 'PAID') return ok(`Ignored payment status ${paymentStatus}`);

      // Same amount the original code credited (after Monnify's fee). Change to ev.amountPaid
      // if you want users credited the full amount and Vendi to absorb the fee.
      const amountPaid = Number(ev.settlementAmount ?? ev.amountPaid);
      const accountNumber = ev.destinationAccountInformation?.accountNumber;
      const transactionReference = ev.transactionReference;
      if (!Number.isFinite(amountPaid) || !accountNumber || !transactionReference) {
        throw new Error('Webhook payload is missing amount, account number or reference');
      }

      const source = Array.isArray(ev.paymentSourceInformation) ? ev.paymentSourceInformation[0] : null;

      const { data: result, error } = await supabase.rpc('process_monnify_funding', {
        p_account_number: String(accountNumber),
        p_amount: amountPaid,
        p_reference: String(transactionReference),
        p_metadata: {
          sender_name: source?.accountName ?? null,
          sender_bank_code: source?.bankCode ?? null,
          amount_paid: ev.amountPaid ?? null,
          settlement_amount: ev.settlementAmount ?? null,
          payment_method: ev.paymentMethod ?? null,
          provider: 'monnify',
        },
      });
      if (error) throw error;

      console.log('Funding result:', JSON.stringify(result));
      if (result?.status === 'wallet_not_found') {
        // Not one of our wallets (or a data problem). Answer 200 so Monnify stops retrying,
        // but make it loud in the logs.
        console.error('NO WALLET for account number', accountNumber, 'reference', transactionReference);
      }
      return ok('Funding processed');
    }

    /* ---------------------------- Money out ----------------------------- */
    if (eventType === 'SUCCESSFUL_DISBURSEMENT') {
      await supabase
        .from('transactions')
        .update({ status: 'successful' })
        .eq('reference', ev.reference)
        .eq('status', 'pending');
      return ok('Withdrawal marked successful');
    }

    if (eventType === 'FAILED_DISBURSEMENT') {
      await failAndRefund(String(ev.reference), ['pending']);
      return ok('Withdrawal failed and refunded');
    }

    if (eventType === 'REVERSED_DISBURSEMENT') {
      // A transfer that looked successful can still be reversed by the bank
      await failAndRefund(String(ev.reference), ['pending', 'successful']);
      return ok('Withdrawal reversed and refunded');
    }

    return ok(`Event ${eventType} ignored`);
  } catch (error) {
    console.error('Webhook Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});