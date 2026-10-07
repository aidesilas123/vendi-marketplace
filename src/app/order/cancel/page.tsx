"use client";

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { keys, fetchAuthUser, refreshAfterOrderWrite } from '@/lib/swr-orders';
import { Button } from '@/shared/Button';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, receiptOutline } from 'ionicons/icons';

// Keep these codes in sync with REASONS in supabase/functions/cancel-escrow/index.ts
const REASONS = [
  { code: 'seller_unresponsive', label: 'Seller is not responding' },
  { code: 'no_meetup', label: 'We could not agree on a meetup' },
  { code: 'item_unavailable', label: 'Item is no longer available' },
  { code: 'changed_mind', label: 'I changed my mind' },
  { code: 'ordered_by_mistake', label: 'I ordered by mistake' },
  { code: 'other', label: 'Other' },
];

const NOTE_MAX = 300;

// Same faded-orange input look as the seller form
const NOTE_CLASSES =
  "w-full !bg-transparent border border-orange-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 px-4 py-3 text-sm rounded-2xl outline-none focus:border-orange-500 transition-colors resize-none";

/* ---------------------------------------------------------------------------
 * Data layer (SWR). The fetcher throws on error so SWR keeps the last good data.
 * Returns null when the order doesn't exist.
 * ------------------------------------------------------------------------- */

type CancelOrder = { transaction: any; productTitle: string | null };

const fetchCancelOrder = async (ref: string): Promise<CancelOrder | null> => {
  // Only the columns this page uses
  const { data: transaction, error } = await supabase
    .from('transactions')
    .select('reference,created_at,status,amount,product_id')
    .eq('reference', ref)
    .maybeSingle();
  if (error) throw error;
  if (!transaction) return null;

  let productTitle: string | null = null;
  if (transaction.product_id) {
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('title')
      .eq('id', transaction.product_id)
      .maybeSingle();
    if (productError) throw productError;
    productTitle = product?.title ?? null;
  }
  return { transaction, productTitle };
};

function CancelOrderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const txRef = searchParams.get('ref');

  // 1) Who is the user?
  const {
    data: user,
    error: authError,
    isLoading: userLoading,
    mutate: mutateAuth,
  } = useSWR(keys.authUser(), fetchAuthUser, { revalidateOnFocus: false });

  // 2) The order. Key is null until the user id and ref are both known.
  const orderKey = keys.orderCancel(user?.id, txRef);
  const {
    data: order,
    error: orderError,
    mutate: mutateOrder,
  } = useSWR(orderKey, () => fetchCancelOrder(txRef!));

  const transaction = order?.transaction ?? null;
  const productTitle = order?.productTitle ?? null;

  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Not signed in -> login
  useEffect(() => {
    if (user === null) router.replace('/login');
  }, [user, router]);

  // Skeleton only when nothing is cached. `undefined` = never loaded, `null` = order doesn't exist.
  const showSkeleton =
    order === undefined &&
    !orderError &&
    !authError &&
    (userLoading || user === null || !!orderKey);

  const hoursPassed = transaction
    ? (Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60)
    : 0;
  const isPending = transaction?.status === 'pending';
  const canCancel = isPending && hoursPassed >= 2 / 60;
  const hoursLeft = Math.max(1, Math.ceil(24 - hoursPassed));

  // The server refunds exactly the amount of the original hold
  const refundAmount = transaction ? Math.abs(Number(transaction.amount)) : 0;

  const noteRequired = reason === 'other';
  const canSubmit = canCancel && !!reason && (!noteRequired || note.trim().length >= 3) && !isSubmitting;

  const retry = () => {
    mutateAuth();
    mutateOrder();
  };

  const handleCancel = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cancel-escrow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transactionRef: transaction.reference,
          reason,
          note: note.trim()
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to cancel order');

      const refunded = Number(data.refundAmount ?? refundAmount);

      // The server confirmed, so update this page's cache straight away (no refetch)...
      mutateOrder(
        (cur) => (cur ? { ...cur, transaction: { ...cur.transaction, status: 'cancelled' } } : cur),
        { revalidate: false }
      );
      // ...then drop the order-details cache and refetch the activity list in the background.
      refreshAfterOrderWrite(transaction.reference, { keep: 'order-cancel' });

      // The toast lives in the layout, so it stays on screen after the page changes.
      showGlobalToast(`Order cancelled. ₦${refunded.toLocaleString()} refunded to your wallet.`, 'success');
      router.replace('/transactions');
    } catch (error: any) {
      showGlobalToast(error?.message || 'Could not cancel this order. Please try again.', 'error');
      setIsSubmitting(false);
    }
  };

  if (showSkeleton) {
    return (
      <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] pb-40 animate-pulse">
        <div className="flex items-center px-3 py-1.5 gap-2">
          <Skeleton className="w-7 h-7 !rounded-full" />
          <Skeleton className="w-28 h-4 !rounded-md" />
        </div>
        <div className="max-w-2xl mx-auto px-5 mt-6 space-y-4">
          <Skeleton className="w-2/3 h-6 !rounded-xl" />
          <Skeleton className="w-1/3 h-8 !rounded-xl" />
          <Skeleton className="w-full h-40 !rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!transaction) {
    // A failed request with nothing cached is different from an order that doesn't exist
    const failed = !!(orderError || authError);
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-gray-500 pb-20 px-4 text-center bg-gray-50 dark:bg-[#0a1120]">
        <IonIcon icon={receiptOutline} className="text-5xl mb-4 text-gray-300 dark:text-gray-600" />
        <p className="text-base font-bold text-gray-800 dark:text-gray-200">
          {failed ? "Couldn't load this order." : 'Order not found.'}
        </p>
        <p className="text-xs text-gray-400 mt-1 max-w-[240px]">
          {failed
            ? 'Check your connection and try again.'
            : 'This order may have been removed or does not exist.'}
        </p>
        {failed && (
          <Button onClick={retry} className="mt-6 px-8 !py-3 !rounded-full">Try Again</Button>
        )}
        <Button onClick={() => router.back()} className={`${failed ? 'mt-3' : 'mt-6'} px-8 !py-3 !rounded-full`}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-40 selection:bg-orange-500/30">

      {isSubmitting && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-14 h-14 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-white font-bold text-base animate-pulse tracking-wide">Cancelling order...</p>
        </div>
      )}

      {/* Header: page colour, no border, no pt-safe (the app shell pads the status bar) */}
      <header className="sticky top-0 z-50 w-full bg-gray-50 dark:bg-[#0a1120]">
        <div className="flex w-full items-center px-3 py-1.5">
          <button onClick={() => router.back()} aria-label="Back" className="p-1.5 -ml-1.5 text-gray-900 dark:text-white active:scale-95 transition-transform">
            <IonIcon icon={chevronBackOutline} className="text-2xl block" />
          </button>
          <div className="min-w-0 ml-1">
            <h1 className="text-[13px] font-bold leading-tight text-gray-900 dark:text-white">Cancel Order</h1>
            <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400 font-medium tracking-wide truncate">{transaction.reference}</p>
          </div>
        </div>
      </header>

      {/* No cards: everything sits directly on the page background */}
      <div className="max-w-2xl mx-auto w-full px-5 mt-6 space-y-8">

        <div>
          <h2 className="text-lg font-bold leading-snug tracking-tight text-gray-900 dark:text-white">
            {productTitle || 'Marketplace Item'}
          </h2>
          <p className="mt-2 text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Refund to your wallet</p>
          <p className="mt-1 text-3xl font-black text-orange-500 tracking-tight">₦{refundAmount.toLocaleString()}</p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            The full amount goes back to your wallet straight away and the item goes back on sale.
          </p>
        </div>

        {!canCancel ? (
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300 leading-relaxed">
            {isPending
              ? `You can cancel this order 24 hours after you placed it. About ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} to go.`
              : 'This order can no longer be cancelled.'}
          </p>
        ) : (
          <>
            <div>
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Why are you cancelling?</h3>

              <div role="radiogroup" aria-label="Reason for cancelling">
                {REASONS.map((r) => {
                  const selected = reason === r.code;
                  return (
                    <button
                      key={r.code}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setReason(r.code)}
                      className="!w-full !flex items-center gap-3 !py-3.5 text-left bg-transparent active:opacity-70 transition-opacity"
                    >
                      <span
                        className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full border-2 transition-colors ${
                          selected ? 'border-orange-500' : 'border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        {selected && <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />}
                      </span>
                      <span className={`text-sm ${selected ? 'font-bold text-gray-900 dark:text-white' : 'font-medium text-gray-600 dark:text-gray-300'}`}>
                        {r.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                {noteRequired ? 'Tell us what happened' : 'Anything else we should know? (optional)'}
              </label>
              <textarea
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Write a short note"
                className={NOTE_CLASSES}
              />
              <p className="text-[11px] text-gray-400 mt-1 text-right">{note.length}/{NOTE_MAX}</p>
            </div>
          </>
        )}
      </div>

      {/* Bottom actions: page colour, no border */}
      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-gray-50 dark:bg-[#0a1120] p-4 pt-3 pb-safe">
        <div className="max-w-2xl mx-auto flex gap-3">
          <button
            onClick={() => router.back()}
            className="flex-1 !bg-gray-100 dark:!bg-gray-800/60 text-gray-600 dark:text-gray-300 font-bold !py-3.5 !rounded-full text-sm transition-all active:scale-[0.98]"
          >
            Keep Order
          </button>
          <button
            onClick={handleCancel}
            disabled={!canSubmit}
            className={`flex-1 font-bold !py-3.5 !rounded-full text-sm transition-all active:scale-[0.98] ${
              canSubmit
                ? '!bg-red-500 text-white'
                : '!bg-red-50 dark:!bg-red-900/20 text-red-300 dark:text-red-800 cursor-not-allowed'
            }`}
          >
            Cancel Order
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CancelOrderPage() {
  return (
    <Suspense fallback={null}>
      <CancelOrderContent />
    </Suspense>
  );
}