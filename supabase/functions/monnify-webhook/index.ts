import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';

// Monnify login + single-transfer status lookup. Used ONLY to independently
// confirm a reversal before refunding a 'successful' withdrawal (see
// REVERSED_DISBURSEMENT below). Endpoint confirmed in Monnify's own docs
// and Go wrapper: GET /api/v2/disbursements/single/summary?reference=...
async function monnifyLogin(): Promise<string> {
  const base64Auth = btoa(`${Deno.env.get('MONNIFY_API_KEY')!}:${Deno.env.get('MONNIFY_SECRET_KEY')!}`);
  const res = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${base64Auth}` },
    signal: AbortSignal.timeout(15000),
  });
  // HTTP success does not guarantee successful authentication. Validate the
  // response body: requestSuccessful must be true and the access token must
  // be a non-empty string.
  const data = await res.json().catch(() => null);
  if (
    !res.ok ||
    data?.requestSuccessful !== true ||
    typeof data?.responseBody?.accessToken !== 'string' ||
    !data.responseBody.accessToken
  ) {
    throw new Error('Banking provider authentication failed.');
  }
  return data.responseBody.accessToken;
}

/** Asks Monnify for the current status of one disbursement reference. */
async function queryDisbursementStatus(accessToken: string, reference: string): Promise<string> {
  try {
    const res = await fetch(
      `${MONNIFY_BASE}/api/v2/disbursements/single/summary?reference=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) },
    );
    const data = await res.json().catch(() => null);
    // Monnify explicitly identifies D02 as "Transaction does not exist.
    // Treat as Failed." This is different from a network error or an
    // unrecognised response: the provider is positively saying it has no
    // record of this reference. Only the exact D02 code takes this path.
    if (String(data?.responseCode ?? '').toUpperCase() === 'D02') {
      return 'NOT_FOUND';
    }
    // Exact check: only requestSuccessful === true counts as a confirmed
    // answer. A falsy-but-not-false value, or a malformed body, is UNKNOWN.
    if (!res.ok || data?.requestSuccessful !== true) return 'UNKNOWN';
    return String(data?.responseBody?.status ?? '').toUpperCase() || 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

// 1. Native Web Crypto HMAC-SHA512 Helper Function
async function verifyMonnifySignature(secret: string, payload: string, signature: string) {
  // Strictly validate the signature format first: Monnify's HMAC-SHA512 is
  // exactly 128 hexadecimal characters. Anything else is rejected before
  // any comparison — a malformed signature must never pass.
  const normalized = signature.trim().toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(normalized)) {
    return false;
  }
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
  // Constant-time comparison: ordinary === returns false on the first
  // differing character, leaking timing information about the HMAC.
  return constantTimeEqual(computedHash, normalized);
}

/** Constant-time string comparison (for HMACs and hashes). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Marks a pending withdrawal failed and returns the money – atomically.
 * The refund_failed_withdrawal RPC flips the status AND credits the wallet
 * in one database transaction, so a crash can never leave the money
 * unrefunded. Returns the refunded transaction, or null when there was
 * nothing to refund (already settled, or an unknown reference). */
async function failAndRefund(reference: string, fromStatuses: string[]) {
  const { data, error } = await supabase.rpc('refund_failed_withdrawal', {
    p_reference: reference,
    p_from_statuses: fromStatuses,
  });
  if (error) throw error;
  if (!data) {
    console.log('Disbursement failure for', reference, '- nothing to refund (already settled or unknown)');
    return null;
  }
  const tx = data as { id: string; wallet_id: string; amount: number; reference: string };
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
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn('Wallet push failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    }
  } catch (e) {
    console.warn('Wallet push threw:', e);
  }
}

/** The owner of a wallet, looked up by its Monnify virtual account number.
 * A database error returns null (and is logged) — this lookup is only for
 * notifications, so a failed lookup must not undo or interfere with a
 * successful wallet credit. */
async function walletOwnerByAccountNumber(accountNumber: string): Promise<string | null> {
  const { data, error } = await supabase.from('wallets').select('user_id').eq('virtual_account_number', accountNumber).maybeSingle();
  if (error) {
    console.error('Wallet owner lookup failed:', error);
    return null;
  }
  return data?.user_id ?? null;
}

