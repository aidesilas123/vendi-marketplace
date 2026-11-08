// supabase/functions/monnify-checkout-initialize/index.ts
//
// Prepares a Monnify checkout payment for an escrow order (the direct model:
// the buyer pays Monnify online, the webhook + reconcile create the escrow).
// The wallet is never touched here — the money comes from Monnify, not the
// buyer's Vendi balance.
//
// This function does NOT call Monnify. It only quotes the payment and
// creates the PENDING checkout row (the reconcile anchor). The Monnify
// Web Checkout SDK opens the modal in the app and initializes the payment
// itself, using the reference and amount returned here. (If this function
// also initialized the transaction, Monnify would reject the SDK's init as
// a duplicate reference.)
//
// Flow: validate product + offer + platform fee (same math as process-escrow)
// → compute the Monnify gateway fee (1.5% of the total, rounded up) → insert
// a PENDING checkout row (type 'debit', status 'pending') → return the
// reference, the totals and the buyer's name + email for the SDK.
//
// The checkout row is the single record the webhook and the reconcile use to
// find this payment again. Its status moves pending → 'successful' (escrow
// created) or 'failed' (refunded / cancelled) exactly once, by the reconcile
// function only.
//
// No Monnify env vars are needed here. The SDK's apiKey + contractCode are
// public SDK credentials (like Paystack's public key) and live in the app
// as NEXT_PUBLIC_MONNIFY_API_KEY / NEXT_PUBLIC_MONNIFY_CONTRACT_CODE.
// The SECRET key stays only in Supabase secrets (webhook + reconcile).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new Error('Missing Authorization header');

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    const body = await req.json();
    const productId = body.productId;
    const offerPrice = body.offerPrice ? Number(body.offerPrice) : null;
    if (!productId) throw new Error('Product ID is missing');

    // 1. Fetch product (same guards as process-escrow)
    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', productId).single();
    if (productError) throw new Error(`Database Error (Product): ${productError.message}`);
    if (!product) throw new Error('Product not found');
    if (product.status === 'SOLD') throw new Error('This item has already been sold');
    if (product.seller_id === user.id) throw new Error('You cannot purchase your own item');

    // 2. Final item price (base price vs negotiated offer)
    const basePrice = Number(product.base_price || 0);
    let itemPrice = basePrice;
    if (offerPrice) {
      const lastPrice = Number(product.last_price || 0);
      if (lastPrice === 0) throw new Error('This item is not open to negotiation');
      if (offerPrice < lastPrice) throw new Error(`Offer is below the seller's minimum price of ₦${lastPrice}`);
      if (offerPrice > basePrice) throw new Error('Offer cannot exceed the base price');
      itemPrice = offerPrice;
    }

    // 3. Platform settings & fee math (same as process-escrow)
    const { data: settings, error: settingsError } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
    if (settingsError || !settings) throw new Error(`Failed to load platform settings: ${settingsError?.message}`);

    let buyerFee = 0;
    let sellerFee = 0;
    let platformRevenue = 0;
    if (!settings.is_launch_promo_active) {
      const platformFeePercent = Number(settings.platform_fee_percentage) || 0;
      buyerFee = Math.floor(itemPrice * (platformFeePercent / 100));
      sellerFee = Math.floor(itemPrice * (platformFeePercent / 100));
      platformRevenue = buyerFee + sellerFee;
    }
    const totalCharge = itemPrice + buyerFee;

    // 4. Monnify gateway fee: 1.5% of the total, rounded UP so the collected
    // amount always covers it. The buyer pays total + fee; the escrow amounts
    // (item price, seller net) stay exact. VAT on the fee and the fee-on-gross
    // rounding (a few naira) are absorbed by Vendi for now.
    const gatewayFee = Math.ceil(totalCharge * 0.015);
    const gatewayTotal = totalCharge + gatewayFee;

    // 5. The buyer's wallet must exist (the buy page creates it on first
    // checkout). Its id anchors the checkout row; the balance is NOT debited.
    const { data: wallet, error: walletError } = await supabase.from('wallets').select('id').eq('user_id', user.id).maybeSingle();
    if (walletError) throw new Error(`Database Error (Wallet): ${walletError.message}`);
    if (!wallet) throw new Error('Wallet not found. Open your wallet once, then try again.');

    // 6. Buyer name + email for the Monnify checkout modal
    const { data: buyerProfile } = await supabase.from('users').select('full_name').eq('id', user.id).maybeSingle();
    const customerName =
      buyerProfile?.full_name || (user.user_metadata as any)?.full_name || 'Vendi Buyer';
    const customerEmail = user.email;
    if (!customerEmail) throw new Error('Your account has no email address. Add one, then try again.');

    // 7. Unique payment reference. Monnify rejects a reference it has seen
    // before, so this is generated fresh on every attempt. The SDK
    // initializes the payment with this reference.
    const paymentReference =
      `MON-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // 8. Pending checkout row — the reconcile anchor. Status 'pending' is the
    // gate: it moves to 'successful' (escrow created) or 'failed' (refunded /
    // cancelled) exactly once, by the reconcile function only.
    const { error: rowError } = await supabase.from('transactions').insert({
      wallet_id: wallet.id,
      user_id: user.id,
      product_id: product.id,
      seller_id: product.seller_id,
      amount: -gatewayTotal,
      type: 'debit',
      status: 'pending',
      title: `Monnify Checkout: ${product.title}`,
      reference: paymentReference,
      metadata: {
        item_price: itemPrice,
        buyer_fee_paid: buyerFee,
        seller_fee_owed: sellerFee,
        platform_revenue: platformRevenue,
        is_promo: settings.is_launch_promo_active,
        was_negotiated: !!offerPrice,
        provider: 'monnify',
        gateway_fee: gatewayFee,
        gateway_total: gatewayTotal,
        payment_reference: paymentReference,
        monnify_transaction_reference: null,
        escrow_created: false,
      },
    });
    if (rowError) throw new Error(`Failed to record checkout: ${rowError.message}`);

    // 9. Return the details the SDK needs. The app opens MonnifySDK with
    // these values (plus the public apiKey + contractCode from its own env).
    // The SDK initializes the payment; the reconcile verifies it.
    return new Response(JSON.stringify({
      success: true,
      paymentReference,
      gatewayTotal,
      gatewayFee,
      customerName,
      customerEmail,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Monnify checkout initialize error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
