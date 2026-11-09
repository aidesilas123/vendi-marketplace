// supabase/functions/sponsor-listing/index.ts
//
// Sponsorship: pay SPONSOR_PRICE to boost one of your own listings for
// SPONSOR_DAYS days. The boost is a +25 ranking lift in feed_products and
// a "Sponsored" label on the card. Renewing an already-sponsored listing
// extends it from its current expiry (or now, whichever is later).
//
// POST { product_id } with the user JWT. Returns:
//   { success: true, sponsored_until, reference }.
//   { success: false, error: 'insufficient' } — wallet balance is below the price.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPONSOR_PRICE = 1000; // keep in sync with SPONSOR_PRICE in sponsorships/page.tsx
const SPONSOR_DAYS = 7;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized');
    const body = await req.json().catch(() => ({}));
    const productId = body?.product_id;
    if (!productId) throw new Error('Missing product_id');

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, seller_id, status, title, sponsored_until')
      .eq('id', productId)
      .single();
    if (productError || !product) throw new Error('Listing not found');
    if (product.seller_id !== user.id) throw new Error('This is not your listing');
    if (product.status !== 'ACTIVE' && product.status !== 'APPROVED') {
      throw new Error('Only an active listing can be sponsored');
    }

    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('user_id', user.id)
      .maybeSingle();
    if (walletError || !wallet) throw new Error('Wallet not found');
    if (Number(wallet.balance) < SPONSOR_PRICE) {
      return json({ success: false, error: 'insufficient', price: SPONSOR_PRICE }, 400);
    }

    await adjustBalance(wallet.id, -SPONSOR_PRICE, true);
    const reference = `SPON-${Date.now().toString(36).toUpperCase()}`;
    const { error: txError } = await supabase.from('transactions').insert({
      user_id: user.id,
      wallet_id: wallet.id,
      type: 'debit',
      status: 'successful',
      amount: -SPONSOR_PRICE,
      title: `Sponsored: ${product.title}`,
      reference,
      metadata: { product_id: productId, sponsor_days: SPONSOR_DAYS },
    });
    if (txError) throw new Error('Could not record the sponsorship payment');

    const base = product.sponsored_until && new Date(product.sponsored_until).getTime() > Date.now()
      ? new Date(product.sponsored_until).getTime()
      : Date.now();
    const sponsoredUntil = new Date(base + SPONSOR_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase
      .from('products')
      .update({ sponsored_until: sponsoredUntil })
      .eq('id', productId);
    if (updateError) throw new Error('Could not sponsor the listing');
    return json({ success: true, sponsored_until: sponsoredUntil, reference, price: SPONSOR_PRICE, days: SPONSOR_DAYS });
  } catch (e: any) {
    const msg = e?.message || 'Could not sponsor this listing';
    const status = msg === 'Insufficient verified funds' ? 400 : 500;
    return json({ success: false, error: msg }, status);
  }
});
