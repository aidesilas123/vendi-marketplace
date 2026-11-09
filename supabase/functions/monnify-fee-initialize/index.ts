// supabase/functions/monnify-fee-initialize/index.ts
//
// Starts a Monnify payment for a fee (verification or sponsorship). The SDK
// initializes the payment client-side, so this function does NOT call
// Monnify — it only validates, quotes the fee + gateway fee, and creates the
// PENDING row the reconcile later settles.
//
// POST { kind: 'verification' | 'sponsorship', product_id?, document_url?,
//        selfie_url?, document_type? } with the user JWT.
// Returns { success, paymentReference, gatewayTotal, gatewayFee,
//           customerName, customerEmail }.
//   { success: true, alreadyPaid: true } — verification was already paid.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VERIFICATION_FEE = 1500; // keep in sync with verification/page.tsx
const SPONSOR_PRICE = 1000; // keep in sync with sponsorships/page.tsx
const SPONSOR_DAYS = 7;
const GATEWAY_RATE = 0.015; // Monnify local 1.5%

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized');
    const body = await req.json().catch(() => ({}));
    const kind = body?.kind;
    if (kind !== 'verification' && kind !== 'sponsorship') throw new Error('Unknown fee kind');

    let fee = 0;
    let title = '';
    let productId: string | null = null;
    const meta: Record<string, unknown> = { provider: 'monnify', kind };

    if (kind === 'verification') {
      const { data: prior } = await supabase
        .from('verifications')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);
      if (prior && prior.length > 0) return json({ success: true, alreadyPaid: true });
      fee = VERIFICATION_FEE;
      title = 'Verification fee';
      meta.document_url = body?.document_url ?? null;
      meta.selfie_url = body?.selfie_url ?? null;
      meta.document_type = body?.document_type ?? null;
    } else {
      productId = body?.product_id;
      if (!productId) throw new Error('Missing product_id');
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, seller_id, status, title')
        .eq('id', productId)
        .single();
      if (productError || !product) throw new Error('Listing not found');
      if (product.seller_id !== user.id) throw new Error('This is not your listing');
      if (product.status !== 'ACTIVE' && product.status !== 'APPROVED') {
        throw new Error('Only an active listing can be sponsored');
      }
      fee = SPONSOR_PRICE;
      title = `Sponsored: ${product.title}`;
      meta.product_id = productId;
      meta.sponsor_days = SPONSOR_DAYS;
    }

    const gatewayFee = Math.ceil(fee * GATEWAY_RATE);
    const gatewayTotal = fee + gatewayFee;
    const paymentReference = `MONFEE-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const { data: profile } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const customerName = profile?.full_name || user.email || 'Vendi user';
    const customerEmail = user.email || '';

    const { data: wallet } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!wallet) throw new Error('Wallet not found');

    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: user.id,
      wallet_id: wallet.id,
      type: 'debit',
      status: 'pending',
      amount: -gatewayTotal,
      title,
      reference: paymentReference,
      metadata: {
        ...meta,
        fee,
        gateway_fee: gatewayFee,
        gateway_total: gatewayTotal,
        payment_reference: paymentReference,
        monnify_transaction_reference: null,
        fee_paid: false,
      },
    });
    if (insertError) throw new Error('Could not start the fee payment');

    return json({ success: true, paymentReference, gatewayTotal, gatewayFee, customerName, customerEmail });
  } catch (e: any) {
    return json({ success: false, error: e?.message || 'Could not start the fee payment' }, 400);
  }
});
