// supabase/functions/cancel-escrow/index.ts
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
// The seller-protection window: an order can only be cancelled once it is
// this old. (The error message below already said 24 hours; the old code
// checked 2 minutes.)
const CANCEL_WAIT_HOURS = 24;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Errors safe to show the buyer as-is (validation / business rules).
 * Anything else is an internal failure and the client only gets a generic
 * message — the detail stays in the server logs (SEC-14).
 */
class UserError extends Error {}

/**
 * Credits a wallet with an optimistic lock (same helper as
 * process-withdrawal): the update only applies if the balance is still
 * what we read, so a deposit/withdrawal landing at the same moment can
 * never overwrite the refund.
 */
async function adjustBalance(supabase: any, walletId: string, delta: number) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('balance').eq('id', walletId).single();
    if (error || !w) {
      console.error('[cancel-escrow] wallet lookup failed:', error?.message);
      throw new Error('Wallet not found');
    }
    const { data: updated, error: updateError } = await supabase
      .from('wallets')
      .update({ balance: round2(Number(w.balance) + delta), updated_at: new Date().toISOString() })
      .eq('id', walletId)
      .eq('balance', w.balance)
      .select('id');
    if (updateError) {
      console.error('[cancel-escrow] balance update failed:', updateError.message);
      throw new Error('Failed to update balance');
    }
    if (updated && updated.length > 0) return;
    await sleep(40 * (attempt + 1));
  }
  throw new UserError('Your wallet is busy. Please try again.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new UserError('Missing Authorization header');

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new UserError('Unauthorized access');

    const { transactionRef, reason, note } = await req.json();

    if (!transactionRef) throw new UserError('Transaction reference is required');

    // The buyer must say why. Unknown codes are rejected, so the table only holds known reasons.
    const reasonLabel = REASONS[String(reason)];
    if (!reasonLabel) throw new UserError('Please choose a reason for cancelling.');

    const cleanNote = String(note ?? '').trim().slice(0, NOTE_MAX);
    if (reason === 'other' && cleanNote.length < 3) throw new UserError('Please tell us why you are cancelling.');

    console.log(`[cancel-escrow] start ref=${transactionRef} user=${user.id} reason=${reason}`);

    // C2: only a real paid escrow hold can be cancelled. A pending Monnify
    // checkout row (type 'debit') has the same shape — reference, product,
    // seller, pending status — but no money was ever held for it, so
    // refunding it would mint free withdrawable money.
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', transactionRef)
      .eq('type', 'escrow_hold')
      .single();

    if (txError) {
      console.error('[cancel-escrow] transaction lookup failed:', txError.message);
      throw new UserError('Could not load this transaction. Please try again.');
    }
    if (!transaction) throw new UserError('Transaction not found');
    if (transaction.status !== 'pending') throw new UserError('This transaction has already been processed or cancelled');

    const { data: buyerWallet, error: buyerWalletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('id', transaction.wallet_id)
      .single();
    if (buyerWalletError || buyerWallet?.user_id !== user.id) {
      throw new UserError('You do not have permission to modify this transaction');
    }

    const hoursPassed = (Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60);
    if (hoursPassed < CANCEL_WAIT_HOURS) {
      throw new UserError('You must wait 24 hours before you can cancel this order.');
    }

    const productId = transaction.product_id;
    if (!productId) throw new UserError('Transaction record is missing the product ID.');

    // FULL REFUND: the buyer gets back exactly what the original hold took
    // (item price + platform fee), read from the escrow metadata — never
    // abs(amount) of an arbitrary row. A hold row without that snapshot is
    // refused rather than refunded blind.
    const meta = transaction.metadata ?? {};
    const refundAmount = Number(meta.item_price ?? 0) + Number(meta.buyer_fee_paid ?? 0);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      console.error('[cancel-escrow] refusing refund: escrow metadata has no item_price/buyer_fee_paid', transactionRef);
      throw new UserError('This order cannot be refunded automatically. Contact support.');
    }

    // 1) CLAIM the order before any money moves. The update only matches while the status is still
    //    'pending', so two taps (or two devices) can never both get a refund.
    const { data: claimed, error: claimError } = await supabase
      .from('transactions')
      .update({ status: 'cancelled' })
      .eq('id', transaction.id)
      .eq('status', 'pending')
      .select('id');
    if (claimError) {
      console.error('[cancel-escrow] claim failed:', claimError.message);
      throw new UserError('Could not finalize this cancellation. Please try again.');
    }
    if (!claimed || claimed.length === 0) {
      throw new UserError('This transaction has already been processed or cancelled');
    }

    const revertClaim = async () => {
      const { error } = await supabase.from('transactions').update({ status: 'pending' }).eq('id', transaction.id);
      if (error) console.error('[cancel-escrow] could not revert claim:', error.message);
    };

    // 2) Credit the wallet with an optimistic lock (M19), not a blind
    //    read-modify-write.
    try {
      await adjustBalance(supabase, buyerWallet.id, refundAmount);
    } catch (e) {
      await revertClaim();
      throw new UserError('Failed to process refund: could not update your wallet.');
    }

    // From here the money has moved, so a bookkeeping failure is logged but never reported
    // to the buyer as a failed cancellation.
    // L10: the refund reference used to be a Date.now() substring
    // (guessable). It is now 32 random hex chars (crypto.randomUUID,
    // 122 bits).
    const refundRef = `REF-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;

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
    if (error instanceof UserError) {
      return json({ error: error.message }, 400);
    }
    return json({ error: 'Something went wrong. Please try again.' }, 400);
  }
});
