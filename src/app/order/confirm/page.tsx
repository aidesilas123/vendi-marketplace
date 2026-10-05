"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { keys, fetchAuthUser, refreshAfterOrderWrite } from '@/lib/swr-orders';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, shieldCheckmarkOutline, warningOutline } from 'ionicons/icons';

// Lightweight fetcher to get just what the Confirm page needs to show
const fetchOrderSlim = async (ref: string) => {
  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference', ref)
    .maybeSingle();
    
  if (txError) throw txError;
  if (!transaction) return null;

  const { data: product } = transaction.product_id
    ? await supabase.from('products').select('id,title').eq('id', transaction.product_id).maybeSingle()
    : { data: null };

  return { transaction, product };
};

export default function ConfirmReceiptPage() {
  const params = useSearchParams();
  const txRef = params.get('ref');
  const router = useRouter();

  const [agreed, setAgreed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 1) SWR Auth Fetching
  const { data: currentUser, error: authError, isLoading: userLoading } = useSWR(
    keys.authUser(), 
    fetchAuthUser, 
    { revalidateOnFocus: false }
  );

  // 2) SWR Order Fetching
  const orderKey = keys.orderDetails(currentUser?.id, txRef);
  const { data: order, error: orderError } = useSWR(orderKey, () => fetchOrderSlim(txRef!));

  const transaction = order?.transaction ?? null;
  const product = order?.product ?? null;

  const showSkeleton = 
    order === undefined && 
    !orderError && 
    !authError && 
    (userLoading || currentUser === null || !!orderKey);

  // 3) iOS Rubber-band effect
  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: !showSkeleton && !!transaction });

  useEffect(() => {
    if (currentUser === null) router.push('/login');
  }, [currentUser, router]);

  const handleConfirm = async () => {
    if (!agreed) return;
    setIsProcessing(true);
    setErrorMsg('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/release-escrow`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionRef: txRef })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to release funds');

      // Purge the stale cached data for this specific order across the app
      refreshAfterOrderWrite(txRef!);

      router.push('/transactions');
    } catch (error: any) {
      setErrorMsg(error.message);
      setIsProcessing(false);
    }
  };

  if (showSkeleton) {
    return (
      <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0b1120] pb-32 animate-pulse">
        <header className="sticky top-0 left-0 right-0 z-50 w-full bg-gray-50 dark:bg-[#0b1120]">
          <div className="flex w-full items-center px-3 h-12">
            <Skeleton className="w-8 h-8 !rounded-full" />
            <Skeleton className="w-32 h-3 ml-3 !rounded-md" />
          </div>
        </header>
        <div className="max-w-2xl mx-auto px-4 mt-8 space-y-8 flex flex-col items-center">
          <Skeleton className="w-20 h-20 !rounded-full" />
          <Skeleton className="w-3/4 h-6 !rounded-md" />
          <Skeleton className="w-full h-24 !rounded-2xl" />
          <Skeleton className="w-full h-16 !rounded-2xl mt-4" />
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-gray-500 pb-20 px-4 text-center bg-gray-50 dark:bg-[#0b1120]">
        <IonIcon icon={warningOutline} className="text-5xl mb-4 text-gray-300 dark:text-gray-600" />
        <p className="text-base font-bold text-gray-800 dark:text-gray-200">Order not found.</p>
        <Button onClick={() => router.back()} className="mt-6 px-8 !py-3 !rounded-full text-sm">Go Back</Button>
      </div>
    );
  }

  const itemPrice = Math.abs(transaction.amount);

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-white pb-32">
      
      {/* HEADER: Solid theme colour, flush to the top, h-12 compact size, strictly frozen */}
      <header className="sticky top-0 left-0 right-0 z-50 w-full bg-gray-50 dark:bg-[#0b1120] pt-safe">
        <div className="flex w-full items-center px-3 h-12 max-w-2xl mx-auto">
          <button onClick={() => router.back()} aria-label="Back" className="p-1.5 -ml-1.5 text-gray-900 dark:text-white active:scale-95 transition-transform rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-2xl block" />
          </button>
          <h1 className="text-[13px] font-black uppercase tracking-widest leading-tight text-gray-900 dark:text-white ml-2">
            Confirm Receipt
          </h1>
        </div>
      </header>

      {/* Main Content wrapped in Rubber Band ref */}
      <div ref={bounceRef} className="w-full h-full">
        <div className="max-w-2xl mx-auto px-4 mt-2 space-y-6">
          
          {/* FLOATING HEADER (No BG, No Border) */}
          <div className="p-2 text-center mt-4">
            <IonIcon icon={shieldCheckmarkOutline} className="text-6xl text-orange-500 mb-3" />
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">Finalize Purchase</h2>
            {product?.title && (
              <p className="text-orange-500 font-black text-lg mb-3 leading-snug">
                {product.title} • ₦{itemPrice.toLocaleString()}
              </p>
            )}
            <p className="text-gray-500 dark:text-gray-400 font-medium text-[13px] leading-relaxed">
              By confirming this receipt, you are verifying that you have met with the seller and thoroughly inspected the item.
            </p>
          </div>

          {/* FLOATING WARNING (No BG, No Border) */}
          <div className="px-2 flex gap-3 mt-4">
            <IonIcon icon={warningOutline} className="text-2xl text-red-500 flex-shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400 font-bold leading-relaxed">
              <span className="uppercase tracking-wider text-[10px] block mb-1 opacity-80">Warning</span>
              Once confirmed, the funds will be permanently disbursed to the seller. This action cannot be undone, and Vendi cannot issue refunds after this point.
            </p>
          </div>

          {/* FLOATING CHECKBOX (No BG, No Border) */}
          <label className="flex items-start gap-3 px-2 py-4 mt-2 cursor-pointer active:opacity-70 transition-opacity">
            <input 
              type="checkbox" 
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="w-5 h-5 mt-0.5 rounded-md border-gray-400 text-orange-500 focus:ring-orange-500 bg-transparent"
            />
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300 leading-relaxed">
              I confirm that I have received and inspected the item, and I authorize the release of funds to the seller.
            </span>
          </label>

          {errorMsg && (
            <p className="text-center text-red-500 font-bold text-sm mt-4 p-2">
              {errorMsg}
            </p>
          )}
        </div>
      </div>

      {/* BOTTOM FIXED NAV */}
      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-gray-50/95 dark:bg-[#0b1120]/95 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 p-4 pt-3 pb-safe">
        <div className="max-w-2xl mx-auto flex gap-3">
          <Button onClick={() => router.back()} className="flex-1 !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white !py-3.5 !rounded-full text-xs font-bold active:scale-[0.98]">
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!agreed || isProcessing}
            className={`flex-[2] !py-3.5 !rounded-full text-xs font-bold transition-all duration-300 ${agreed ? '!bg-orange-500 active:scale-[0.98]' : '!bg-gray-300 dark:!bg-gray-700 !text-gray-500'}`}
          >
            {isProcessing ? 'Processing...' : 'Confirm & Release'}
          </Button>
        </div>
      </div>
    </div>
  );
}