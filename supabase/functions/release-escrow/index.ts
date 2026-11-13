// supabase/functions/release-escrow/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Monnify settlement: a bank transfer settles the same day by 22:00 WAT,
// a card settles the next day (T+1, excluding weekends), and a wallet-funded
// escrow settles the same day (the money was already settled when the buyer
// funded their wallet). WAT is UTC+1, so 22:00 WAT = 21:00 UTC. `paidAt` is
// when the buyer paid (the escrow row's created_at). Returns when this payout
// becomes withdrawable.
function settlementTime(paymentMethod: string, paidAt: Date): Date {
  const method = String(paymentMethod ?? '').toUpperCase();
  // L9: wallet-funded escrows (process-escrow stamps payment_method:
  // 'wallet'). The money was already settled when the buyer funded their
  // wallet, so there is no Monnify collection still to settle — same day
  // 21:00 UTC, or now if that has already passed. Before this branch,
  // wallet escrows fell through to the card path and sellers waited an
  // extra day for money that was already cleared.
  if (method === 'WALLET') {
    const today = new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate(), 21, 0, 0));
    return paidAt.getTime() >= today.getTime() ? paidAt : today;
  }
  const isTransfer = method.includes('TRANSFER');
  if (isTransfer) {
    // Today 21:00 UTC. Already past it? The transfer has settled — available now.
    const today = new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate(), 21, 0, 0));
    return paidAt.getTime() >= today.getTime() ? paidAt : today;
  }
  // Card (and anything else): next day 21:00 UTC, rolling past the weekend.
  const next = new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate() + 1, 21, 0, 0));
  const day = next.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 6) next.setUTCDate(next.getUTCDate() + 2);
  else if (day === 0) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Errors safe to show the buyer as-is (validation / business rules).
 * Anything else is an internal failure and the client only gets a generic
 * message — the detail stays in the server logs (SEC-14).
 */
class UserError extends Error {}

/**
 * Credits a seller's pending_balance with an optimistic lock: the update
 * only applies if pending_balance is still what we read, so two concurrent
 * releases can never both add the payout.
 */
