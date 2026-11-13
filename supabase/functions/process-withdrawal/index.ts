// supabase/functions/process-withdrawal/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';
const MIN_WITHDRAWAL = 100; // keep in sync with MIN_WITHDRAWAL in WithdrawPage.tsx
const MAX_WITHDRAWAL = 500000; // Aide's number (2026-11-12); keep in sync with the RPC (initiate-withdrawal.sql) and WithdrawPage.tsx

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Asks the existing manage-pin function to verify the PIN, so the check can't be skipped. */
async function verifyPin(authHeader: string, pin: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/manage-pin`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', pin }),
    signal: AbortSignal.timeout(15000),
  });
  // Reject on a non-2xx AND on a 200 that still carries an error (never trust
  // the status alone for a money decision): a wrong PIN must never pass.
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error || body?.isValid !== true) {
    throw new Error(body?.error || 'Incorrect PIN');
  }
}

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

/** Asks Monnify for the current status of one disbursement reference.
 * Used to independently confirm a FAILED disburse response before refunding. */
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
    // record of this reference, so the transfer was never registered and
    // a refund cannot double-pay. Only the exact D02 code takes this path.
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

/**
 * Verifies the beneficiary name against Monnify's live account lookup.
 * Returns the real account name, or null when Monnify cannot be reached.
 * A lookup failure BLOCKS the withdrawal (fail closed): money must not go
 * to an account nobody confirmed. A name MISMATCH also blocks it: the
 * money follows the account number, so a mismatch means the number is wrong.
 */
async function resolveAccountName(
  accessToken: string,
  accountNumber: string,
  bankCode: string,
): Promise<string | null> {
  try {
    const url =
      `${MONNIFY_BASE}/api/v2/disbursements/account/validate` +
      `?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => null);
    // Exact check: only requestSuccessful === true with a non-empty string
    // accountName counts as a verified name. A truthy-but-malformed value
    // must not be treated as verification.
    if (
      !res.ok ||
      data?.requestSuccessful !== true ||
      typeof data?.responseBody?.accountName !== 'string' ||
      !data.responseBody.accountName.trim()
    ) return null;
    return String(data.responseBody.accountName).trim();
  } catch {
    return null;
  }
}

/**
 * Request fingerprint: binds the idempotency key to the FULL withdrawal
 * request (user, amount, bank code, account number, currency). If the same
 * key is reused with different details, the RPC rejects it as a conflict
 * instead of silently returning the original transaction.
 */
