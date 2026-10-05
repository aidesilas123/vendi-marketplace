"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { keys, fetchAuthUser, refreshAfterOrderWrite } from '@/lib/swr-orders';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { Dropdown } from '@/shared/Dropdown';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { ImageUploader } from '@/shared/ImageUploader/ImageUploader';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, warningOutline, alertCircleOutline } from 'ionicons/icons';
import { DisputeStatus } from './DisputeStatus';

const DISPUTE_REASONS = [
  'Item significantly not as described',
  'Item is defective or broken',
  'Seller did not show up to meetup',
  'Seller refused to hand over item',
  'Suspected fraud or scam',
  'Other'
];

// Lightweight fetcher
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

export default function DisputePage() {
  const params = useSearchParams();
  const txRef = params.get('ref');
  const router = useRouter();

  const { toast, showToast, hideToast } = useToast();

  const [reason, setReason] = useState(DISPUTE_REASONS[0]);
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  
  const [isImagesUploading, setIsImagesUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSubmit = async () => {
    if (!description.trim()) {
      showToast('Please provide a description of the issue', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/raise-dispute`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          transactionRef: txRef,
          reason,
          description,
          images
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit dispute');

      // Purge cached data to reflect the new "disputed" status globally
      refreshAfterOrderWrite(txRef!);
      
      showToast('Dispute raised successfully. Funds frozen.', 'success');
      
      // Delay routing slightly so the toast is visible
      setTimeout(() => router.push('/transactions'), 1500);
      
    } catch (error: any) {
      showToast(error.message, 'error');
      setIsSubmitting(false);
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
        <div className="max-w-2xl mx-auto px-4 mt-8 space-y-8">
          <Skeleton className="w-full h-16 !rounded-2xl" />
          <Skeleton className="w-full h-12 !rounded-2xl" />
          <Skeleton className="w-full h-32 !rounded-2xl" />
        </div>
      </div>
    );
  }

  // --- THE ROUTING FIX ---
  // If the order exists but is ALREADY disputed, show the Status view instead of the form
  if (transaction && transaction.status === 'disputed') {
    return (
      <DisputeStatus 
        transaction={transaction} 
        product={product} 
        onBack={() => router.back()} 
        onDone={() => router.push('/transactions')} 
      />
    );
  }

  // If it's not pending, it's invalid for this page
  if (!transaction || transaction.status !== 'pending') {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-gray-500 pb-20 px-4 text-center bg-gray-50 dark:bg-[#0b1120]">
        <IonIcon icon={warningOutline} className="text-5xl mb-4 text-gray-300 dark:text-gray-600" />
        <p className="text-base font-bold text-gray-800 dark:text-gray-200">Cannot raise dispute.</p>
        <p className="text-xs text-gray-400 mt-1 max-w-[240px]">
          This order is marked as "{transaction?.status || 'unknown'}". Only pending orders can be disputed.
        </p>
        <Button onClick={() => router.back()} className="mt-6 px-8 !py-3 !rounded-full text-sm">Go Back</Button>
      </div>
    );
  }

  const itemPrice = Math.abs(transaction.amount);

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-white pb-32">
      <Toast {...toast} onClose={hideToast} />
      
      {/* HEADER: Solid theme colour, flush to the top, h-12 compact size, strictly frozen */}
      <header className="sticky top-0 left-0 right-0 z-50 w-full bg-gray-50 dark:bg-[#0b1120] pt-safe">
        <div className="flex w-full items-center px-3 h-12 max-w-2xl mx-auto">
          <button onClick={() => router.back()} aria-label="Back" className="p-1.5 -ml-1.5 text-gray-900 dark:text-white active:scale-95 transition-transform rounded-full">
            <IonIcon icon={chevronBackOutline} className="text-2xl block" />
          </button>
          <h1 className="text-[13px] font-black uppercase tracking-widest leading-tight text-gray-900 dark:text-white ml-2">
            Raise Dispute
          </h1>
        </div>
      </header>

      {/* Main Content wrapped in Rubber Band ref */}
      <div ref={bounceRef} className="w-full h-full">
        <div className="max-w-2xl mx-auto px-4 mt-2 space-y-6">
          
          {/* FLOATING HEADER (No BG, No Border) */}
          <div className="px-2 pt-2">
            {product?.title && (
              <h2 className="text-lg font-black leading-snug tracking-tight text-gray-900 dark:text-white mb-1">
                {product.title}
              </h2>
            )}
            <p className="text-2xl font-black text-orange-500 tracking-tight">₦{itemPrice.toLocaleString()}</p>
            <p className="text-gray-500 dark:text-gray-400 font-medium text-[13px] leading-relaxed mt-3">
              If there is a severe issue with your purchase, raising a dispute will immediately freeze the funds in escrow while our admins investigate.
            </p>
          </div>

          <div className="space-y-5 px-1 pt-2">
            {/* Reason Dropdown */}
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                Why are you raising a dispute?
              </label>
              <Dropdown
                ariaLabel="Dispute Reason"
                value={reason}
                options={DISPUTE_REASONS}
                onChange={setReason}
              />
            </div>

            {/* Description TextArea */}
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                Provide details
              </label>
              <textarea
                rows={5}
                placeholder="Explain exactly what happened..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full !bg-transparent border border-orange-500/30 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 px-4 py-3 text-sm rounded-2xl outline-none focus:border-orange-500 transition-colors resize-none leading-snug"
              />
            </div>

            {/* Image Uploader */}
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                Attach proof (optional)
              </label>
              <ImageUploader
                images={images}
                onChange={setImages}
                onError={(msg) => showToast(msg, 'error')}
                onUploadingStateChange={setIsImagesUploading}
                maxImages={3}
              />
            </div>
            
            {/* Warning Message */}
            <div className="flex gap-3 mt-6 mb-2">
              <IonIcon icon={alertCircleOutline} className="text-2xl text-orange-500 flex-shrink-0" />
              <p className="text-xs text-gray-600 dark:text-gray-400 font-bold leading-relaxed">
                False disputes or failure to cooperate with admin investigations may result in a permanent ban from the Vendi platform.
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* BOTTOM FIXED NAV */}
      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-gray-50/95 dark:bg-[#0b1120]/95 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 p-4 pt-3 pb-safe">
        <div className="max-w-2xl mx-auto flex gap-3">
          <Button onClick={() => router.back()} className="flex-1 !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white !py-3.5 !rounded-full text-xs font-bold active:scale-[0.98]">
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!description.trim() || isSubmitting || isImagesUploading}
            className={`flex-[2] !py-3.5 !rounded-full text-xs font-bold transition-all duration-300 ${description.trim() ? '!bg-red-500 active:scale-[0.98]' : '!bg-gray-300 dark:!bg-gray-700 !text-gray-500'}`}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Dispute'}
          </Button>
        </div>
      </div>
    </div>
  );
}