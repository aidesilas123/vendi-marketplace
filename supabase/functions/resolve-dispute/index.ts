// supabase/functions/resolve-dispute/index.ts
//
// NEW — admin-only dispute resolution. There was no code for this before:
// frozen money was moved by hand in the dashboard, with no exactly-once
// guard, no audit row, and no check that the resolver is an admin.
//
// POST { transaction_ref, resolution: 'release' | 'refund' } with the
// admin's JWT. Requires users.is_admin = true for the caller.
//   'release' — the seller was right: the escrow payout (item_price -
//     seller_fee_owed) is credited to the seller's pending_balance.
//   'refund' — the buyer was right: item_price + buyer_fee_paid goes back
//     to the buyer's wallet, and the listing returns to ACTIVE.
// Both paths write ledger rows and mark the dispute resolved (with
// resolved_by / resolved_at) and the transaction successful / cancelled.
//
// Claim-first: the transaction is claimed disputed → processing BEFORE any
// money moves, and the dispute row is marked resolved (conditionally, only
// from 'open' / 'under_review') before the payout. A failure before the
// money moves reverts both claims so an admin retry can run clean; a
// failure after the money moves is logged loudly for manual reconciliation
// and never silently retried (a retry could double-pay).
//
// SCAFFOLDING: run `npx supabase functions new resolve-dispute` first,
// then replace the generated index.ts with this file (no deno.json is
// shipped here — the user scaffolds functions with the CLI).
// ASSUMPTION: disputes has resolved_by / resolved_at columns. If they do
// not exist yet, the resolve update errors and the function aborts safely
// (no money moves) — add the columns before use. TEST BEFORE USE: this is
// new code with no production history.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Monnify settlement (copied from release-escrow): a bank transfer settles
// the same day by 22:00 WAT, a card the next day (T+1, excluding weekends).
// Disputes are usually resolved days after payment, so available_at is
// normally already in the past — the payout is withdrawable at once.
function settlementTime(paymentMethod: string, paidAt: Date): Date {
  const isTransfer = String(paymentMethod ?? '').toUpperCase().includes('TRANSFER');
  if (isTransfer) {
    const today = new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate(), 21, 0, 0));
    return paidAt.getTime() >= today.getTime() ? paidAt : today;
  }
  const next = new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate() + 1, 21, 0, 0));
  const day = next.getUTCDay();
  if (day === 6) next.setUTCDate(next.getUTCDate() + 2);
  else if (day === 0) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** Optimistic-lock balance change (same helper as process-withdrawal). */
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

