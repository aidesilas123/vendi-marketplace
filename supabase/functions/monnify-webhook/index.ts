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

/** Marks a pending withdrawal failed and returns the money – exactly once.
 * Returns the refunded transaction, or null when there was nothing to refund
 * (already settled, or an unknown reference). */
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
    return null;
  }
  await adjustBalance(tx.wallet_id, Math.abs(Number(tx.amount)));
  console.log('Refunded', Math.abs(Number(tx.amount)), 'for failed withdrawal', reference);
  return tx;
}

/** Sends a wallet push via send-push (server-to-server). Never throws — a
 * failed push must not fail the webhook: the money is already moved, and
 * Monnify retrying the webhook would not fix a dead token. */
async function sendWalletPush(userId: string, title: string, body: string, data: Record<string, string>) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, type: 'wallet', title, body, route: '/wallet', data }),
    });
    if (!res.ok) {
      console.warn('Wallet push failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    }
  } catch (e) {
    console.warn('Wallet push threw:', e);
  }
}

/** The owner of a wallet, looked up by its Monnify virtual account number. */
async function walletOwnerByAccountNumber(accountNumber: string): Promise<string | null> {
  const { data } = await supabase.from('wallets').select('user_id').eq('virtual_account_number', accountNumber).maybeSingle();
  return data?.user_id ?? null;
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`;

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

      // Monnify checkout payment? Our paymentReference is echoed in the
      // event. If a checkout row exists for it, this is an escrow payment,
      // NOT a wallet top-up — hand it to the reconcile function, which
      // verifies the payment with Monnify and creates the escrow (or
      // refunds). The reconcile is the single writer for checkout escrows,
      // so this webhook never creates one itself. A non-200 from reconcile
      // makes this throw, so Monnify retries the webhook later.
      const checkoutRef = String(ev.paymentReference ?? '');
      let checkoutRow: { id: string; reference: string; status: string; metadata: any } | null = null;
      if (checkoutRef) {
        const { data } = await supabase.from('transactions')
          .select('id, reference, status, metadata')
          .eq('reference', checkoutRef).eq('type', 'debit').maybeSingle();
        checkoutRow = data;
      }
      if (!checkoutRow && ev.transactionReference) {
        // Fallback: match by Monnify's own reference, stored at initialize.
        const { data } = await supabase.from('transactions')
          .select('id, reference, status, metadata')
          .eq('metadata->>monnify_transaction_reference', String(ev.transactionReference))
          .eq('type', 'debit').maybeSingle();
        checkoutRow = data;
      }
      if (checkoutRow) {
        // Fee payment (verification / sponsorship)? Route it to the fee
        // reconcile, not the checkout reconcile — the fulfilment is different
        // (file a verification / sponsor a listing, never an escrow).
        const feeKind = checkoutRow.metadata?.kind;
        const feeFn = feeKind === 'verification' || feeKind === 'sponsorship'
          ? 'monnify-fee-reconcile'
          : 'monnify-checkout-reconcile';
        const reconcileRes = await fetch(`${supabaseUrl}/functions/v1/${feeFn}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentReference: checkoutRow.reference,
            monnifyTransactionReference: ev.transactionReference ?? null,
          }),
        });
        if (!reconcileRes.ok) {
          const text = await reconcileRes.text().catch(() => '');
          throw new Error(`${feeFn} failed (${reconcileRes.status}): ${text.slice(0, 200)}`);
        }
        console.log(`${feeFn} processed for`, checkoutRow.reference);
        return ok(feeKind === 'verification' || feeKind === 'sponsorship' ? 'Fee processed' : 'Checkout processed');
      }

      // Same amount the original code credited (after Monnify's fee). Change to ev.amountPaid
      // if you want users credited the full amount and Vendi to absorb the fee.
      const amountPaid = Number(ev.settlementAmount ?? ev.amountPaid);
      const accountNumber = ev.destinationAccountInformation?.accountNumber;
      const transactionReference = ev.transactionReference;
      if (!Number.isFinite(amountPaid) || !accountNumber || !transactionReference) {
        throw new Error('Webhook payload is missing amount, account number or reference');
      }

      const source = Array.isArray(ev.paymentSourceInformation) ? ev.paymentSourceInformation[0] : null;

      // Did this reference already credit the wallet (a Monnify retry after
      // an earlier attempt that already succeeded)? If so, the RPC dedupes
      // the credit — and we must not send the push a second time.
      const { data: existingCredit } = await supabase.from('transactions')
        .select('id').eq('reference', String(transactionReference)).eq('type', 'credit').maybeSingle();
      const alreadyCredited = !!existingCredit;

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
      } else if (!alreadyCredited) {
        // The money just landed — tell the owner. The webhook is the only
        // place that sees a funding happen; the app never gets a callback,
        // which is why this push never arrived before.
        const ownerId = await walletOwnerByAccountNumber(accountNumber);
        if (ownerId) {
          await sendWalletPush(
            ownerId,
            `${naira(amountPaid)} added to your wallet`,
            `Your bank transfer of ${naira(amountPaid)} has landed in your Vendi wallet.`,
            { amount: String(amountPaid), reference: transactionReference },
          );
        } else {
          console.warn('Funding credited but no wallet owner found for account', accountNumber);
        }
      }
      return ok('Funding processed');
    }

    /* ---------------------------- Money out ----------------------------- */
    if (eventType === 'SUCCESSFUL_DISBURSEMENT') {
      const { data: tx } = await supabase
        .from('transactions')
        .update({ status: 'successful' })
        .eq('reference', ev.reference)
        .eq('status', 'pending')
        .select('id, wallet_id, amount')
        .maybeSingle();
      // A row comes back only the first time this moves pending → successful,
      // so a Monnify retry can't send the push twice.
      if (tx?.wallet_id) {
        const { data: w } = await supabase.from('wallets').select('user_id').eq('id', tx.wallet_id).maybeSingle();
        if (w?.user_id) {
          await sendWalletPush(
            w.user_id,
            `${naira(Math.abs(Number(tx.amount) || 0))} sent to your bank`,
            `Your withdrawal of ${naira(Math.abs(Number(tx.amount) || 0))} is on its way to your bank.`,
            { amount: String(Math.abs(Number(tx.amount) || 0)), reference: String(ev.reference) },
          );
        }
      }
      return ok('Withdrawal marked successful');
    }

    if (eventType === 'FAILED_DISBURSEMENT') {
      const tx = await failAndRefund(String(ev.reference), ['pending']);
      if (tx) {
        const { data: w } = await supabase.from('wallets').select('user_id').eq('id', tx.wallet_id).maybeSingle();
        if (w?.user_id) {
          await sendWalletPush(
            w.user_id,
            'Withdrawal failed — money returned',
            `Your withdrawal of ${naira(Math.abs(Number(tx.amount) || 0))} could not be completed. The money has been returned to your wallet.`,
            { amount: String(Math.abs(Number(tx.amount) || 0)), reference: String(ev.reference) },
          );
        }
      }
      return ok('Withdrawal failed and refunded');
    }

    if (eventType === 'REVERSED_DISBURSEMENT') {
      // A transfer that looked successful can still be reversed by the bank
      const tx = await failAndRefund(String(ev.reference), ['pending', 'successful']);
      if (tx) {
        const { data: w } = await supabase.from('wallets').select('user_id').eq('id', tx.wallet_id).maybeSingle();
        if (w?.user_id) {
          await sendWalletPush(
            w.user_id,
            'Withdrawal reversed — money returned',
            `Your withdrawal of ${naira(Math.abs(Number(tx.amount) || 0))} was reversed by the bank. The money has been returned to your wallet.`,
            { amount: String(Math.abs(Number(tx.amount) || 0)), reference: String(ev.reference) },
          );
        }
      }
      return ok('Withdrawal reversed and refunded');
    }

    return ok(`Event ${eventType} ignored`);
  } catch (error) {
    console.error('Webhook Error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});