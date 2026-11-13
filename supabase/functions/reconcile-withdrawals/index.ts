// supabase/functions/reconcile-withdrawals/index.ts
//
// Re-checks the caller's stuck PENDING withdrawals against Monnify and settles them.
// Finding 5: when the disbursement call fails with a network error, the withdrawal
// stays pending with the money taken. The webhook only settles it if Monnify
// actually received the request — if the request never arrived, nothing ever
// comes back and the money sits locked. This function closes that gap.
//
// How to use it:
//   - Call it from the wallet screen whenever a pending withdrawal is shown
//     (a "Check status" action) with the USER's token: it checks only that
//     user's stale withdrawals, rate-limited to 10 calls/hour.
//   - Call it on a schedule (Supabase cron / pg_cron) with the CRON_SECRET:
//     the scheduler sends `Authorization: Bearer <CRON_SECRET>`, and the
//     function sweeps ALL users' stale withdrawals in one batch (oldest
//     first, capped at 20 per run), with no user identity and no per-user
//     rate limit. Set CRON_SECRET in Supabase dashboard → Edge Functions →
//     Secrets (a long random string, never in chat, never in the frontend).
//     A user token can never trigger the sweep.
//
// Rules:
//   - Only the caller's OWN withdrawals are ever touched (user_id filter).
//   - Only rows older than 5 minutes are checked, so the webhook gets the
//     first chance to settle a fresh withdrawal.
//   - Monnify SUCCESS  -> mark the row successful (money already left).
//   - Monnify FAILED   -> refund atomically via refund_failed_withdrawal
//     (failed + wallet credited). FAILED is the ONLY refundable status:
//     PENDING_AUTHORIZATION and OTP_EMAIL_DISPATCH_FAILED are NOT failures
//     — a transfer waiting for authorization could still be authorized
//     later, and an OTP delivery failure may be recoverable. Those stay
//     pending and are re-checked on the next run.
//   - Monnify PENDING / IN_PROGRESS / PENDING_AUTHORIZATION /
//     OTP_EMAIL_DISPATCH_FAILED / lookup failure -> leave it pending;
//     never refund on an unknown outcome (the money might still be in flight).
//
// Monnify endpoint (confirmed in Monnify's own docs + Go wrapper):
//   GET /api/v2/disbursements/single/summary?reference=<reference>
//   Bearer token. responseBody.status is SUCCESS, FAILED, PENDING,
//   IN_PROGRESS, PENDING_AUTHORIZATION or OTP_EMAIL_DISPATCH_FAILED.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';
const STALE_AFTER_MS = 5 * 60 * 1000; // only check withdrawals older than 5 minutes
const MAX_ROWS = 20;
// Per-user rate limit: a "Check status" tap is cheap, but each call queries
// Monnify once per stale withdrawal. 10 calls/hour per user is plenty for a
// manual check and stops a script hammering Monnify's status endpoint.
const RATE_LIMIT_PER_HOUR = 10;
const RATE_LIMIT_FN = 'reconcile-withdrawals';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

/** Atomic rate-limit check (check_rate_limit RPC): counts AND records the
 * call in one database transaction, serialized per (user, fn) by an
 * advisory lock, so two simultaneous requests cannot both slip under the
 * cap. Fail-CLOSED on a DB error: for a production financial endpoint, a
 * broken rate-limit table must not silently allow unlimited provider
 * requests. The caller returns 503 when this throws. */
async function checkRateLimit(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_user_id: userId,
    p_fn: RATE_LIMIT_FN,
    p_limit: RATE_LIMIT_PER_HOUR,
    p_window_minutes: 60,
  });
  if (error) throw new Error(`Rate-limit check failed: ${error.message}`);
  return data === true;
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

/** Constant-time string comparison (for secrets). Ordinary === returns
 * false on the first differing character, leaking timing information. */
