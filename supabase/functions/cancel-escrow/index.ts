import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Keep these codes in sync with REASONS in src/app/order/cancel/page.tsx
const REASONS: Record<string, string> = {
  seller_unresponsive: 'Seller is not responding',
  no_meetup: 'We could not agree on a meetup',
  item_unavailable: 'Item is no longer available',
  changed_mind: 'I changed my mind',
  ordered_by_mistake: 'I ordered by mistake',
  other: 'Other',
};

const NOTE_MAX = 300;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    const { transactionRef, reason, note } = await req.json();

    if (!transactionRef) throw new Error('Transaction reference is required');

    // The buyer must say why. Unknown codes are rejected, so the table only holds known reasons.
    const reasonLabel = REASONS[String(reason)];
    if (!reasonLabel) throw new Error('Please choose a reason for cancelling.');

    const cleanNote = String(note ?? '').trim().slice(0, NOTE_MAX);
    if (reason === 'other' && cleanNote.length < 3) throw new Error('Please tell us why you are cancelling.');

    console.log(`[cancel-escrow] start ref=${transactionRef} user=${user.id} reason=${reason}`);

    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', transactionRef)
      .single();

    if (txError) throw new Error(`Database Error (Transaction): ${txError.message}`);
    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'pending') throw new Error('This transaction has already been processed or cancelled');

    const { data: buyerWallet, error: buyerWalletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('id', transaction.wallet_id)
      .single();
    if (buyerWalletError || buyerWallet?.user_id !== user.id) {
      throw new Error('You do not have permission to modify this transaction');
    }

    const hoursPassed = (Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60);
    if (hoursPassed < 2 / 60) {
      throw new Error('You must wait 24 hours before you can cancel this order.');
    }

    const productId = transaction.product_id;
    if (!productId) throw new Error('Transaction record is missing the product ID.');

    // FULL REFUND: the buyer gets back exactly what the original hold took (item price + platform fee).
    // NOTE: the old cancel dialog said fees were non-refundable, but this function has always
    // refunded 100%. If you want to keep the fee, subtract it here and set fee_retained below.
    const refundAmount = Math.abs(Number(transaction.amount));

    // 1) CLAIM the order before any money moves. The update only matches while the status is still
    //    'pending', so two taps (or two devices) can never both get a refund.
    const { data: claimed, error: claimError } = await supabase
      .from('transactions')
      .update({ status: 'cancelled' })
      .eq('id', transaction.id)
      .eq('status', 'pending')
      .select('id');
    if (claimError) throw new Error(`Failed to finalize cancellation: ${claimError.message}`);
    if (!claimed || claimed.length === 0) {
      throw new Error('This transaction has already been processed or cancelled');
    }

    const revertClaim = async () => {
      const { error } = await supabase.from('transactions').update({ status: 'pending' }).eq('id', transaction.id);
      if (error) console.error('[cancel-escrow] could not revert claim:', error.message);
    };

    // 2) Credit the wallet (balance re-read right before the write)
    const { data: freshWallet, error: freshWalletError } = await supabase
      .from('wallets')
      .select('balance')
      .eq('id', buyerWallet.id)
      .single();
    if (freshWalletError || !freshWallet) {
      await revertClaim();
      throw new Error('Failed to process refund: could not read your wallet.');
    }

    const { error: updateWalletError } = await supabase
      .from('wallets')
      .update({ balance: Number(freshWallet.balance) + refundAmount })
      .eq('id', buyerWallet.id);
    if (updateWalletError) {
      await revertClaim();
      throw new Error(`Failed to process refund: ${updateWalletError.message}`);
    }

    // From here the money has moved, so a bookkeeping failure is logged but never reported
    // to the buyer as a failed cancellation.
    const refundRef = `REF-${Date.now().toString().substring(5)}`;

    const { error: refundTxError } = await supabase.from('transactions').insert({
      wallet_id: buyerWallet.id,
      user_id: user.id,
      amount: refundAmount,
      type: 'refund',
      status: 'successful', // matches your DB enum
      title: `Refund: ${String(transaction.title ?? '').replace('Escrow Hold: ', '')}`,
      reference: refundRef,
      product_id: productId,
      seller_id: transaction.seller_id,
      metadata: {
        original_ref: transactionRef,
        fee_retained: 0,
        refund_reason: `Cancelled by buyer: ${reasonLabel}`,
        cancelled_order: true, // the app shows refund rows with this flag as CANCELLED
        cancel_reason: reason,
      },
    });
    if (refundTxError) console.error('[cancel-escrow] refund row failed:', refundTxError.message);

    const { error: cancellationError } = await supabase.from('order_cancellations').insert({
      transaction_ref: transactionRef,
      refund_ref: refundRef,
      user_id: user.id,
      product_id: String(productId),
      reason_code: reason,
      reason_label: reasonLabel,
      note: cleanNote || null,
      refund_amount: refundAmount,
    });
    if (cancellationError) console.error('[cancel-escrow] cancellation record failed:', cancellationError.message);

    const { error: updateProductError } = await supabase
      .from('products')
      .update({ status: 'ACTIVE' })
      .eq('id', productId);
    if (updateProductError) console.error('[cancel-escrow] could not restore listing:', updateProductError.message);

    console.log(`[cancel-escrow] done ref=${transactionRef} refund=${refundAmount} refundRef=${refundRef}`);

    return json({ success: true, refundAmount, refundRef });

  } catch (error: any) {
    console.error('Cancel Escrow Error:', error?.message ?? error);
    return json({ error: error?.message ?? 'Something went wrong' }, 400);
  }
});