async function requestFingerprint(args: {
  userId: string;
  amount: number;
  bankCode: string;
  accountNumber: string;
}): Promise<string> {
  const raw = [args.userId, String(args.amount), args.bankCode, args.accountNumber, 'NGN'].join('|');
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Debits the wallet and creates the pending ledger row in ONE database
 * transaction (initiate_withdrawal RPC). If a row with this reference already
 * exists, the RPC returns it without touching the money again — that is the
 * idempotency guarantee for a retried submit.
 */
async function initiateWithdrawal(args: {
  walletId: string;
  userId: string;
  amount: number;
  reference: string;
  title: string;
  metadata: Record<string, unknown>;
  fingerprint: string;
}): Promise<{ transaction: any; duplicate: boolean }> {
  const { data, error } = await supabase.rpc('initiate_withdrawal', {
    p_wallet_id: args.walletId,
    p_user_id: args.userId,
    p_amount: args.amount,
    p_reference: args.reference,
    p_title: args.title,
    p_metadata: args.metadata,
    p_fingerprint: args.fingerprint,
  });
  if (error || !data) throw new Error(error?.message || 'Failed to create withdrawal');
  return data as { transaction: any; duplicate: boolean };
}

/**
 * Atomically refunds a pending withdrawal: marks it failed AND credits the
 * wallet back in one transaction, so a crash can no longer lose the refund.
 * Returns the refunded row, or null when the row was already settled.
 */
async function refundWithdrawal(reference: string) {
  const { data, error } = await supabase.rpc('refund_failed_withdrawal', {
    p_reference: reference,
    p_from_statuses: ['pending'],
  });
  if (error) throw new Error('Failed to refund withdrawal');
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Only POST is accepted.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Bookkeeping so the catch block knows whether money has been taken yet
  let walletId: string | null = null;
  let amount = 0;
  let debited = false;
  let transferAttempted = false;
  let reference = '';

  try {
    // 1. Authenticate request — auth failures are 401, not 400.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: 'Unauthorized access' }, 401);

    // 2. Validate input — amounts are never silently rounded. A request for
    //    ₦100.999 must be rejected, not quietly changed to ₦101.00.
    //    Validate the DECIMAL STRING first: Number('1e3') is 1000 and
    //    Number('NaN') is NaN, so converting first would accept exponent
    //    notation and other non-decimal forms. Only a plain decimal with
    //    at most two places passes.
    const body = await req.json();
    const amountString = String(body.amount ?? '').trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amountString)) {
      throw new Error('Enter a valid amount');
    }
    const rawAmount = Number(amountString);
    if (!Number.isFinite(rawAmount)) throw new Error('Enter a valid amount');
    if (Math.abs(rawAmount * 100 - Math.round(rawAmount * 100)) > 1e-6) {
      throw new Error('Amount must have at most 2 decimal places');
    }
    amount = round2(rawAmount);
    const accountNumber = String(body.accountNumber ?? '').trim();
    const bankCode = String(body.bankCode ?? '').trim();
    const bankName = String(body.bankName ?? '').trim();
    const accountName = String(body.accountName ?? '').trim();
    const pin = String(body.pin ?? '');
    const idempotencyKey = String(body.idempotencyKey ?? '').trim();

    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL) {
      throw new Error(`Minimum withdrawal is ₦${MIN_WITHDRAWAL}`);
    }
    if (amount > MAX_WITHDRAWAL) {
      throw new Error(`Maximum withdrawal is ₦${MAX_WITHDRAWAL.toLocaleString()}`);
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
      .select('id, balance')
      .eq('user_id', user.id)
      .single();
    if (walletError || !wallet) throw new Error('Wallet not found');
    walletId = wallet.id;
    if (Number(wallet.balance) < amount) throw new Error('Insufficient verified funds');

    // 5. Log in to Monnify BEFORE touching the balance, so "provider offline" never leaves a debit behind
    const accessToken = await monnifyLogin();

    // 6. Re-verify the beneficiary name on the server. The app already checked it,
    //    but a direct API call could send any name; the money follows the account
    //    number, so a mismatch means the number is wrong. The lookup must
    //    SUCCEED: if Monnify cannot verify the account, the withdrawal is
    //    blocked rather than sent to an unverified destination. (Fail closed
    //    on account verification — a lookup outage is a retry-later error,
    //    not a reason to send money to an account nobody confirmed.)
    const resolvedName = await resolveAccountName(accessToken, accountNumber, bankCode);
    if (!resolvedName) {
      throw new Error('Could not verify this bank account. Check the details and try again.');
    }
    if (accountName && resolvedName.toLowerCase() !== accountName.toLowerCase()) {
      throw new Error('Account name does not match this account number. Check the details and try again.');
    }
    const beneficiaryName = resolvedName;
    const beneficiaryNameVerified = true;

    // 7. Lock funds + create the pending ledger record, atomically.
    //    The idempotency key is REQUIRED: without it, a retried submit would
    //    get a fresh random reference and take the money twice. The key is
    //    one per withdrawal attempt, bound to this user by the RPC's
    //    ownership check, and capped at 64 characters.
    const cleanKey = String(idempotencyKey ?? '').trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(cleanKey)) {
      throw new Error('A valid idempotency key is required');
    }
    const newReference = () => `VENDI-${cleanKey}`;
    reference = newReference();

    const fingerprint = await requestFingerprint({
      userId: user.id,
      amount,
      bankCode,
      accountNumber,
    });
    const metadata = {
      transaction_kind: 'withdrawal', // independent marker: refund and
      // settlement paths enforce this, so a checkout/fee debit can never be
      // mistaken for a withdrawal even if its reference or type matched.
      beneficiary_name: beneficiaryName, // Monnify-verified
      beneficiary_name_verified: beneficiaryNameVerified,
      bank_name: bankName || null,
      bank_code: bankCode,
      account_number: accountNumber,
      fee: 0,
      provider: 'monnify',
      idempotency_key: cleanKey || null,
      fingerprint,
    };

    // The Monnify source account must be configured BEFORE the wallet is
    // debited. A missing MONNIFY_WALLET_ACCOUNT_NUMBER must not create a
    // pending withdrawal that can never be sent.
    const sourceAccount = Deno.env.get('MONNIFY_WALLET_ACCOUNT_NUMBER')?.trim();
    if (!sourceAccount) {
      throw new Error('Withdrawal service is not configured');
    }

    let init = await initiateWithdrawal({
      walletId: wallet.id,
      userId: user.id,
      amount,
      reference,
      title: `Withdrawal to ${bankName || 'bank'}`,
      metadata,
      fingerprint,
    });

    // One idempotency key = one withdrawal attempt. If a previous attempt with
    // this key already exists — pending, successful, failed or cancelled — it
    // is returned as-is and NO new withdrawal is created. A failed attempt is
    // NOT retried automatically with a fresh reference: that would let the
    // same key spawn unlimited withdrawals (each retry = another debit).
    // When the user deliberately starts a NEW withdrawal after a failure, the
    // frontend generates a completely new idempotency key (see WithdrawPage).
    // The response uses the ORIGINAL transaction's actual status: a duplicate
    // of a failed withdrawal is a 409, not a success — the frontend must
    // never be told a failed withdrawal succeeded just because the same key
    // was submitted again.
    if (init.duplicate) {
      const dupStatus = String(init.transaction?.status ?? '');
      if (dupStatus === 'failed' || dupStatus === 'cancelled') {
        return json({
          success: false,
          duplicate: true,
          status: dupStatus,
          reference,
          transaction: init.transaction,
        }, 409);
      }
      return json({
        success: true,
        duplicate: true,
        status: dupStatus,
        reference,
        transaction: init.transaction,
      });
    }

    const txRow = init.transaction;
    debited = true;

    // 8. Trigger the actual money transfer (disbursement). The source
    // account was validated before the debit (above); it is not re-read here.
    let transferData: any;
    let transferOk = false;
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
          // Monnify's docs instruct merchants to pass the verified
          // beneficiary name. This is the Monnify-verified name (from the
          // account lookup), not the client-supplied one.
          destinationAccountName: beneficiaryName,
          currency: 'NGN',
          sourceAccountNumber: sourceAccount,
        }),
        signal: AbortSignal.timeout(30000),
      });
      transferOk = transferRes.ok;
      transferData = await transferRes.json().catch(() => null);
    } catch (networkError) {
      // We don't know whether the bank got the instruction. Refunding now could pay the
      // user twice, so we leave it pending; monnify-webhook settles it either way,
      // and reconcile-withdrawals re-checks it against Monnify.
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
    const requestSuccessful = transferData?.requestSuccessful === true;
    // Terminal failure statuses (Monnify's status reference): FAILED,
    // REVERSED (the bank returned the money), and EXPIRED (a batch
    // transaction whose validity period elapsed without authorization).
    // COMPLETED is a success, like SUCCESS. AWAITING_PROCESSING and
    // IN_PROGRESS are still processing — never a failure.
    const terminalFailureStatuses = new Set(['FAILED', 'REVERSED', 'EXPIRED']);
    // Never trust the status without a confirmed API operation. An HTTP 200
    // can still carry requestSuccessful: false with a FAILED status — the
    // provider has not confirmed the operation, so the status is unverified
    // and must not drive a refund or a success. A non-2xx response is
    // likewise ambiguous unless the body carries a definitive terminal
    // status (FAILED, REVERSED or EXPIRED) with requestSuccessful true.
    // Leave it pending; reconciliation queries Monnify and settles it.
    if (!requestSuccessful || (!transferOk && !terminalFailureStatuses.has(providerStatus))) {
      console.error('Disbursement response unverified:', reference, 'HTTP:', transferOk, 'requestSuccessful:', transferData?.requestSuccessful, 'status:', providerStatus || '(none)');
      return json({
        success: true,
        status: 'pending',
        reference,
        transaction: txRow,
        message: 'Your withdrawal is being processed.',
      });
    }
    const definitiveFailure = terminalFailureStatuses.has(providerStatus);
    if (definitiveFailure) {
      // Independently confirm the failure with Monnify's summary endpoint
      // before refunding. The disburse response alone — even with
      // requestSuccessful true — is one report; the summary is a second,
      // independent read of the transfer's actual state. The summary must
      // agree with the disburse response's exact status, not just say
      // FAILED. If it does not match, leave the withdrawal pending for
      // reconciliation.
      const confirmedStatus = await queryDisbursementStatus(accessToken, reference);
      if (confirmedStatus !== providerStatus) {
        console.error('Transfer failure not independently confirmed:', reference, providerStatus, confirmedStatus);
        return json({
          success: true,
          status: 'pending',
          reference,
          transaction: txRow,
          message: 'Your withdrawal is being processed.',
        });
      }
    }

    if (definitiveFailure) {
      // Check the refund result: the RPC returns null when the row was
      // already settled by a concurrent webhook, and it can throw. A
      // CONFIRMED refund returns a structured response — it must not throw
      // into the catch block and come back as a 500, even though the refund
      // succeeded. The frontend uses `status` and `refunded`, not the HTTP
      // code, to decide what happened.
      let refundedTx = null;
      try {
        refundedTx = await refundWithdrawal(reference);
      } catch (refundError) {
        console.error('REFUND FAILED – reconcile manually:', reference, refundError);
        return json({
          success: false,
          status: 'pending',
          reference,
          message: 'The transfer failed, but your refund is being reviewed. Please check its status.',
        }, 503);
      }
      if (refundedTx) {
        debited = false;
        return json({
          success: false,
          status: 'failed',
          refunded: true,
          reference,
          transaction: refundedTx,
          message: 'The transfer failed. Your money has been returned to your wallet.',
        });
      }
      // The RPC returned null: another process may have settled the
      // transaction. Fetch its actual status instead of claiming a refund.
      const { data: currentTx, error: currentTxError } = await supabase
        .from('transactions')
        .select()
        .eq('reference', reference)
        .maybeSingle();
      if (currentTxError || !currentTx) {
        console.error('Could not confirm withdrawal after refund returned null:', reference, currentTxError);
        return json({
          success: false,
          status: 'unknown',
          reference,
          message: 'Please check your withdrawal status.',
        }, 503);
      }
      return json({
        success: currentTx.status === 'successful',
        status: currentTx.status,
        refunded: currentTx.status === 'failed',
        reference,
        transaction: currentTx,
        message: currentTx.status === 'failed'
          ? 'Your money has been returned to your wallet.'
          : 'Your withdrawal status has been updated.',
      });
    }

    // 9. Accepted. SUCCESS and COMPLETED are both successful (Monnify's
    // status reference); anything else stays pending until the webhook.
    const finalStatus = ['SUCCESS', 'COMPLETED'].includes(providerStatus) ? 'successful' : 'pending';
    const fee = Number(transferData?.responseBody?.totalFee ?? 0);
    const { data: updatedTx, error: updateError } = await supabase
      .from('transactions')
      .update({
        status: finalStatus,
        metadata: { ...(txRow.metadata ?? {}), provider_status: providerStatus, provider_fee: fee },
      })
      .eq('id', txRow.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    // A database failure must not be reported as a successful settlement.
    // If the update failed, leave the withdrawal pending (the webhook or
    // reconciliation settles it) and say so — never return a locally
    // constructed 'successful' status when the write did not happen.
    if (updateError) {
      console.error('Withdrawal status update failed:', reference, updateError);
      return json({
        success: true,
        status: 'pending',
        reference,
        message: 'Your withdrawal is being processed. Please check its status.',
      });
    }
    // If the update changed no row (the webhook already settled it, or it was
    // refunded), fetch the actual current row instead of returning a locally
    // constructed status that might be outdated. If the read ALSO fails,
    // do NOT manufacture a transaction with the status we wanted to write —
    // a webhook could have marked the withdrawal failed, and a failed read
    // would make this endpoint report 'successful'. Return 503 with an
    // unknown status instead.
    let finalTx = updatedTx;
    if (!finalTx) {
      const { data: currentTx, error: currentTxError } = await supabase
        .from('transactions')
        .select()
        .eq('id', txRow.id)
        .maybeSingle();
      if (currentTxError || !currentTx) {
        console.error('Could not confirm final withdrawal status:', reference, currentTxError);
        return json({
          success: false,
          status: 'unknown',
          reference,
          message: 'Your withdrawal is being processed. Please check its status.',
        }, 503);
      }
      finalTx = currentTx;
    }

    return json({
      success: true,
      status: finalTx.status,
      reference,
      transaction: finalTx,
    });
  } catch (error: any) {
    console.error('Withdrawal Error:', error);

    // Only auto-refund if we took the money but never reached the bank.
    // The refund is atomic (refund_failed_withdrawal RPC), so it cannot
    // leave the balance down with the row still pending.
    if (debited && !transferAttempted && walletId) {
      try {
        await refundWithdrawal(reference);
      } catch (refundError) {
        console.error('REFUND FAILED – reconcile manually:', reference, refundError);
      }
    }
    // A fingerprint conflict (same key, different destination) is a client
    // error about the request itself, not a server failure: 409.
    // Map the rest to the right status: auth 401, validation 400, PIN
    // lockout 429, temporary provider/database failure 503, anything else
    // 500. Do not return every exception as 400 — a provider outage is not
    // a client error, and a lockout is not a bad request.
    const msg = String(error?.message ?? 'Unknown error');
    let status = 400;
    if (msg.includes('different withdrawal details') || msg.includes('Reference already used')) {
      status = 409;
    } else if (msg.includes('Too many incorrect attempts') || msg.includes('Try again after') || msg.includes('Another PIN verification is in progress')) {
      status = 429;
    } else if (
      msg.includes('Banking provider') ||
      msg.includes('offline') ||
      msg.includes('authentication failed') ||
      msg.includes('PIN verification is not configured') ||
      msg.includes('Unable to verify PIN') ||
      msg.includes('Could not') ||
      error?.code !== undefined
    ) {
      status = 503;
    } else if (
      msg.includes('Enter a valid') ||
      msg.includes('Minimum withdrawal') ||
      msg.includes('Select a bank') ||
      msg.includes('PIN') ||
      msg.includes('Amount must') ||
      msg.includes('Insufficient') ||
      msg.includes('Wallet not found') ||
      msg.includes('Withdrawal exceeds the maximum permitted amount') ||
      msg.includes('Maximum withdrawal is') ||
      msg.includes('Daily withdrawal limit exceeded') ||
      msg.includes('Withdrawal amount cannot exceed two decimal places') ||
      msg.includes('Invalid withdrawal amount') ||
      msg.includes('Account name does not match') ||
      msg.includes('A valid idempotency key is required')
    ) {
      status = 400;
    } else {
      status = 500;
    }
    // For server errors, return a safe public message — never expose raw
    // database errors, provider messages, or internal implementation
    // details to the client. The detailed error is in the server log above.
    const publicMessage = status >= 500
      ? 'Unable to process your withdrawal right now. Please check its status.'
      : msg;
    return json({ error: publicMessage }, status);
  }
});
