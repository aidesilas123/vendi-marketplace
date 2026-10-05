"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { keys, fetchAuthUser } from '@/lib/swr-orders';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Button } from '@/shared/Button';
import { ImageViewer } from '@/shared/ImageViewer/ImageViewer';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { effectiveTxStatus } from '@/lib/txStatus';
import { IonIcon } from '@ionic/react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  chevronBackOutline,
  callOutline,
  star,
  schoolOutline,
  locationOutline,
  timeOutline,
  logoWhatsapp,
  chatbubbleEllipsesOutline,
  expandOutline,
  imageOutline,
  receiptOutline
} from 'ionicons/icons';

/* ---------------------------------------------------------------------------
 * Data layer (SWR)
 * Fetchers THROW on error so SWR keeps showing the last good data.
 * ------------------------------------------------------------------------- */

type OrderBundle = { transaction: any; product: any | null; seller: any | null };

// Only the columns this page renders. The transaction keeps '*' because
// effectiveTxStatus() decides the displayed status from fields not visible here.
const PRODUCT_COLUMNS = 'id,title,images,university_id,campus,specific_location,specifications,description';
const SELLER_COLUMNS = 'id,full_name,avatar_url,is_verified,average_rating,total_reviews,whatsapp';

const parseImages = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [raw];
    } catch {
      return [raw];
    }
  }
  return [];
};

