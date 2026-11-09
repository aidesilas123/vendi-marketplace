// supabase/functions/monnify-fee-reconcile/index.ts
//
// Settles a Monnify fee payment (verification or sponsorship). THE single
// writer for fee fulfilment: it verifies the payment with Monnify, then
// fulfils it exactly once. A payment can succeed while fulfilment fails
// (listing sold/deleted) — the money is refunded to the wallet, never lost.
//
// POST { paymentReference, transactionReference?, cancelled? }.
// Auth: service role key (from the webhook) OR the user JWT (must own the row).
// Returns { paid, kind, ... } / { paid: false, cancelled | dead | not_started }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONNIFY_MODE = Deno.env.get('MONNIFY_MODE') ?? 'test';
const MONNIFY_BASE =
  MONNIFY_MODE === 'live' ? 'https://api.monnify.com' : 'https://sandbox.monnify.com';
const SPONSOR_DAYS = 7;
const DEAD_STATUSES = ['FAILED', 'EXPIRED', 'ABANDONED', 'CANCELLED', 'REVERSED'];

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

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

async function verifyByPaymentReference(paymentReference: string) {
  const token = await monnifyAccessToken();
  const res = await fetch(
    `${MONNIFY_BASE}/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(paymentReference)}`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.requestSuccessful) {
    throw new Error(`Monnify lookup failed: ${data?.responseMessage ?? res.status}`);
  }
  return data.responseBody ?? null;
}

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

// Refunds a PAID fee whose fulfilment is impossible (listing gone). Moves the
// fee row pending -> failed exactly once, credits the wallet, records a refund row.
async function refundFee(row: any, meta: any, gatewayTotal: number, reason: string) {
  const { data: claimed } = await supabase
    .from('transactions')
    .update({ status: 'failed', metadata: { ...meta, failure_reason: reason } })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id');
  if (!claimed || claimed.length === 0) return { refunded: false, already: true };
  await adjustBalance(row.wallet_id, gatewayTotal);
  await supabase.from('transactions').insert({
    user_id: row.user_id,
    wallet_id: row.wallet_id,
    type: 'refund',
    status: 'successful',
    amount: gatewayTotal,
    title: `Refund: ${row.title}`,
    reference: `RFND-${row.reference}`,
    metadata: { original_ref: row.reference, reason },
  });
  return { refunded: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method === 'GET') {
    return new Response('monnify-fee-reconcile is running', { headers: corsHeaders });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const paymentReference = body?.paymentReference;
    if (!paymentReference) throw new Error('Missing paymentReference');

    const authHeader = req.headers.get('Authorization') ?? '';
    const isServiceRole = authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '___none___');
    let callerId: string | null = null;
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      if (authError || !user) throw new Error('Unauthorized');
      callerId = user.id;
    }

    const { data: row, error: rowError } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', paymentReference)
      .eq('type', 'debit')
      .maybeSingle();
    if (rowError || !row) return json({ success: false, error: 'Fee payment not found' }, 404);
    const meta = row.metadata ?? {};
    const kind = meta.kind;
    if (kind !== 'verification' && kind !== 'sponsorship') {
      return json({ success: false, error: 'Not a fee payment' }, 400);
    }
    if (callerId && row.user_id !== callerId) return json({ success: false, error: 'Forbidden' }, 403);

    if (row.status === 'successful') {
      return json({ success: true, paid: true, kind, already: true });
    }
    if (row.status === 'failed' && meta.failure_reason === 'user_cancelled') {
      return json({ success: true, paid: false, kind, cancelled: true, already: true });
    }
    if (row.status !== 'pending') {
      return json({ success: true, paid: false, kind, already: true });
    }

    const gatewayTotal = Number(meta.gateway_total ?? Math.abs(Number(row.amount)));
    const monnifyTxRef = body?.transactionReference ?? meta.monnify_transaction_reference ?? null;

    let verified: any = null;
    try {
      verified = monnifyTxRef
        ? await verifyWithMonnify(monnifyTxRef)
        : await verifyByPaymentReference(paymentReference);
    } catch (e: any) {
      return json({ success: true, paid: false, kind, error: e?.message || 'Monnify lookup failed' });
    }

    if (!verified) {
      if (body?.cancelled === true) {
        await supabase
          .from('transactions')
          .update({ status: 'failed', metadata: { ...meta, failure_reason: 'user_cancelled' } })
          .eq('id', row.id)
          .eq('status', 'pending');
        return json({ success: true, paid: false, kind, cancelled: true });
      }
      return json({ success: true, paid: false, kind, not_started: true, error: 'Monnify has no record of this payment yet' });
    }

    const status = String(verified.paymentStatus ?? '');
    const amountPaid = Number(verified.amountPaid ?? 0);
    if (status !== 'PAID' && status !== 'OVERPAID') {
      if (DEAD_STATUSES.includes(status)) {
        await supabase
          .from('transactions')
          .update({ status: 'failed', metadata: { ...meta, failure_reason: status.toLowerCase() } })
          .eq('id', row.id)
          .eq('status', 'pending');
        return json({ success: true, paid: false, kind, dead: true, paymentStatus: status });
      }
      if (body?.cancelled === true) {
        await supabase
          .from('transactions')
          .update({ status: 'failed', metadata: { ...meta, failure_reason: 'user_cancelled' } })
          .eq('id', row.id)
          .eq('status', 'pending');
        return json({ success: true, paid: false, kind, cancelled: true, paymentStatus: status });
      }
      return json({ success: true, paid: false, kind, paymentStatus: status });
    }
    if (amountPaid < gatewayTotal) {
      return json({ success: true, paid: false, kind, paymentStatus: 'PARTIALLY_PAID' });
    }

    // PAID — fulfil exactly once.
    if (kind === 'verification') {
      const { data: prior } = await supabase
        .from('verifications')
        .select('id')
        .eq('user_id', row.user_id)
        .limit(1);
      if (!prior || prior.length === 0) {
        const { error: insertError } = await supabase.from('verifications').insert({
          user_id: row.user_id,
          document_type: meta.document_type ?? 'id',
          document_url: meta.document_url ?? null,
          selfie_url: meta.selfie_url ?? null,
          status: 'pending',
          fee_paid: true,
          fee_reference: paymentReference,
        });
        if (insertError) throw new Error('Could not file the verification');
      }
    } else {
      const productId = meta.product_id;
      const { data: product } = await supabase
        .from('products')
        .select('id, status, sponsored_until')
        .eq('id', productId)
        .maybeSingle();
      if (!product || (product.status !== 'ACTIVE' && product.status !== 'APPROVED')) {
        const r = await refundFee(row, meta, gatewayTotal, 'listing_unavailable');
        return json({ success: true, paid: true, kind, refunded: r.refunded });
      }
      const base = product.sponsored_until && new Date(product.sponsored_until).getTime() > Date.now()
        ? new Date(product.sponsored_until).getTime()
        : Date.now();
      const sponsoredUntil = new Date(base + SPONSOR_DAYS * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('products').update({ sponsored_until: sponsoredUntil }).eq('id', productId);
    }

    const { data: claimed } = await supabase
      .from('transactions')
      .update({
        status: 'successful',
        metadata: {
          ...meta,
          fee_paid: true,
          monnify_transaction_reference: verified.transactionReference ?? monnifyTxRef ?? null,
        },
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed || claimed.length === 0) {
      return json({ success: true, paid: true, kind, already: true });
    }
    return json({ success: true, paid: true, kind, paymentStatus: status });
  } catch (e: any) {
    return json({ success: false, error: e?.message || 'Fee reconcile failed' }, 500);
  }
});