/** Reads the request body as bytes, enforcing a 1 MB size limit. The exact
 * raw bytes are preserved for HMAC verification — the body must never be
 * parsed and reconstructed before the signature is checked. */
const MAX_WEBHOOK_BYTES = 1024 * 1024; // 1 MB
async function readBodyLimited(req: Request): Promise<Uint8Array> {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_WEBHOOK_BYTES) {
    throw new Error('Webhook body too large');
  }
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        throw new Error('Webhook body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`;

const ok = (message: string) =>
  new Response(JSON.stringify({ message }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

Deno.serve(async (req) => {
  try {
    // Only POST is accepted. Any other method is rejected before reading
    // the body.
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    const monnifySignature = req.headers.get('monnify-signature');
    const rawBodyBytes = await readBodyLimited(req);
    const payload = new TextDecoder().decode(rawBodyBytes);

    // Monnify sends the monnify-signature header in production webhooks
    // but NOT in sandbox webhooks (Monnify's own docs confirm this). So a
    // blanket rejection of unsigned requests blocks all sandbox webhook
    // testing. Unsigned requests are accepted ONLY when ALL THREE hold:
    // the function is pointed at the sandbox base URL, the deployment is
    // explicitly marked as a sandbox deployment (APP_ENV=sandbox), AND the
    // explicit ALLOW_UNSIGNED_SANDBOX_WEBHOOKS=true flag is set. The
    // APP_ENV gate matters because MONNIFY_BASE defaults to the sandbox
    // URL — a deployment that forgot to set MONNIFY_BASE_URL would still
    // look like "sandbox" by base URL alone. Set APP_ENV=sandbox only in
    // a separate sandbox deployment with a separate Supabase project.
    // Production must never have the unsigned-webhook flag enabled — in
    // production, a missing signature is always a 401.
    const isSandbox = MONNIFY_BASE.replace(/\/+$/, '') === 'https://sandbox.monnify.com';
    const isSandboxDeployment = Deno.env.get('APP_ENV') === 'sandbox';
    const allowUnsignedSandbox =
      isSandbox &&
      isSandboxDeployment &&
      Deno.env.get('ALLOW_UNSIGNED_SANDBOX_WEBHOOKS') === 'true';
    if (!monnifySignature) {
      if (!allowUnsignedSandbox) {
        console.warn('Webhook rejected: missing monnify-signature header');
        return new Response('Unauthorized', { status: 401 });
      }
      console.warn('Unsigned sandbox webhook accepted for testing');
    } else {
      // Fail closed if the secret is missing: signature verification must
      // never proceed with an unset secret (the HMAC key would be the
      // literal string "undefined", and any signature computed with it
      // would verify).
      const monnifySecret = Deno.env.get('MONNIFY_SECRET_KEY');
      if (!monnifySecret) {
        console.error('MONNIFY_SECRET_KEY is not configured');
        return new Response('Webhook configuration error', { status: 500 });
      }

      // 2. Verify using the native crypto helper
      const isValid = await verifyMonnifySignature(monnifySecret, payload, monnifySignature);
      if (!isValid) {
        console.warn('Webhook rejected: invalid signature');
        return new Response('Invalid Signature', { status: 403 });
      }
    }

    const data = JSON.parse(payload);
    const eventType: string = data.eventType;
    const ev = data.eventData ?? {};
    console.log('Monnify webhook received:', eventType, ev.transactionReference ?? ev.reference ?? '');

    /* ----------------------------- Money in ----------------------------- */
    if (eventType === 'SUCCESSFUL_TRANSACTION') {
      // A missing payment status must never be treated as a successful
      // payment. Even though the event is HMAC-authenticated, missing
      // payment information is not successful payment information — only
      // an explicit PAID credits a wallet.
      const paymentStatus = String(ev.paymentStatus ?? '').trim().toUpperCase();
      if (paymentStatus !== 'PAID') return ok(`Ignored payment status ${paymentStatus || 'MISSING'}`);

      // Monnify checkout payment? Our paymentReference is echoed in the
      // event. If a checkout row exists for it, this is an escrow payment,
      // NOT a wallet top-up — hand it to the reconcile function, which
      // verifies the payment with Monnify and creates the escrow (or
      // refunds). The reconcile is the single writer for checkout escrows,
      // so this webhook never creates one itself. A non-200 from reconcile
      // makes this throw, so Monnify retries the webhook later.
      //
      // CRITICAL: both lookups MUST check their database errors. If a
      // lookup fails, the row is unknown — not absent. Falling through to
      // wallet funding on a lookup error would credit a wallet for what
      // might be a checkout payment. A failed lookup throws so Monnify
      // retries; only a successful lookup with no matching row proceeds
      // to wallet funding.
      const checkoutRef = String(ev.paymentReference ?? '');
      let checkoutRow: { id: string; reference: string; status: string; metadata: any } | null = null;
      if (checkoutRef) {
        const { data, error: checkoutLookupError } = await supabase.from('transactions')
          .select('id, reference, status, metadata')
          .eq('reference', checkoutRef).eq('type', 'debit').maybeSingle();
        if (checkoutLookupError) {
          console.error('Checkout lookup failed:', checkoutLookupError);
          throw new Error('Checkout lookup failed');
        }
        checkoutRow = data;
      }
      if (!checkoutRow && ev.transactionReference) {
        // Fallback: match by Monnify's own reference, stored at initialize.
        const { data, error: fallbackLookupError } = await supabase.from('transactions')
          .select('id, reference, status, metadata')
          .eq('metadata->>monnify_transaction_reference', String(ev.transactionReference))
          .eq('type', 'debit').maybeSingle();
        if (fallbackLookupError) {
          console.error('Checkout fallback lookup failed:', fallbackLookupError);
          throw new Error('Checkout lookup failed');
        }
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
      // A successful payment must have a strictly positive amount. Monnify
      // only ever sends a positive amount for a PAID event; anything else
      // is a bad or forged payload, so refuse it rather than credit it.
      if (amountPaid <= 0) {
        throw new Error('Webhook: non-positive payment amount');
      }
      // Monnify settles this account in NGN only. Check the currency when
      // the event carries it (older events may not); a different currency
      // is refused rather than credited as naira.
      const currencyCode = String(ev.currencyCode ?? ev.currency ?? '').toUpperCase();
      if (currencyCode && currencyCode !== 'NGN') {
        throw new Error(`Webhook: unexpected currency ${currencyCode}`);
      }

      const source = Array.isArray(ev.paymentSourceInformation) ? ev.paymentSourceInformation[0] : null;

      // The RPC itself dedupes the credit (wallet row lock + reference check
      // + unique index), and it tells us whether this call was the one that
      // actually credited — that answer, not a pre-check, decides the push.
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
      } else if (result?.status === 'credited') {
        // The money just landed — tell the owner. The webhook is the only
        // place that sees a funding happen; the app never gets a callback,
        // which is why this push never arrived before. Gating on the RPC's
        // own answer means two simultaneous webhooks can't both send the
        // push: only the call that actually credited gets 'credited'; the
        // other gets 'duplicate' and stays quiet.
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
      // The event type alone is not enough: Monnify's payload carries the
      // disbursement status inside eventData.status (SUCCESSFUL_DISBURSEMENT
      // carries "SUCCESS"; COMPLETED is also a success per Monnify's status
      // reference). Enforce that it agrees with the event type before
      // marking anything successful. A mismatched event (type says success,
      // status says otherwise, or status missing) is ignored loudly;
      // reconciliation queries Monnify and settles the row correctly.
      const eventStatus = String(ev.status ?? '').trim().toUpperCase();
      if (!['SUCCESS', 'COMPLETED'].includes(eventStatus)) {
        console.error('SUCCESSFUL_DISBURSEMENT with unexpected eventData.status:', eventStatus || '(missing)', 'for', ev.reference, '— ignored');
        return ok('Disbursement status does not match event — ignored');
      }
      // Only a Vendi withdrawal (type 'debit', VENDI-% reference, AND
      // metadata transaction_kind = 'withdrawal') may be marked successful
      // by a disbursement event — never a checkout, fee, or any other kind
      // of debit row. The transaction_kind is an independent marker set at
      // creation; a reference prefix and debit type alone do not prove a
      // row is a withdrawal. Check the database error: if the update fails,
      // throw so Monnify retries the webhook instead of returning 200 and
      // letting the row stay pending.
      const { data: tx, error } = await supabase
        .from('transactions')
        .update({ status: 'successful' })
        .eq('reference', ev.reference)
        .like('reference', 'VENDI-%')
        .eq('type', 'debit')
        .eq('metadata->>transaction_kind', 'withdrawal')
        .eq('status', 'pending')
        .select('id, wallet_id, amount')
        .maybeSingle();
      if (error) throw error;
      // Log when no row changed: the reference may be unknown, not a
      // withdrawal, or already settled/refunded. That is worth
      // investigating — a Monnify event that matches nothing should not
      // pass silently.
      if (!tx) {
        console.warn('SUCCESSFUL_DISBURSEMENT matched no pending withdrawal:', ev.reference);
      }
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
      // Enforce the eventData status too: a FAILED_DISBURSEMENT must carry
      // status FAILED. A mismatched event is ignored loudly; reconciliation
      // queries Monnify and settles the row correctly.
      const eventStatus = String(ev.status ?? '').trim().toUpperCase();
      if (eventStatus !== 'FAILED') {
        console.error('FAILED_DISBURSEMENT with unexpected eventData.status:', eventStatus || '(missing)', 'for', ev.reference, '— ignored');
        return ok('Disbursement status does not match event — ignored');
      }
      // Only a Vendi withdrawal reference is refunded here. A disbursement
      // event for any other reference is ignored — the refund RPC also
      // enforces VENDI-%, but the webhook must not even attempt it.
      if (!String(ev.reference ?? '').startsWith('VENDI-')) {
        console.warn('FAILED_DISBURSEMENT for non-withdrawal reference, ignored:', ev.reference);
        return ok('Not a withdrawal — ignored');
      }
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
      // Enforce the eventData status too: a REVERSED_DISBURSEMENT must
      // carry status REVERSED (Monnify's event docs show exactly that).
      // A mismatched event is ignored loudly; the summary confirmation
      // below is the second check, and reconciliation is the backstop.
      const eventStatus = String(ev.status ?? '').trim().toUpperCase();
      if (eventStatus !== 'REVERSED') {
        console.error('REVERSED_DISBURSEMENT with unexpected eventData.status:', eventStatus || '(missing)', 'for', ev.reference, '— ignored');
        return ok('Disbursement status does not match event — ignored');
      }
      // Only a Vendi withdrawal reference is refunded here (see the
      // FAILED_DISBURSEMENT guard above). The refund RPC enforces VENDI-%
      // too, but the webhook must not even attempt a non-withdrawal one.
      if (!String(ev.reference ?? '').startsWith('VENDI-')) {
        console.warn('REVERSED_DISBURSEMENT for non-withdrawal reference, ignored:', ev.reference);
        return ok('Not a withdrawal — ignored');
      }
      // A transfer that looked successful can still be reversed by the bank.
      // But a 'successful' row must only be refunded after Monnify CONFIRMS
      // the reversal. The webhook event alone — even HMAC-verified — is not
      // enough. Monnify's event documentation shows REVERSED_DISBURSEMENT
      // with a REVERSED status, so the summary must say REVERSED. A SUCCESS
      // or COMPLETED status means the transfer is still successful — do not
      // refund. Any other status (PENDING, IN_PROGRESS, an authorization
      // state, or UNKNOWN) is not a confirmed reversal: throw so Monnify
      // retries the webhook later; reconciliation will also query Monnify
      // and settle it when the outcome is terminal.
      const token = await monnifyLogin();
      const providerStatus = await queryDisbursementStatus(token, String(ev.reference));
      if (['SUCCESS', 'COMPLETED'].includes(providerStatus)) {
        // Monnify says the transfer is still successful — it was NOT
        // reversed. Do not refund; log it loudly so it can be investigated.
        console.error('Reversal event conflicts with successful provider status:', ev.reference, providerStatus);
        return ok('Reversal not confirmed — not refunded');
      }
      if (providerStatus !== 'REVERSED') {
        // Not a confirmed reversal. Throw so Monnify retries the
        // webhook later; reconciliation will also query Monnify and settle
        // it when the outcome is terminal. Never refund on an uncertain
        // status — a stuck refund is recoverable, a double payment is not.
        throw new Error(
          `Reversal not confirmed. Provider status: ${providerStatus} for ${ev.reference}`,
        );
      }
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