function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Only POST is accepted.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // 1. Two modes. A normal user checks ONLY their own stale withdrawals
    //    (rate-limited). A scheduled sweep checks ALL users' stale
    //    withdrawals in one batch, with no user identity and no per-user
    //    rate limit — but ONLY when the caller presents the CRON_SECRET.
    //    The sweep is authenticated by a shared secret, NOT by decoding a
    //    JWT: a decoded JWT claim is not verified, so anyone could forge a
    //    token with role 'service_role' and trigger the global sweep. The
    //    secret lives in Edge Function secrets (CRON_SECRET) and is sent
    //    by the scheduler as `Authorization: Bearer <CRON_SECRET>`; it is
    //    never exposed to the frontend. If CRON_SECRET is not set, no
    //    sweep is possible (fail closed). A user token can never trigger it.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);
    const cronSecret = Deno.env.get('CRON_SECRET');
    // Constant-time comparison: a normal === would leak how many leading
    // characters of the secret are correct. If CRON_SECRET is not set, no
    // sweep is possible (fail closed).
    const isSweep = !!cronSecret && constantTimeEqual(authHeader, `Bearer ${cronSecret}`);

    let userId: string | null = null;
    if (!isSweep) {
      // User mode: authenticate, then scope everything to their own rows.
      // Auth failures are 401, not 400.
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) return json({ error: 'Unauthorized access' }, 401);
      userId = user.id;

      // Rate limit: 10 calls/hour per user, so a script cannot hammer
      // Monnify's status endpoint through this function. A rate-limit
      // database failure is a 503 (fail closed), not an open door.
      let allowed: boolean;
      try {
        allowed = await checkRateLimit(user.id);
      } catch (e: any) {
        console.error('[reconcile-withdrawals] rate-limit check failed:', e);
        return json({ error: 'Status checks are temporarily unavailable. Try again shortly.' }, 503);
      }
      if (!allowed) {
        return json({ error: 'Too many status checks. Try again in an hour.' }, 429);
      }
    }

    // Optional: check one specific reference instead of sweeping all stale ones.
    const body = await req.json().catch(() => ({}));
    const onlyReference = String(body?.reference ?? '').trim();

    // 2. Claim stale pending withdrawals atomically. The RPC stamps each
    //    claimed row as checked, so the next run moves on to the next batch
    //    instead of re-selecting the same unresolved 20 forever. A forced
    //    check (one user, one reference) may re-check sooner. User mode
    //    scopes to the caller's rows; sweep mode takes every user's.
    const { data: pending, error: pendingError } = await supabase.rpc(
      'claim_withdrawals_for_reconciliation',
      {
        p_user_id: userId,
        p_reference: onlyReference || null,
        p_limit: MAX_ROWS,
        p_force: Boolean(userId && onlyReference),
      },
    );
    if (pendingError) {
      console.error('Could not claim reconciliation rows:', pendingError);
      throw new Error('Could not claim pending withdrawals');
    }
    if (!pending || pending.length === 0) {
      return json({ checked: 0, settled: 0, refunded: 0, stillPending: 0, results: [] });
    }

    const accessToken = await monnifyLogin();
    let settled = 0;
    let refunded = 0;
    let stillPending = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const tx of pending) {
      const providerStatus = await queryDisbursementStatus(accessToken, tx.reference);

      // SUCCESS and COMPLETED are both successful (Monnify's status
      // reference). AWAITING_PROCESSING / IN_PROGRESS are still processing.
      if (['SUCCESS', 'COMPLETED'].includes(providerStatus)) {
        // The money reached the bank. Mark it successful; nothing to refund.
        // Check the database error: a failed update is NOT "already
        // settled" — it means the row could not be written, and reporting
        // it as settled would hide the failure. Only count it when the
        // update actually changed a row.
        const { data: settledRow, error: settleError } = await supabase
          .from('transactions')
          .update({ status: 'successful' })
          .eq('id', tx.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();
        if (settleError) {
          // Log the database error server-side; do not expose it in the
          // result — raw errors leak implementation details.
          console.error('Could not settle withdrawal:', tx.reference, settleError);
          stillPending++;
          results.push({ reference: tx.reference, outcome: 'settle_failed', providerStatus });
        } else if (settledRow) {
          settled++;
          results.push({ reference: tx.reference, outcome: 'settled', providerStatus });
        } else {
          // No row changed — but that does not mean it was settled. The
          // webhook may have refunded it or marked it failed. Fetch its
          // actual status before reporting, just as the refund branch does.
          // A failed read is reported as a lookup failure, not guessed.
          const { data: currentTx, error: currentLookupError } = await supabase
            .from('transactions')
            .select('status')
            .eq('id', tx.id)
            .maybeSingle();
          if (currentLookupError) {
            console.error('Could not read current withdrawal:', tx.reference, currentLookupError);
            stillPending++;
            results.push({ reference: tx.reference, outcome: 'status_lookup_failed', providerStatus });
            continue;
          }
          const currentStatus = currentTx?.status ?? 'unknown';
          results.push({
            reference: tx.reference,
            outcome: currentStatus === 'successful' ? 'already_settled' : 'already_' + currentStatus,
            providerStatus,
            currentStatus,
          });
        }
      } else if (['FAILED', 'REVERSED', 'EXPIRED', 'NOT_FOUND'].includes(providerStatus)) {
        // Terminal outcomes only. FAILED / REVERSED / EXPIRED mean the
        // transfer cannot complete. NOT_FOUND is Monnify's explicit D02 —
        // "Transaction does not exist" — so the transfer was never
        // registered and a refund cannot double-pay. PENDING_AUTHORIZATION
        // and OTP_EMAIL_DISPATCH_FAILED are NOT refunded here: a transfer
        // waiting for authorization could still be authorized later, and
        // an OTP delivery failure may be recoverable. Refunding either
        // would pay the user twice if the transfer then completes. Those
        // stay pending and are re-checked on the next run; only a terminal
        // outcome (or a later SUCCESS) settles them. Refund atomically:
        // row -> failed AND wallet credited in one transaction.
        const { data: refundedTx, error: refundError } = await supabase.rpc('refund_failed_withdrawal', {
          p_reference: tx.reference,
          p_from_statuses: ['pending'],
        });
        if (!refundError && refundedTx) {
          refunded++;
          results.push({ reference: tx.reference, outcome: 'refunded', providerStatus });
        } else if (!refundError && !refundedTx) {
          // The RPC returned null without an error: the row was already
          // settled by the webhook (or another run). Fetch its actual
          // status and report it precisely — do not describe every
          // non-success status as already refunded.
          const { data: currentTx, error: currentTxError } = await supabase
            .from('transactions')
            .select('status')
            .eq('id', tx.id)
            .maybeSingle();
          if (currentTxError) {
            console.error('Could not read current transaction:', tx.reference, currentTxError);
            stillPending++;
            results.push({ reference: tx.reference, outcome: 'status_lookup_failed', providerStatus });
            continue;
          }
          const currentStatus = currentTx?.status ?? 'unknown';
          if (currentStatus === 'successful') {
            results.push({ reference: tx.reference, outcome: 'already_settled', providerStatus, currentStatus });
          } else if (currentStatus === 'failed') {
            refunded++;
            results.push({ reference: tx.reference, outcome: 'already_refunded', providerStatus, currentStatus });
          } else {
            stillPending++;
            results.push({ reference: tx.reference, outcome: 'still_pending', providerStatus, currentStatus });
          }
        } else {
          // Log the database error server-side; do not expose it in the
          // result — raw errors leak implementation details.
          console.error('Could not refund withdrawal:', tx.reference, refundError);
          stillPending++;
          results.push({ reference: tx.reference, outcome: 'refund_failed', providerStatus });
        }
      } else {
        // PENDING / IN_PROGRESS / UNKNOWN — leave it. The money might still
        // be in flight, and the webhook or a later check settles it.
        stillPending++;
        results.push({ reference: tx.reference, outcome: 'still_pending', providerStatus });
      }
    }

    return json({ checked: pending.length, settled, refunded, stillPending, results });
  } catch (error: any) {
    // Internal failures (provider, database) are 503, not 400: they may be
    // retried, and they are not client errors. Auth (401) and rate-limit
    // (429) responses are returned before this catch, so they keep their
    // own statuses. The message is generic — raw error details are logged
    // server-side only.
    console.error('Reconcile withdrawals error:', error);
    return json({ error: 'Unable to reconcile withdrawals. Try again shortly.' }, 503);
  }
});
