// supabase/functions/process-escrow/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Errors safe to show the buyer as-is (validation / business rules).
 * Anything else is an internal failure and the client only gets a generic
 * message — the detail stays in the server logs (L5).
 */
class UserError extends Error {}

/** Optimistic-lock balance change (same helper as process-withdrawal). */
async function adjustBalance(walletId: string, delta: number, requireSufficient = false) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('balance').eq('id', walletId).single();
    if (error || !w) throw new Error('Wallet not found');
    const next = round2(Number(w.balance) + delta);
    if (requireSufficient && next < 0) throw new UserError('Insufficient verified funds');
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

/** Asks manage-pin to verify the PIN, so the check can't be skipped (H15). */
async function verifyPin(authHeader: string, pin: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/manage-pin`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', pin }),
    signal: AbortSignal.timeout(15000),
  });
  // Reject on a non-2xx AND on a 200 that still carries an error (never trust
  // the status alone for a money decision): a wrong PIN must never pass.
  // manage-pin answers a correct PIN with { success: true, isValid: true }.
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.error || body?.isValid !== true) {
    throw new UserError(body?.error || 'Incorrect PIN');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Bookkeeping so a failure after the debit can give the money back (H16).
  let walletId: string | null = null;
  let debitedAmount = 0;
  let escrowRowId: string | null = null;

  try {
    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new UserError('Missing Authorization header');

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new UserError('Unauthorized access');

    const body = await req.json();
    const productId = body.productId;
    const rawOffer = body.offerPrice;
    const offerPrice = rawOffer === undefined || rawOffer === null || rawOffer === ''
      ? null
      : Number(rawOffer);
    // H15: the wallet PIN is checked on the server for every spend, not
    // just withdrawals. Old app versions without a PIN get 'PIN required'.
    const pin = String(body.pin ?? '');
    if (!pin) throw new UserError('PIN required');
    if (!productId) throw new UserError('Product ID is missing');
    if (offerPrice !== null && (!Number.isFinite(offerPrice) || offerPrice <= 0)) {
      throw new UserError('Enter a valid offer price');
    }

    // 1. Fetch Product
    const { data: product, error: productError } = await supabase.from('products').select('*').eq('id', productId).single();
    if (productError) {
      console.error('[process-escrow] product lookup failed:', productError.message);
      throw new UserError('Product not found');
    }
    if (!product) throw new UserError('Product not found');
    if (product.status === 'SOLD') throw new UserError('This item has already been sold');
    if (product.seller_id === user.id) throw new UserError('You cannot purchase your own item');

    // 2. Determine Final Item Price (Base Price vs Negotiated Offer)
    const basePrice = Number(product.base_price || 0);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      throw new UserError('This item cannot be bought through escrow');
    }
    let itemPrice = basePrice;

    if (offerPrice !== null) {
        const lastPrice = Number(product.last_price || 0);
        if (lastPrice === 0) throw new UserError('This item is not open to negotiation');
        if (offerPrice < lastPrice) throw new UserError(`Offer is below the seller's minimum price of ₦${lastPrice}`);
        if (offerPrice > basePrice) throw new UserError(`Offer cannot exceed the base price`);
        itemPrice = offerPrice; // Valid offer accepted!
    }

    // 3. Fetch Platform Settings & Calculate Math (No Splitting)
    const { data: settings, error: settingsError } = await supabase.from('platform_settings').select('*').eq('id', 1).single();
    if (settingsError || !settings) {
      console.error('[process-escrow] settings lookup failed:', settingsError?.message);
      throw new UserError('Could not load platform settings. Please try again.');
    }

    let buyerFee = 0;
    let sellerFee = 0;
    let platformRevenue = 0;

    if (!settings.is_launch_promo_active) {
        const platformFeePercent = Number(settings.platform_fee_percentage) || 0;

        // Full percentage applied to BOTH sides separately, exactly as discussed
        buyerFee = Math.floor(itemPrice * (platformFeePercent / 100));
        sellerFee = Math.floor(itemPrice * (platformFeePercent / 100));
        platformRevenue = buyerFee + sellerFee;
    }

    const totalCharge = itemPrice + buyerFee;

    // 4. PIN is verified HERE on the server, before any money moves.
    await verifyPin(authHeader, pin);

    // 5. Fetch Wallet & Verify Total Balance
    const { data: wallet, error: walletError } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
    if (walletError) {
      console.error('[process-escrow] wallet lookup failed:', walletError.message);
      throw new UserError('Wallet not found');
    }
    if (!wallet) throw new UserError('Wallet not found');
    walletId = wallet.id;

    if (Number(wallet.balance) < totalCharge) {
        throw new UserError(`Insufficient funds. You need ₦${totalCharge.toLocaleString()} to cover the item and escrow fee.`);
    }

    // 6. Lock Funds with an optimistic lock (C7): the debit only applies if
    //    the balance is still what we read, so two simultaneous escrows can
    //    never spend the same money twice.
    await adjustBalance(wallet.id, -totalCharge, true);
    debitedAmount = totalCharge;

    // L10: the reference must not be guessable — it used to be built from
    // Date.now(), so anyone who knew roughly when a payment happened could
    // enumerate references. The suffix is now 32 random hex chars
    // (crypto.randomUUID, 122 bits); the ESC- prefix stays.
    const orderRef = `ESC-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;

    // 7. Record Transaction with the exact JSON snapshot. If this throws,
    //    the catch block credits the wallet back (H16).
    const { data: escrowRow, error: txError } = await supabase.from('transactions').insert({
      wallet_id: wallet.id,
      user_id: user.id,
      product_id: product.id,
      seller_id: product.seller_id,
      amount: -totalCharge,
      type: 'escrow_hold',
      status: 'pending',
      title: `Escrow Hold: ${product.title}`,
      reference: orderRef,
      metadata: {
          item_price: itemPrice,
          buyer_fee_paid: buyerFee,
          seller_fee_owed: sellerFee,
          platform_revenue: platformRevenue,
          is_promo: settings.is_launch_promo_active,
          was_negotiated: offerPrice !== null,
          // L9: wallet-funded escrows are already settled — the buyer
          // funded their wallet earlier, so there is no Monnify
          // collection still to settle. release-escrow reads this to
          // give the payout the same-day settlement time instead of
          // the card (next-day) default.
          payment_method: 'wallet',
      }
    }).select('id').single();
    if (txError || !escrowRow) {
      console.error('[process-escrow] escrow insert failed:', txError?.message);
      throw new Error('Failed to record transaction');
    }
    escrowRowId = escrowRow.id;

    // 8. Claim the product as SOLD — only if it is still for sale (C7). If
    //    another buyer took it in the meantime this touches 0 rows and the
    //    money goes straight back (H16); the listing is never sold twice.
    const { data: claimedProduct, error: updateProductError } = await supabase
      .from('products')
      .update({ status: 'SOLD' })
      .eq('id', product.id)
      .neq('status', 'SOLD')
      .select('id');
    if (updateProductError) {
      console.error('[process-escrow] product claim failed:', updateProductError.message);
      throw new Error('Failed to update product status');
    }
    if (!claimedProduct || claimedProduct.length === 0) {
      throw new UserError('This item has already been sold');
    }

    // Return reference key exactly as the frontend expects it
    return new Response(JSON.stringify({ success: true, reference: orderRef }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
    });

  } catch (error: any) {
    console.error('Escrow Error:', error);
    // H16: the debit already happened — give the money back before reporting
    // the failure. If a hold row was recorded, void it FIRST so the same
    // money can never be refunded twice (once here, once via cancel-escrow).
    // If the void fails, the money stays held in escrow and the buyer can
    // still recover it through cancel-escrow — never credit blindly on top
    // of a live hold row.
    if (debitedAmount > 0 && walletId) {
      try {
        if (escrowRowId) {
          const { data: voided } = await supabase
            .from('transactions')
            .update({ status: 'cancelled' })
            .eq('id', escrowRowId)
            .eq('status', 'pending')
            .select('id');
          if (!voided || voided.length === 0) {
            console.error('[process-escrow] REFUND BLOCKED — could not void hold row, money stays in escrow:', escrowRowId);
          } else {
            await adjustBalance(walletId, debitedAmount);
          }
        } else {
          await adjustBalance(walletId, debitedAmount);
        }
      } catch (refundError) {
        console.error('[process-escrow] REFUND FAILED — reconcile manually:', walletId, debitedAmount, refundError);
      }
    }
    if (error instanceof UserError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
      });
    }
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
    });
  }
});