// Returns null when the order doesn't exist, throws when the request itself fails
const fetchOrder = async (ref: string): Promise<OrderBundle | null> => {
  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference', ref)
    .maybeSingle();
  if (txError) throw txError;
  if (!transaction) return null;

  // Product and seller only depend on the transaction, so fetch them in parallel
  const [productRes, sellerRes] = await Promise.all([
    transaction.product_id
      ? supabase.from('products').select(PRODUCT_COLUMNS).eq('id', transaction.product_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    transaction.seller_id
      ? supabase.from('users').select(SELLER_COLUMNS).eq('id', transaction.seller_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (productRes.error) throw productRes.error;
  if (sellerRes.error) throw sellerRes.error;

  return {
    transaction,
    product: productRes.data ? { ...productRes.data, images: parseImages(productRes.data.images) } : null,
    seller: sellerRes.data ?? null,
  };
};

export default function OrderDetails() {
  const searchParams = useSearchParams();
  const txRef = searchParams.get('ref') || searchParams.get('id');
  const router = useRouter();

  // 1) Who is the user? (global per-session, no need to refetch on every focus)
  const {
    data: currentUser,
    error: authError,
    isLoading: userLoading,
    mutate: mutateAuth,
  } = useSWR(keys.authUser(), fetchAuthUser, { revalidateOnFocus: false });

  // 2) The order. Key is null until the user id and ref are both known, so nothing fetches early.
  const orderKey = keys.orderDetails(currentUser?.id, txRef);
  const {
    data: order,
    error: orderError,
    mutate: mutateOrder,
  } = useSWR(orderKey, () => fetchOrder(txRef!));

  const transaction = order?.transaction ?? null;
  const product = order?.product ?? null;
  const seller = order?.seller ?? null;

  // Not signed in -> login
  useEffect(() => {
    if (currentUser === null) router.push('/login');
  }, [currentUser, router]);

  // Spinner/skeleton only when nothing is cached. `order === undefined` means "never loaded";
  // `null` means "loaded, and the order doesn't exist". Once visited, the page shows instantly
  // from cache and refreshes quietly in the background.
  const showSkeleton =
    order === undefined &&
    !orderError &&
    !authError &&
    (userLoading || currentUser === null || !!orderKey);

  const { toast, showToast, hideToast } = useToast();

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Rubber-band bounce. The wrapper only exists once the order has loaded, so `ready`
  // delays attaching the listeners until then. Fixed bars stay outside the wrapper.
  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef, { ready: !showSkeleton && !!transaction });

  // The status this order should DISPLAY (refund rows from a cancelled order count as cancelled)
  const status = transaction ? effectiveTxStatus(transaction) : '';
  const isCancelled = status === 'cancelled';
  const isCompleted = status === 'successful' || status === 'completed';
  const contactLocked = isCompleted || isCancelled;

  const hoursPassed = transaction ? (new Date().getTime() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60) : 0;
  const canCancel = hoursPassed >= 24 && status === 'pending';

  const images: string[] = product?.images?.length > 0 ? product.images : [];

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) =>
    setCurrentImageIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.offsetWidth));

  const openViewer = (index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  };

  // Clipboard API can be missing/blocked in webviews, so fall back to execCommand
  const writeToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through to legacy copy */ }

    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      el.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  };

  const copyPhoneNumber = async () => {
    if (contactLocked || !seller?.whatsapp) return;
    const ok = await writeToClipboard(seller.whatsapp);
    if (ok) {
      // Light tap confirms the copy; harmlessly ignored where haptics aren't supported (web)
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      showToast('Phone number copied');
    }
    else showToast('Could not copy number', 'error');
  };

  const openWhatsApp = () => {
    if (contactLocked || !seller?.whatsapp) return;
    const text = encodeURIComponent(`Hi ${seller.full_name}, I just purchased your ${product?.title} on Vendi. I'd like to arrange a meetup to inspect and pick it up!`);
    const formattedPhone = seller.whatsapp.startsWith('0') ? '234' + seller.whatsapp.slice(1) : seller.whatsapp;
    window.open(`https://wa.me/${formattedPhone}?text=${text}`, '_blank');
  };

  // Cancelling now happens on its own page, where the buyer says why and gets the refund
  const goToCancelPage = () => {
    router.push(`/order/cancel?ref=${encodeURIComponent(transaction.reference)}`);
  };

  const retry = () => {
    mutateAuth();
    mutateOrder();
  };

  if (showSkeleton) {
    return (
      <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] pb-32 animate-pulse">
        {/* No pt-safe: the app shell already pads the status bar */}
        <div className="w-full bg-gray-50 dark:bg-[#0a1120]">
          <div className="flex items-center justify-between px-3 py-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="w-7 h-7 !rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="w-24 h-3 !rounded-md" />
                <Skeleton className="w-16 h-2 !rounded-md" />
              </div>
            </div>
            <Skeleton className="w-20 h-4 !rounded-full" />
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 mt-2 space-y-6">
          <Skeleton className="w-full aspect-[4/3] !rounded-3xl" />
          <div className="space-y-3 px-1">
            <Skeleton className="w-3/4 h-6 !rounded-xl" />
            <Skeleton className="w-1/3 h-7 !rounded-xl" />
            <Skeleton className="w-full h-10 !rounded-2xl mt-4" />
          </div>
          <Skeleton className="w-full h-24 !rounded-2xl" />
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
          {failed ? "Couldn't load this order." : 'Order Details not found.'}
        </p>
        <p className="text-xs text-gray-400 mt-1 max-w-[240px]">
          {failed
            ? 'Check your connection and try again.'
            : 'This transaction may have been removed or does not exist.'}
        </p>
        {failed && (
          <Button onClick={retry} className="mt-6 px-8 !py-3 !rounded-full">Try Again</Button>
        )}
        <Button onClick={() => router.back()} className={`${failed ? 'mt-3' : 'mt-6'} px-8 !py-3 !rounded-full`}>Go Back</Button>
      </div>
    );
  }

  const chatPartnerId = currentUser?.id === transaction.seller_id
    ? (transaction.buyer_id || transaction.user_id)
    : transaction.seller_id;

  const statusColor =
    status === 'pending' ? 'text-orange-500'
    : isCompleted ? 'text-green-500'
    : 'text-red-500';

  const disabledBtn = 'opacity-40 cursor-not-allowed pointer-events-none';

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-40 selection:bg-orange-500/30">

      <Toast {...toast} onClose={hideToast} />

      {/* Shared full-screen viewer (swipe, pinch-zoom, swipe-to-close, back-button safe) */}
      <ImageViewer
        images={images}
        isOpen={viewerOpen}
        initialIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />

      {/* Everything that scrolls bounces together. Fixed elements (the bottom bar) stay outside. */}
      <div ref={bounceRef}>

      {/* HEADER: solid theme colour, flush to the top (no pt-safe, the app shell pads the status bar) */}
      <header className="sticky top-0 left-0 right-0 z-50 w-full bg-gray-50 dark:bg-[#0a1120]">
        <div className="flex w-full items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-1 min-w-0">
            <button onClick={() => router.back()} aria-label="Back" className="p-1.5 -ml-1.5 text-gray-900 dark:text-white active:scale-95 transition-transform">
              <IonIcon icon={chevronBackOutline} className="text-2xl block" />
            </button>
            <div className="min-w-0">
              <h1 className="text-[13px] font-bold leading-tight text-gray-900 dark:text-white">Order Details</h1>
              <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400 font-medium tracking-wide truncate">{transaction.reference}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pl-3 shrink-0">
            {status === 'pending' && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>}
            <span className={`text-[10px] font-bold uppercase tracking-wider ${statusColor}`}>
              {status === 'pending' ? 'Awaiting Delivery' : status}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto w-full px-4 mt-2 space-y-5">

        {/* PRODUCT GALLERY */}
        <div className="relative w-full aspect-[4/3] overflow-hidden rounded-3xl cursor-pointer">
          {images.length > 0 ? (
            <>
              <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide" onScroll={handleScroll}>
                {images.map((img, idx) => (
                  <div key={idx} onClick={() => openViewer(idx)} className="min-w-full h-full snap-center relative flex-shrink-0 flex items-center justify-center">
                    <img src={img} alt="Product" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
              {images.length > 1 && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 z-10 pointer-events-none">
                  {images.map((_, idx) => (
                    <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 ${currentImageIndex === idx ? 'w-6 bg-white' : 'w-2 bg-white/50'}`} />
                  ))}
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); openViewer(currentImageIndex); }}
                aria-label="View full screen"
                className="absolute top-3 right-3 p-2 text-white active:scale-95 transition-transform z-10"
              >
                <IonIcon icon={expandOutline} className="text-2xl block" />
              </button>
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
              <IonIcon icon={imageOutline} className="text-5xl opacity-40" />
            </div>
          )}
        </div>

        {/* ORDER SUMMARY */}
        <div className="px-1">
          <h2 className="text-xl font-bold leading-snug tracking-tight text-gray-900 dark:text-white">{product?.title || 'Marketplace Item'}</h2>
          <p className="mt-1.5 text-2xl font-black text-orange-500 tracking-tight">₦{Math.abs(transaction.amount).toLocaleString()}</p>

          <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-xs font-semibold text-gray-500 dark:text-gray-400 mt-4">
            <div className="flex items-center gap-1.5">
              <IonIcon icon={schoolOutline} className="text-base text-gray-400 dark:text-gray-500" />
              <span className="uppercase tracking-wider">{product?.university_id || product?.campus || 'Campus'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <IonIcon icon={locationOutline} className="text-base text-gray-400 dark:text-gray-500" />
              <span>{product?.specific_location || 'Campus Meetup'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <IonIcon icon={timeOutline} className="text-base text-gray-400 dark:text-gray-500" />
              <span>{new Date(transaction.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* DESCRIPTION BLOCK */}
        {(product?.specifications || product?.description) && (
          <div className="space-y-4 px-1">
            {product?.specifications && (
              <div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <IonIcon icon={receiptOutline} className="text-sm" /> Specifications
                </p>
                <p className="font-medium text-sm leading-relaxed text-gray-800 dark:text-gray-200">{product.specifications}</p>
              </div>
            )}
            {product?.description && (
              <div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest mb-1.5">Description</p>
                <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{product.description}</p>
              </div>
            )}
          </div>
        )}

        {/* SELLER BLOCK */}
        {seller && (
          <div className="px-1 pt-2">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest mb-3">Meet The Seller</p>

            <div
              onClick={() => router.push(`/profile?id=${seller.id}`)}
              className="flex items-center gap-3 mb-4 cursor-pointer active:opacity-70 transition-opacity"
            >
              <Avatar src={seller.avatar_url} name={seller.full_name} size="lg" />
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-bold text-base text-gray-900 dark:text-white tracking-tight">{seller.full_name}</h3>
                  <Badge isVerified={seller.is_verified} />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[#D4AF37] font-bold mt-0.5">
                  <IonIcon icon={star} /> {seller.average_rating || 0} <span className="text-gray-400 font-medium">({seller.total_reviews || 0} Reviews)</span>
                </div>
              </div>
            </div>

            {/* CANCELLED: no contact options at all (no Vendi Chat, WhatsApp or phone number) */}
            {isCancelled ? (
              <p className="text-[11px] text-gray-400 text-center mt-3">This order was cancelled, so contact options are turned off.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    disabled={isCompleted}
                    onClick={() => router.push(`/chats?seller=${chatPartnerId}&ref=${transaction.reference}`)}
                    className={`!flex items-center justify-center gap-2 !bg-gray-100 dark:!bg-gray-800 text-gray-900 dark:text-white font-bold !py-3 !rounded-2xl text-sm transition-all active:scale-[0.98] ${isCompleted ? disabledBtn : ''}`}
                  >
                    <IonIcon icon={chatbubbleEllipsesOutline} className="text-xl" /> Vendi Chat
                  </button>
                  <button
                    disabled={isCompleted}
                    onClick={openWhatsApp}
                    className={`!flex items-center justify-center gap-2 !bg-[#25D366]/10 text-[#25D366] font-bold !py-3 !rounded-2xl text-sm transition-all active:scale-[0.98] ${isCompleted ? disabledBtn : ''}`}
                  >
                    <IonIcon icon={logoWhatsapp} className="text-xl" /> WhatsApp
                  </button>
                </div>

                {/* Phone number: only available while the order is still pending */}
                {!isCompleted && (
                  <button
                    onClick={copyPhoneNumber}
                    className="!w-full !flex items-center justify-center gap-2 mt-3 text-gray-600 dark:text-gray-300 font-bold !py-3 !rounded-2xl text-sm transition-all active:scale-[0.98]"
                  >
                    <IonIcon icon={callOutline} className="text-xl" />
                    {seller.whatsapp || 'Number unavailable'}
                  </button>
                )}

                {isCompleted && (
                  <p className="text-[11px] text-gray-400 text-center mt-3">This transaction is complete, so contact options are turned off.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      </div>

      {/* BOTTOM ACTION NAV */}
      {status === 'pending' && (
        <div className="fixed bottom-0 left-0 right-0 z-[90] bg-gray-50 dark:bg-[#0a1120] p-4 pt-3 pb-safe">
          <div className="max-w-2xl mx-auto space-y-3">
            <Button
              onClick={() => router.push(`/order/confirm?ref=${transaction.reference}`)}
              className="w-full !bg-green-500 hover:!bg-green-600 !rounded-full !py-3.5 !text-base !font-bold transition-all active:scale-[0.98]"
            >
              Confirm Receipt
            </Button>

            <div className="flex gap-3">
              <button onClick={() => router.push(`/dispute?ref=${transaction.reference}`)} className="flex-1 !bg-gray-100 dark:!bg-gray-800/60 text-gray-600 dark:text-gray-300 font-bold !py-3 !rounded-full text-sm transition-all active:scale-[0.98]">
                Raise Dispute
              </button>

              {canCancel && (
                <button onClick={goToCancelPage} className="flex-1 !bg-red-50 dark:!bg-red-900/20 text-red-600 dark:text-red-500 font-bold !py-3 !rounded-full text-sm transition-all active:scale-[0.98]">
                  Cancel Order
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}