async function adjustPendingBalance(supabase: any, walletId: string, delta: number) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('pending_balance').eq('id', walletId).single();
    if (error || !w) {
      console.error('[release-escrow] seller wallet lookup failed:', error?.message);
      throw new Error('Seller wallet not found');
    }
    const { data: updated, error: updateError } = await supabase
      .from('wallets')
      .update({ pending_balance: round2(Number(w.pending_balance ?? 0) + delta), updated_at: new Date().toISOString() })
      .eq('id', walletId)
      .eq('pending_balance', w.pending_balance ?? 0)
      .select('id');
    if (updateError) {
      console.error('[release-escrow] pending_balance update failed:', updateError.message);
      throw new Error('Failed to credit seller');
    }
    if (updated && updated.length > 0) return;
    await sleep(40 * (attempt + 1));
  }
  throw new UserError('Seller wallet is busy. Please try again.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    if (!authHeader) throw new UserError('Missing Authorization header');
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new UserError('Unauthorized access');

    const body = await req.json();
    const { transactionRef } = body;

    if (!transactionRef) throw new UserError('Transaction reference is required');

    // C3: only a real paid escrow hold can be released. A pending Monnify
    // checkout row (type 'debit') carries seller_id, item_price and
    // seller_fee_owed in its metadata too — releasing it would pay the
    // seller for an order nobody paid for.
    const { data: transaction, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .eq('reference', transactionRef)
        .eq('type', 'escrow_hold')
        .single();

    if (txError) {
      console.error('[release-escrow] transaction lookup failed:', txError.message);
      throw new UserError('Could not load this transaction. Please try again.');
    }
    if (!transaction) throw new UserError('Transaction not found');
    if (transaction.status !== 'pending') throw new UserError('This transaction has already been processed or cancelled');

    const { data: buyerWallet, error: buyerWalletError } = await supabase.from('wallets').select('user_id').eq('id', transaction.wallet_id).single();
    if (buyerWalletError || buyerWallet?.user_id !== user.id) {
        throw new UserError('You do not have permission to release these funds');
    }

    const sellerId = transaction.seller_id;
    if (!sellerId) throw new UserError('Transaction record is missing the seller ID.');

    const metadata = transaction.metadata || {};
    const itemPrice = Number(metadata.item_price || 0);
    const sellerFee = Number(metadata.seller_fee_owed || 0);
    const payoutAmount = itemPrice - sellerFee;
    if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      throw new UserError('This escrow has an invalid payout amount. Contact support.');
    }

    // C8: CLAIM the escrow FIRST, before any money moves. The update only
    // matches while the status is still 'pending', so a double-tap (or two
    // devices) can never both pay the seller. If anything below fails, the
    // claim is reverted so the buyer can retry — the money never moves
    // without a live claim behind it.
    const { data: claimed, error: claimError } = await supabase
      .from('transactions')
      .update({ status: 'successful' })
      .eq('id', transaction.id)
      .eq('status', 'pending')
      .select('id');
    if (claimError) {
      console.error('[release-escrow] claim failed:', claimError.message);
      throw new UserError('Could not claim this escrow. Please try again.');
    }
    if (!claimed || claimed.length === 0) {
      throw new UserError('This transaction has already been processed or cancelled');
    }
    const revertClaim = async () => {
      const { error } = await supabase.from('transactions').update({ status: 'pending' }).eq('id', transaction.id);
      if (error) console.error('[release-escrow] could not revert claim:', error.message);
    };

    // Tracks whether the seller's pending_balance was already credited, so
    // a later failure can take it back instead of leaving a payout with no
    // escrow behind it.
    let credited = false;
    let sellerWallet: any = null;

    try {
      // The payout is HELD until the underlying Monnify collection settles —
      // it is not withdrawable before then. Only `balance` can be withdrawn,
      // so a seller can never pull out unsettled money.
      const paymentMethod = String(metadata.payment_method ?? '');
      const availableAt = settlementTime(paymentMethod, new Date(transaction.created_at));

      const { data: foundWallet, error: sellerWalletError } = await supabase.from('wallets').select('*').eq('user_id', sellerId).single();
      sellerWallet = foundWallet;

      if (!sellerWallet || sellerWalletError) {
          const { data: newWallet, error: createWalletError } = await supabase.from('wallets').insert({ user_id: sellerId, balance: 0 }).select().single();
          if (createWalletError) {
            console.error('[release-escrow] could not create seller wallet:', createWalletError.message);
            throw new UserError('Could not locate the seller wallet. Please try again.');
          }
          sellerWallet = newWallet;
      }

      await adjustPendingBalance(supabase, sellerWallet.id, payoutAmount);
      credited = true;

      // L10: the credit reference used to be a Date.now() substring
      // (guessable). It is now 32 random hex chars (crypto.randomUUID,
      // 122 bits).
      const creditRef = `REL-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;

      const { error: creditTxError } = await supabase.from('transactions').insert({
          wallet_id: sellerWallet.id,
          user_id: sellerId,
          amount: payoutAmount,
          type: 'credit',
          status: 'successful',
          title: `Payment Received: ${transaction.title.replace('Escrow Hold: ', '')}`,
          reference: creditRef,
          metadata: {
              original_ref: transactionRef,
              item_price: itemPrice,
              fee_deducted: sellerFee,
              payment_method: paymentMethod || null,
              available_at: availableAt.toISOString(),
              bucket: 'pending',
          }
      });
      if (creditTxError) {
        console.error('[release-escrow] seller income insert failed:', creditTxError.message);
        throw new UserError('Could not record the seller payout. Please try again.');
      }
    } catch (e) {
      // Money did not fully move: take back any pending credit first, then
      // give the escrow back so the buyer can retry.
      if (credited) {
        try {
          await adjustPendingBalance(supabase, sellerWallet!.id, -payoutAmount);
        } catch (reverseError) {
          console.error('[release-escrow] CRITICAL: payout credited but could not be reversed — reconcile manually:', transactionRef, reverseError);
        }
      }
      await revertClaim();
      throw e;
    }

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 
    });

  } catch (error: any) {
    console.error('Release Escrow Error:', error);
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
