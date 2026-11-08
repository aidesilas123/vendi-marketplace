// supabase/functions/monnify-checkout-reconcile/index.ts
//
// THE single writer for Monnify checkout escrows. Both the webhook and the
// app call this function — nobody else creates an escrow from a Monnify
// payment, so the money can only go one way.
//
// POST { paymentReference, monnifyTransactionReference? }:
//   1. Load the PENDING checkout row (type 'debit', reference = our
//      paymentReference). If it is already 'successful' or 'failed', return
//      the stored outcome — calling reconcile twice is safe.
//   2. Verify the payment DIRECTLY with Monnify
//      (GET /api/v2/transactions/{transactionReference}). The webhook event
//      alone is never trusted — Monnify's own docs say to confirm the status
//      with them before updating your records. When the server has no
//      transaction reference (the SDK started the payment in the browser),
//      it looks the transaction up by our paymentReference instead
//      (GET /api/v2/merchant/transactions/query?paymentReference=...).
//   3. If PAID (or OVERPAID): create the escrow — an 'escrow_hold' row
//      identical in shape to process-escrow's, plus mark the product SOLD.
//      If the item was just sold to someone else, go to (4) instead.
//   4. If the escrow cannot be created: mark the checkout 'failed' and
//      return the FULL amount the buyer paid (total + gateway fee) to their
//      Vendi wallet, with a 'refund' row. The buyer gets the item OR the
//      money back, never both, and never neither.
//
// The gate: the checkout row's status moves pending → 'successful' /
// 'failed' exactly once, with a conditional update (only if still
// 'pending'). A second run — webhook retry, app retry, or both at once —
// sees the new status and returns the stored outcome instead of acting.
//
// GET (no body): the landing page Monnify redirects the buyer's browser to
// after payment (the initialize function sets this URL as redirectUrl).
// It bounces the browser back into the app via the
// com.vendi.app://payment-return deep link, and tells the buyer to return
// manually if the bounce doesn't fire.
//
// Auth: EITHER the user's JWT (the app — the caller must own the checkout
// row) OR the Supabase service role key (the monnify-webhook, server to
// server). Env: MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_CONTRACT_CODE,
// MONNIFY_MODE ('test' | 'live', default 'test').

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONNIFY_MODE = Deno.env.get('MONNIFY_MODE') ?? 'test';
const MONNIFY_BASE =
  MONNIFY_MODE === 'live' ? 'https://api.monnify.com' : 'https://sandbox.monnify.com';

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function monnifyAccessToken(): Promise<string> {
  const apiKey = Deno.env.get('MONNIFY_API_KEY')!;
  const secretKey = Deno.env.get('MONNIFY_SECRET_KEY')!;
  if (!apiKey || !secretKey) throw new Error('Monnify API keys are not configured');
  const credentials = btoa(`${apiKey}:${secretKey}`);
  const res = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  const token = data?.responseBody?.accessToken;
  if (!res.ok || !data?.requestSuccessful || !token) {
    throw new Error(`Monnify login failed: ${data?.responseMessage ?? res.status}`);
  }
  return token as string;
}

// Asks Monnify directly for the payment's status. Returns the raw
// responseBody: paymentStatus, amountPaid, settlementAmount, ...
async function verifyWithMonnify(transactionReference: string) {
  const token = await monnifyAccessToken();
  const res = await fetch(
    `${MONNIFY_BASE}/api/v2/transactions/${encodeURIComponent(transactionReference)}`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.requestSuccessful || !data?.responseBody) {
    throw new Error(`Monnify status check failed: ${data?.responseMessage ?? res.status}`);
  }
  return data.responseBody;
}

// Looks a transaction up by OUR paymentReference (the one the SDK was
// given). The SDK starts the payment in the browser, so the server often
// has no Monnify transaction reference yet — the initialize function never
// called Monnify, and the app only learns the reference from onComplete.
// Returns the responseBody (paymentStatus, amountPaid,
// transactionReference, ...) or null when Monnify has no record of this
// reference. Throws on a lookup failure, so the caller never closes a row
// it could not verify.
async function verifyByPaymentReference(paymentReference: string) {
  const token = await monnifyAccessToken();
  const res = await fetch(
    `${MONNIFY_BASE}/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(paymentReference)}`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
  );
  // 404 = Monnify has no transaction for this reference yet.
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.requestSuccessful) {
    throw new Error(`Monnify lookup failed: ${data?.responseMessage ?? res.status}`);
  }
  return data.responseBody ?? null;
}