/** Optimistic-lock credit to a seller's pending_balance. */
async function adjustPendingBalance(walletId: string, delta: number) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: w, error } = await supabase.from('wallets').select('pending_balance').eq('id', walletId).single();
    if (error || !w) throw new Error('Seller wallet not found');
    const { data: updated, error: updateError } = await supabase
      .from('wallets')
      .update({ pending_balance: round2(Number(w.pending_balance ?? 0) + delta), updated_at: new Date().toISOString() })
      .eq('id', walletId)
      .eq('pending_balance', w.pending_balance ?? 0)
      .select('id');
    if (updateError) throw new Error('Failed to credit seller');
    if (updated && updated.length > 0) return;
    await sleep(40 * (attempt + 1));
  }
  throw new Error('Seller wallet is busy. Please try again.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Bookkeeping: what this call has already changed, so a failure can
  // revert the claims (but never un-move money that already moved).
  let txClaimed = false;
  let disputeResolved = false;
  let disputeOriginalStatus: string | null = null;
  let creditedPending = false;
  let creditedBalance = false;
  // Set once the ledger row for the money move exists. A reversal is only
  // safe while the move has NO ledger row — once the row is written, the
  // money must stay moved and a human reconciles instead.
  let ledgerWritten = false;
  let sellerWalletId: string | null = null;
  let buyerWalletId: string | null = null;
  let payoutAmount = 0;
  let refundAmount = 0;
  let transactionRef = '';
  let transactionId: string | null = null;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    // Admin-only: the caller's users row must have is_admin = true.
    const { data: caller, error: callerError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (callerError || !caller?.is_admin) {
      return json({ success: false, error: 'Admin access required' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    transactionRef = String(body?.transaction_ref ?? '');
    const resolution = String(body?.resolution ?? '');
    if (!transactionRef) throw new Error('transaction_ref is required');
    if (resolution !== 'release' && resolution !== 'refund') {
      throw new Error("resolution must be 'release' or 'refund'");
    }

    // Load the escrow and its dispute. Only a disputed escrow can be resolved.
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', transactionRef)
      .eq('type', 'escrow_hold')
      .single();
    if (txError || !transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'disputed') {
      throw new Error(`Cannot resolve a transaction that is ${transaction.status}`);
    }
    transactionId = transaction.id;

    const { data: dispute, error: disputeError } = await supabase
      .from('disputes')
      .select('status')
      .eq('transaction_ref', transactionRef)
      .maybeSingle();
    if (disputeError || !dispute) throw new Error('Dispute not found');
    disputeOriginalStatus = dispute.status;

    const meta = transaction.metadata ?? {};
    payoutAmount = Number(meta.item_price ?? 0) - Number(meta.seller_fee_owed ?? 0);
    refundAmount = Number(meta.item_price ?? 0) + Number(meta.buyer_fee_paid ?? 0);
    const amount = resolution === 'release' ? payoutAmount : refundAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('This escrow has an invalid amount. Contact support.');
    }

    // 1) CLAIM the escrow FIRST (disputed → processing). A second admin
    //    (or a double-tap) resolving the same dispute aborts here.
    const { data: claimed, error: claimError } = await supabase
      .from('transactions')
      .update({ status: 'processing' })
      .eq('id', transaction.id)
      .eq('status', 'disputed')
      .select('id');
    if (claimError) throw new Error(`Failed to claim dispute: ${claimError.message}`);
    if (!claimed || claimed.length === 0) {
      throw new Error('This dispute is already being resolved');
    }
    txClaimed = true;

    const revertClaims = async () => {
      if (disputeResolved) {
        const { error } = await supabase
          .from('disputes')
          .update({ status: disputeOriginalStatus, resolved_by: null, resolved_at: null, updated_at: new Date().toISOString() })
          .eq('transaction_ref', transactionRef);
        if (error) console.error('[resolve-dispute] could not revert dispute resolution:', error.message);
        disputeResolved = false;
      }
      if (txClaimed) {
        const { error } = await supabase
          .from('transactions')
          .update({ status: 'disputed' })
          .eq('id', transaction.id);
        if (error) console.error('[resolve-dispute] could not revert claim:', error.message);
        txClaimed = false;
      }
    };

    // 2) Mark the dispute resolved BEFORE any money moves. If the row is
    //    already resolved (or the resolved_by/resolved_at columns do not
    //    exist yet), this fails and the claims revert — no money moves.
    const nowIso = new Date().toISOString();
    const { data: resolved, error: resolveError } = await supabase
      .from('disputes')
      .update({ status: 'resolved', resolved_by: user.id, resolved_at: nowIso, updated_at: nowIso })
      .eq('transaction_ref', transactionRef)
      .in('status', ['open', 'under_review'])
      .select('id');
    if (resolveError) throw new Error(`Failed to mark dispute resolved: ${resolveError.message}`);
    if (!resolved || resolved.length === 0) {
      await revertClaims();
      throw new Error('This dispute has already been resolved');
    }
    disputeResolved = true;

    try {
      if (resolution === 'release') {
        // Seller was right: pay the seller from escrow.
        const sellerId = transaction.seller_id;
        if (!sellerId) throw new Error('Transaction record is missing the seller ID.');
        const paymentMethod = String(meta.payment_method ?? '');
        const availableAt = settlementTime(paymentMethod, new Date(transaction.created_at));

        let { data: sellerWallet, error: sellerWalletError } = await supabase.from('wallets').select('*').eq('user_id', sellerId).single();
        if (!sellerWallet || sellerWalletError) {
          const { data: newWallet, error: createError } = await supabase.from('wallets').insert({ user_id: sellerId, balance: 0 }).select().single();
          if (createError) throw new Error(`Could not locate or create seller wallet: ${createError.message}`);
          sellerWallet = newWallet;
        }
        sellerWalletId = sellerWallet.id;

        await adjustPendingBalance(sellerWallet.id, payoutAmount);
        creditedPending = true;

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
          title: `Payment Received: ${String(transaction.title ?? '').replace('Escrow Hold: ', '')}`,
          reference: creditRef,
          metadata: {
            original_ref: transactionRef,
            item_price: Number(meta.item_price ?? 0),
            fee_deducted: Number(meta.seller_fee_owed ?? 0),
            payment_method: paymentMethod || null,
            available_at: availableAt.toISOString(),
            bucket: 'pending',
            dispute_resolution: 'release',
            resolved_by: user.id,
          },
        });
        if (creditTxError) throw new Error(`Failed to record seller income: ${creditTxError.message}`);
        ledgerWritten = true;

        const { data: done, error: doneError } = await supabase
          .from('transactions')
          .update({ status: 'successful' })
          .eq('id', transaction.id)
          .eq('status', 'processing')
          .select('id');
        if (doneError || !done || done.length === 0) {
          console.error('[resolve-dispute] CRITICAL — seller paid but escrow could not be marked successful; reconcile manually:', transactionRef);
          throw new Error('Failed to finalize the release. The payout was recorded — reconcile manually before retrying.');
        }
        txClaimed = false;
        return json({ success: true, resolution: 'release', payout: payoutAmount });
      }

      // Buyer was right: refund the buyer from escrow.
      const { data: buyerWallet, error: buyerWalletError } = await supabase
        .from('wallets')
        .select('id')
        .eq('id', transaction.wallet_id)
        .single();
      if (buyerWalletError || !buyerWallet) throw new Error('Buyer wallet not found');
      buyerWalletId = buyerWallet.id;

      await adjustBalance(buyerWallet.id, refundAmount);
      creditedBalance = true;

      const refundRef = `RFND-${transactionRef}`;
      const { error: refundTxError } = await supabase.from('transactions').insert({
        wallet_id: buyerWallet.id,
        user_id: transaction.user_id,
        amount: refundAmount,
        type: 'refund',
        status: 'successful',
        title: `Refund: ${String(transaction.title ?? '').replace('Escrow Hold: ', '')}`,
        reference: refundRef,
        product_id: transaction.product_id,
        seller_id: transaction.seller_id,
        metadata: {
          original_ref: transactionRef,
          dispute_resolution: 'refund',
          resolved_by: user.id,
        },
      });
      if (refundTxError) throw new Error(`Failed to record refund: ${refundTxError.message}`);
      ledgerWritten = true;

      // The item returns to sale (best effort — never blocks the refund).
      if (transaction.product_id) {
        const { error: productError } = await supabase
          .from('products')
          .update({ status: 'ACTIVE' })
          .eq('id', transaction.product_id);
        if (productError) console.error('[resolve-dispute] could not restore listing:', productError.message);
      }

      const { data: done, error: doneError } = await supabase
        .from('transactions')
        .update({ status: 'cancelled' })
        .eq('id', transaction.id)
        .eq('status', 'processing')
        .select('id');
      if (doneError || !done || done.length === 0) {
        console.error('[resolve-dispute] CRITICAL — buyer refunded but escrow could not be marked cancelled; reconcile manually:', transactionRef);
        throw new Error('Failed to finalize the refund. The refund was recorded — reconcile manually before retrying.');
      }
      txClaimed = false;
      return json({ success: true, resolution: 'refund', refund: refundAmount });
    } catch (e) {
      // A failure after the money moved is NOT auto-reverted: reverting
      // the claims would let a retry pay twice. Only reverse money that
      // moved WITHOUT a ledger row behind it (credit succeeded, ledger
      // insert failed), then revert the claims. Once the ledger row is
      // written, the money stays moved and the row stays 'processing' with
      // the dispute resolved, for manual reconciliation.
      if (creditedPending && !ledgerWritten && sellerWalletId) {
        try {
          await adjustPendingBalance(sellerWalletId, -payoutAmount);
          creditedPending = false;
        } catch (reverseError) {
          console.error('[resolve-dispute] CRITICAL — payout credited but could not be reversed; reconcile manually:', transactionRef, reverseError);
        }
      }
      if (creditedBalance && !ledgerWritten && buyerWalletId) {
        try {
          await adjustBalance(buyerWalletId, -refundAmount);
          creditedBalance = false;
        } catch (reverseError) {
          console.error('[resolve-dispute] CRITICAL — refund credited but could not be reversed; reconcile manually:', transactionRef, reverseError);
        }
      }
      // If money was taken back (or never moved), the claims can be
      // reverted safely; if money stayed moved, the dispute row stays
      // resolved and the transaction stays processing for manual fix.
      if (!creditedPending && !creditedBalance) await revertClaims();
      throw e;
    }
  } catch (error: any) {
    console.error('[resolve-dispute] error:', error?.message ?? error);
    return json({ success: false, error: error?.message ?? 'Could not resolve dispute' }, 400);
  }
});