/** Optimistic-lock balance change (same helper as the monnify-webhook). */
async function adjustBalance(supabase: any, walletId: string, delta: number) {
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

// Terminal states where the buyer will never complete this payment. PENDING
// is NOT here — the buyer may still be paying (the checkout URL lives for
// 40 minutes), so a PENDING payment stays pending.
const DEAD_STATUSES = ['FAILED', 'EXPIRED', 'ABANDONED', 'CANCELLED', 'REVERSED'];

const ok = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Landing page for the browser Monnify redirects to after payment.
  // Monnify only accepts http(s) redirect URLs, so this page is the bridge
  // back into the app: it bounces the browser to the
  // com.vendi.app://payment-return deep link (the same scheme the Google
  // sign-in return uses). If the bounce doesn't fire, the page tells the
  // buyer to return to the app manually — the app reconciles on return.
  // The reference in the query is attacker-controlled, so it is escaped
  // before it is rendered and encoded before it goes into the deep link.
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const ref = url.searchParams.get('paymentReference') ?? '';
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let productId = '';
    if (ref) {
      try {
        const { data } = await supabase.from('transactions')
          .select('product_id')
          .eq('reference', ref).eq('type', 'debit').maybeSingle();
        productId = data?.product_id ?? '';
      } catch { /* no product — show the manual page below */ }
    }
    const deepLink = productId && ref
      ? `com.vendi.app://payment-return?productId=${encodeURIComponent(productId)}&paymentReference=${encodeURIComponent(ref)}`
      : '';
    const openLine = deepLink
      ? `<p>If the app didn't open, <a href="${deepLink}">tap here to return to Vendi</a>, or switch back to the app — your order appears there once the payment is confirmed.</p>`
      : `<p>Switch back to the Vendi app — your order appears there once the payment is confirmed.</p>`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment complete — Vendi</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#666;font-size:15px;line-height:1.5;margin:0 0 4px}.ref{color:#999;font-size:12px;margin-top:16px}.dot{width:56px;height:56px;border-radius:50%;background:#f97316;color:#fff;font-size:28px;line-height:56px;margin:0 auto 16px}a{color:#f97316;font-weight:700}</style></head><body><div><div class="dot">✓</div><h1>Payment complete</h1><p>Your payment was received. Opening the Vendi app…</p>${openLine}${ref ? `<p class="ref">Reference: ${esc(ref)}</p>` : ''}</div>${deepLink ? `<script>window.location.replace(${JSON.stringify(deepLink)});</script>` : ''}</body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: 200 });
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {

    // Auth: service role key = internal call from the monnify-webhook;
    // anything else must be the buyer's own JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const isInternal = token !== '' && token === supabaseKey;
    let callerUserId: string | null = null;
    if (!isInternal) {
      if (!token) throw new Error('Missing Authorization header');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) throw new Error('Unauthorized access');
      callerUserId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const paymentReference = String(body.paymentReference ?? '');
    if (!paymentReference) throw new Error('paymentReference is missing');

    // 1. The checkout row is the gate. Only the buyer who started it (or
    // the webhook, internally) may reconcile it.
    const { data: row, error: rowError } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', paymentReference)
      .eq('type', 'debit')
      .maybeSingle();
    if (rowError) throw new Error(`Database Error: ${rowError.message}`);
    if (!row) return ok({ error: 'Payment not found' }, 404);
    if (callerUserId && row.user_id !== callerUserId) {
      return ok({ error: 'This payment belongs to another buyer' }, 403);
    }

    const meta = row.metadata ?? {};
    const gatewayTotal = Number(meta.gateway_total ?? 0);
    const totalCharge = Number(meta.item_price ?? 0) + Number(meta.buyer_fee_paid ?? 0);
    const sellerNet = Number(meta.item_price ?? 0) - Number(meta.seller_fee_owed ?? 0);

    // Already decided — return the stored outcome (safe to call twice).
    if (row.status === 'successful') {
      return ok({
        success: true,
        already: true,
        reference: meta.escrow_reference ?? paymentReference,
        total_charge: totalCharge,
        seller_net: sellerNet,
      });
    }
    if (row.status === 'failed') {
      // A row closed because the buyer cancelled is not a refund — no money
      // moved, so the app must not say "your payment was returned".
      if (meta.failure_reason === 'user_cancelled') {
        return ok({ paid: false, cancelled: true, already: true });
      }
      return ok({ refunded: true, already: true });
    }
    if (row.status !== 'pending') {
      return ok({ error: `Payment is ${row.status}` }, 400);
    }

    // 2. Verify the payment directly with Monnify. The webhook event alone
    // is never trusted, and the app never decides on its own.
    //
    // The SDK starts the payment in the browser, so the server often has no
    // Monnify transaction reference yet — the initialize function never
    // called Monnify, and the app only learns the reference from onComplete.
    // When there is no reference, look the transaction up by OUR
    // paymentReference instead, so cancel / re-check still work. If Monnify
    // has no record of it, the payment never started: a cancelled attempt
    // can be closed, anything else just stays pending for the webhook.
    let monnifyTxRef = String(body.monnifyTransactionReference ?? meta.monnify_transaction_reference ?? '');
    let verified: any = null;
    if (monnifyTxRef) {
      verified = await verifyWithMonnify(monnifyTxRef);
    } else {
      verified = await verifyByPaymentReference(paymentReference);
      if (verified?.transactionReference) monnifyTxRef = String(verified.transactionReference);
    }
    if (!verified) {
      if (body.cancelled === true) {
        await supabase.from('transactions').update({
          status: 'failed',
          metadata: { ...meta, failure_reason: 'user_cancelled' },
        }).eq('id', row.id).eq('status', 'pending');
        return ok({ paid: false, cancelled: true });
      }
      return ok({ paid: false, not_started: true, error: 'Payment was not started with Monnify yet' });
    }
    const paymentStatus = String(verified.paymentStatus ?? 'PENDING').toUpperCase();
    const amountPaid = Number(verified.amountPaid ?? 0);

    // Not paid (yet). A dead payment is closed without a refund — no money
    // moved, so there is nothing to return. PENDING stays pending.
    if (paymentStatus !== 'PAID' && paymentStatus !== 'OVERPAID') {
      if (DEAD_STATUSES.includes(paymentStatus)) {
        await supabase.from('transactions').update({
          status: 'failed',
          metadata: { ...meta, failure_reason: paymentStatus },
        }).eq('id', row.id).eq('status', 'pending');
        return ok({ paid: false, paymentStatus, dead: true });
      }
      if (paymentStatus === 'PARTIALLY_PAID' || amountPaid < gatewayTotal) {
        return ok({ paid: false, paymentStatus: 'PARTIALLY_PAID' });
      }
      // The buyer closed the checkout without paying. Close the row so it
      // stops showing as a pending payment — no money moved, so there is
      // nothing to refund. (A PAID payment never reaches here: the verify
      // above sends it to the escrow path first.)
      if (body.cancelled === true) {
        await supabase.from('transactions').update({
          status: 'failed',
          metadata: { ...meta, failure_reason: 'user_cancelled' },
        }).eq('id', row.id).eq('status', 'pending');
        return ok({ paid: false, cancelled: true });
      }
      return ok({ paid: false, paymentStatus });
    }
    if (amountPaid < gatewayTotal) {
      return ok({ paid: false, paymentStatus: 'PARTIALLY_PAID' });
    }

    // 3. Paid. Create the escrow — unless the item is gone, in which case
    // the buyer gets a full refund (step 4).
    const { data: product } = await supabase
      .from('products')
      .select('id, title, status')
      .eq('id', row.product_id)
      .maybeSingle();

    // Idempotency: a previous run may have created the escrow but crashed
    // before marking this row. Never create a second one.
    const { data: existingEscrow } = await supabase
      .from('transactions')
      .select('reference')
      .eq('type', 'escrow_hold')
      .eq('metadata->>payment_reference', paymentReference)
      .maybeSingle();

    if (existingEscrow) {
      // An escrow row only exists when the product was claimed for this
      // payment (the claim runs before the insert below), so this is ours.
      // Claim this row now.
      await supabase.from('transactions').update({
        status: 'successful',
        metadata: { ...meta, escrow_created: true, escrow_reference: existingEscrow.reference },
      }).eq('id', row.id).eq('status', 'pending');
      return ok({
        success: true,
        already: true,
        reference: existingEscrow.reference,
        total_charge: totalCharge,
        seller_net: sellerNet,
      });
    }

    const itemGone = !product || product.status === 'SOLD';
    if (itemGone) {
      // Item is gone — full refund (total + gateway fee) to the wallet.
      return await refundBuyer(supabase, row, meta, gatewayTotal, 'item_sold');
    }

    // Claim the item FIRST (only if it is still for sale). If another buyer
    // took it in the meantime this touches 0 rows and we refund instead.
    const { data: sold } = await supabase
      .from('products')
      .update({ status: 'SOLD' })
      .eq('id', product.id)
      .neq('status', 'SOLD')
      .select('id');
    if (!sold || sold.length === 0) {
      return await refundBuyer(supabase, row, meta, gatewayTotal, 'item_sold');
    }

    const orderRef = `ESC-${Date.now().toString().substring(5)}`;
    const { error: escrowError } = await supabase.from('transactions').insert({
      wallet_id: row.wallet_id,
      user_id: row.user_id,
      product_id: row.product_id,
      seller_id: row.seller_id,
      amount: -totalCharge,
      type: 'escrow_hold',
      status: 'pending',
      title: `Escrow Hold: ${product.title}`,
      reference: orderRef,
      metadata: {
        item_price: meta.item_price,
        buyer_fee_paid: meta.buyer_fee_paid,
        seller_fee_owed: meta.seller_fee_owed,
        platform_revenue: meta.platform_revenue,
        is_promo: meta.is_promo,
        was_negotiated: meta.was_negotiated,
        provider: 'monnify',
        payment_reference: paymentReference,
        gateway_fee: meta.gateway_fee,
        gateway_total: gatewayTotal,
        monnify_transaction_reference: monnifyTxRef,
      },
    });
    // If this insert fails after the product was marked SOLD, the error is
    // loud (500 → the caller retries) and the retry refunds the buyer; the
    // listing stays SOLD and the seller re-lists. The money is always safe.
    if (escrowError) throw new Error(`Failed to record escrow: ${escrowError.message}`);

    // Claim the checkout row — only if it is still pending. If another run
    // claimed it first, this update touches 0 rows and we return that run's
    // outcome instead of acting twice.
    const { data: claimed } = await supabase
      .from('transactions')
      .update({
        status: 'successful',
        metadata: { ...meta, escrow_created: true, escrow_reference: orderRef },
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed || claimed.length === 0) {
      const { data: fresh } = await supabase.from('transactions').select('status, metadata').eq('id', row.id).single();
      if (fresh?.status === 'successful') {
        return ok({
          success: true,
          already: true,
          reference: fresh.metadata?.escrow_reference ?? orderRef,
          total_charge: totalCharge,
          seller_net: sellerNet,
        });
      }
      return ok({ refunded: true, already: true });
    }

    return ok({ success: true, reference: orderRef, total_charge: totalCharge, seller_net: sellerNet });
  } catch (error: any) {
    console.error('Monnify checkout reconcile error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

/** Marks the checkout 'failed' (exactly once) and returns the full amount
 *  the buyer paid — total + gateway fee — to their Vendi wallet, with a
 *  refund row. The buyer gets the item OR the money back, never both. */
async function refundBuyer(supabase: any, row: any, meta: any, gatewayTotal: number, reason: string) {
  const { data: claimed } = await supabase
    .from('transactions')
    .update({ status: 'failed', metadata: { ...meta, failure_reason: reason } })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id');
  if (!claimed || claimed.length === 0) {
    const { data: fresh } = await supabase.from('transactions').select('status, metadata').eq('id', row.id).single();
    if (fresh?.status === 'successful') {
      return ok({
        success: true,
        already: true,
        reference: fresh.metadata?.escrow_reference ?? row.reference,
        total_charge: Number(meta.item_price ?? 0) + Number(meta.buyer_fee_paid ?? 0),
        seller_net: Number(meta.item_price ?? 0) - Number(meta.seller_fee_owed ?? 0),
      });
    }
    return ok({ refunded: true, already: true });
  }

  await adjustBalance(supabase, row.wallet_id, gatewayTotal);
  await supabase.from('transactions').insert({
    wallet_id: row.wallet_id,
    user_id: row.user_id,
    product_id: row.product_id,
    seller_id: row.seller_id,
    amount: gatewayTotal,
    type: 'refund',
    status: 'successful',
    title: `Refund: Monnify payment ${row.reference}`,
    reference: `RFND-${row.reference}`,
    metadata: {
      provider: 'monnify',
      payment_reference: row.reference,
      gateway_total: gatewayTotal,
      reason,
    },
  });
  console.log('Refunded', gatewayTotal, 'to wallet for', row.reference);
  return ok({ refunded: true });
}
