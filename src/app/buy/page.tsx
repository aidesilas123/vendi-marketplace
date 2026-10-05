"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { supabase } from '@/lib/supabase';
import { calcFees, naira } from '@/lib/pricing';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Button } from '@/shared/Button';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { CheckoutBottomSheet } from '@/shared/Checkout/CheckoutBottomSheet';
import { PinPadModal } from '@/shared/Checkout/PinPadModal';
import { useRubberBand } from '@/shared/hooks/useRubberBand';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline, shieldCheckmarkOutline, alertCircleOutline,
  lockClosedOutline, timerOutline, refreshCircleOutline, documentTextOutline, star, imageOutline,
  bookmarkOutline, warningOutline
} from 'ionicons/icons';

/* ------------------------------------------------------------------ */
/*  SWR keys                                                          */
/*  'current-user-id', 'platform-settings-raw', ['product', id] and   */
/*  ['product-seller', id] are shared with the product details page   */
/*  and hold the SAME data shape there, so opening checkout from a    */
/*  listing you just viewed is instant.                               */
/* ------------------------------------------------------------------ */

const USER_KEY = 'current-user-id';
const SETTINGS_KEY = 'platform-settings-raw'; // RAW platform_settings row (select *)

/* ------------------------------------------------------------------ */
/*  SWR fetchers. All of them THROW on failure so SWR keeps showing    */
/*  the last good data instead of wiping the screen.                   */
/* ------------------------------------------------------------------ */

const parseImages = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); }
    catch { return [raw]; }
  }
  return [];
};

// Reads the session from local storage. Edge functions and RLS enforce identity on the server.
async function fetchCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function fetchPlatformSettings() {
  const { data, error } = await supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// Resolves to null when the listing doesn't exist, and throws on network/server errors.
async function fetchProduct(id: string) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, images: parseImages(data.images) };
}

async function fetchSeller(sellerId: string) {
  const { data, error } = await supabase.from('users').select('*').eq('id', sellerId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// Fetches the wallet, creating one the first time this user checks out.
async function fetchWallet(userId: string) {
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (data) return data;

  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-wallet`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${userId}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) return null;
  return await res.json();
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function BuyPage() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('id');
  const offerQuery = searchParams.get('offer');
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  // Rubber-band bounce for the page content. This ONE wrapper stays mounted in every state.
  // The toast, processing overlay, bottom bar and modals are rendered outside it so their
  // `fixed` positioning isn't affected by the wrapper's transform.
  const bounceRef = useRef<HTMLDivElement>(null);
  useRubberBand(bounceRef);

  const [isProcessingTx, setIsProcessingTx] = useState(false);

  // Modal & Pin State
  const [activeModal, setActiveModal] = useState<'none' | 'checkout' | 'pin'>('none');
  const [pin, setPin] = useState('');
  const [pinMode, setPinMode] = useState<'create' | 'confirm' | 'verify'>('create');
  const [tempPin, setTempPin] = useState('');

  /* ------------------------------ SWR data layer ------------------------------ */

  const { mutate: globalMutate } = useSWRConfig();

  // Who is logged in. undefined = still resolving, null = not logged in.
  const { data: userId } = useSWR(USER_KEY, fetchCurrentUserId, { revalidateOnFocus: false });
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      globalMutate(USER_KEY);
    });
    return () => sub.subscription.unsubscribe();
  }, [globalMutate]);

  // Fee settings: cached across visits, refreshed quietly
  const { data: platformSettings, error: settingsError, mutate: mutateSettings } = useSWR(
    SETTINGS_KEY,
    fetchPlatformSettings,
    { revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 10000 }
  );

  // The listing. undefined = loading, null = not found.
  // Refetched on mount and on focus, so a price change or a "sold" status is never stale.
  const { data: product, error: productError, mutate: mutateProduct } = useSWR(
    productId ? (['product', productId] as const) : null,
    ([, id]) => fetchProduct(id),
    { revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 5000 }
  );

  const sellerId: string | null = product?.seller_id ?? null;
  const { data: seller } = useSWR(
    sellerId ? (['product-seller', sellerId] as const) : null,
    ([, id]) => fetchSeller(id),
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // The wallet balance decides "Pay" vs "Top up", so it is refetched on mount and on focus.
  // That way coming back from the wallet page after a top-up always shows the new balance.
  const { data: wallet, error: walletError, mutate: mutateWallet } = useSWR(
    userId ? (['wallet', userId] as const) : null,
    ([, uid]) => fetchWallet(uid),
    { revalidateOnFocus: true, revalidateOnReconnect: true, revalidateOnMount: true, dedupingInterval: 2000 }
  );

  /* ------------------------------ guards ------------------------------ */

  useEffect(() => {
    if (!productId) router.push('/');
  }, [productId, router]);

  // Not logged in: tell the user once, then send them to the login page
  const loginRedirected = useRef(false);
  useEffect(() => {
    if (userId !== null || loginRedirected.current) return;
    loginRedirected.current = true;
    showToast('You must be logged in to checkout.', 'error');
    setTimeout(() => router.push('/login'), 2000);
  }, [userId, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set once the payment goes through, so the "already sold" guard below doesn't fire
  // when the order itself flips the listing to SOLD.
  const paymentDone = useRef(false);

  // Sold (including while you sit on this page): tell the user and go back
  const soldHandled = useRef(false);
  useEffect(() => {
    if (product?.status !== 'SOLD' || paymentDone.current || soldHandled.current) return;
    soldHandled.current = true;
    showToast('Sorry, this item is already sold.', 'error');
    router.back();
  }, [product?.status, router]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --------------------------- math (pricing logic) --------------------------- */

  const basePrice = Number(product?.base_price || 0);
  const negotiatedOffer = offerQuery ? Number(offerQuery) : null;
  const itemPrice = negotiatedOffer || basePrice;

  const fees = calcFees(itemPrice, platformSettings);
  const totalCharge = fees.total;
  const hasEnoughFunds = wallet ? Number(wallet.balance) >= totalCharge : false;

  // A failed first load (nothing cached) gets a retry screen instead of an endless skeleton
  const loadError =
    (!!productError && product === undefined) ||
    (!!settingsError && platformSettings === undefined) ||
    (!!walletError && wallet === undefined);

  const isLoading =
    !productId ||
    userId === undefined ||
    userId === null ||
    product === undefined ||
    platformSettings === undefined ||
    wallet === undefined;

  const retryLoad = () => {
    mutateProduct();
    mutateSettings();
    mutateWallet();
  };

  /* --------------------------------- actions ---------------------------------- */

  const handleProceedToPin = () => {
    if (!hasEnoughFunds) {
      router.push('/wallet');
      return;
    }
    const hasPinSet = wallet?.pin_set === true;
    setPinMode(hasPinSet ? 'verify' : 'create');
    setPin('');
    setTempPin('');
    setActiveModal('pin');
  };

  const handlePinBackspace = () => setPin(prev => prev.slice(0, -1));
  const handlePinPress = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) setTimeout(() => processPin(newPin), 300);
    }
  };

  const processPin = async (completedPin: string) => {
    if (pinMode === 'create') {
      setTempPin(completedPin);
      setPin('');
      setPinMode('confirm');
    }
    else if (pinMode === 'confirm') {
      if (completedPin === tempPin) {
        setIsProcessingTx(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-pin`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set', pin: completedPin })
          });
          if (!res.ok) throw new Error('Failed to set PIN');
          // Mark the cached wallet as having a PIN without refetching it
          mutateWallet((prev: any) => (prev ? { ...prev, pin_set: true } : prev), { revalidate: false });
          await executeEscrowPayment();
        } catch (error: any) {
          showToast(error.message, 'error');
          setPin(''); setTempPin(''); setPinMode('create');
        } finally { setIsProcessingTx(false); }
      } else {
        showToast('PINs do not match.', 'error');
        setPin(''); setTempPin(''); setPinMode('create');
      }
    }
    else if (pinMode === 'verify') {
      setIsProcessingTx(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-pin`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', pin: completedPin })
        });
        if (!res.ok) throw new Error('Incorrect PIN');
        await executeEscrowPayment();
      } catch (error: any) {
        showToast(error.message, 'error');
        setPin('');
      } finally { setIsProcessingTx(false); }
    }
  };

  const executeEscrowPayment = async () => {
    if (!product) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-escrow`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, offerPrice: negotiatedOffer })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to secure payment');

      paymentDone.current = true;
      setActiveModal('none');

      // The balance and the listing status just changed: refresh both in the background
      // so the wallet and the rest of the app don't show old numbers.
      mutateWallet();
      globalMutate(['product', product.id]);

      router.push(`/order?ref=${data.reference || 'ESC-63510822'}`);

    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  /* ---------------- what to show ---------------- */

  const ready = !loadError && !isLoading && !!product;

  let content: React.ReactNode;

  if (product === null) {
    content = (
      <div className="flex h-full w-full flex-col items-center justify-center pt-32 font-bold text-gray-500">
        <IonIcon icon={bookmarkOutline} className="mb-4 text-6xl text-gray-300" />
        <p>Product not found or has been removed.</p>
        <button onClick={() => router.push('/')} className="mt-4 text-orange-500 hover:underline">Return to Feed</button>
      </div>
    );
  } else if (loadError) {
    content = (
      <div className="flex w-full flex-col items-center justify-center gap-4 pt-32 text-center">
        <IonIcon icon={warningOutline} className="text-6xl text-gray-300" />
        <p className="font-bold text-gray-500">We couldn&apos;t load checkout.</p>
        <Button size="sm" onClick={retryLoad}>Try again</Button>
      </div>
    );
  } else if (!ready) {
    content = (
      <div className="w-full max-w-xl mx-auto p-4 space-y-6 pt-10">
        <Skeleton className="w-full h-12 rounded-2xl" />
        <Skeleton className="w-full h-32 rounded-3xl" />
        <Skeleton className="w-full h-48 rounded-3xl" />
      </div>
    );
  } else {
    content = (
      <>
        {/* FULL WIDTH HEADER (No Borders, No Shadow) */}
        <div className="sticky top-0 z-[60] -mx-4 md:-mx-8 bg-gray-50 dark:bg-[#0a1120]">
          <div className="h-12 px-4 md:px-8 flex items-center justify-between">
            <button onClick={() => router.back()} className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-gray-900 dark:text-white transition-colors">
              <IonIcon icon={chevronBackOutline} className="text-2xl" />
            </button>
            <h1 className="flex-1 text-center text-base font-black pr-8">Secure Checkout</h1>
          </div>
        </div>

        <div className="max-w-xl mx-auto w-full px-4 mt-2 space-y-6">

          {/* 1. SELLER SAFETY CHECK */}
          <div className="pt-2">
            <h3 className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Safety Verification</h3>
            <div className="bg-transparent flex items-center justify-between py-2">
              {sellerId && seller === undefined ? (
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-32 rounded-full" />
                    <Skeleton className="h-3 w-24 rounded-full" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Avatar src={seller?.avatar_url} name={seller?.full_name || 'Seller'} size="md" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="font-bold text-sm">{seller?.full_name || 'Verified Seller'}</p>
                      <Badge isVerified={seller?.is_verified} />
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-xs font-bold text-gray-500">
                      <IonIcon icon={star} className="text-[#D4AF37]" />
                      <span>{seller?.average_rating || 0} ({seller?.total_reviews || 0} reviews)</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="bg-green-500/10 text-green-500 px-3 py-1 rounded-full flex items-center gap-1 text-[10px] font-black uppercase tracking-wider">
                <IonIcon icon={shieldCheckmarkOutline} className="text-sm" /> Safe
              </div>
            </div>
          </div>

          {/* 2. PRODUCT SUMMARY */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
            <h3 className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-2">Order Summary</h3>
            <div className="bg-transparent py-1">
              <div className="flex gap-4 items-center">
                {product?.images?.[0] ? (
                  <img src={product.images[0]} alt="Product" className="w-16 h-16 rounded-2xl object-cover shadow-sm" />
                ) : (
                  <div className="w-16 h-16 bg-gray-200 dark:bg-gray-800 rounded-2xl flex items-center justify-center">
                    <IonIcon icon={imageOutline} className="text-gray-400 text-3xl" />
                  </div>
                )}
                <div className="flex-1">
                  <h4 className="font-bold text-gray-900 dark:text-white leading-tight line-clamp-2 mb-1">{product?.title}</h4>
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">{product?.condition} • Qty: {product?.quantity || 1}</p>
                </div>
              </div>

              <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
                <div className="flex justify-between items-center text-sm font-bold">
                  <span className="text-gray-500">Item Price {negotiatedOffer && '(Agreed Offer)'}</span>
                  <span className="text-gray-900 dark:text-white">{naira(itemPrice)}</span>
                </div>
                <div className="flex justify-between items-center text-sm font-bold">
                  <span className="text-gray-500 flex items-center gap-1">Escrow Security Fee</span>
                  <span className={fees.isPromo ? 'text-green-500' : 'text-gray-900 dark:text-white'}>
                    {fees.isPromo ? 'Free (Promo)' : naira(fees.buyerFee)}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-3 mt-3 border-t border-gray-200 dark:border-gray-800">
                  <span className="font-black text-gray-900 dark:text-white">Total Amount</span>
                  <span className="font-black text-orange-500 text-2xl">{naira(totalCharge)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. ESCROW EDUCATION BLOCK */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
            <h3 className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-3">How You Are Protected</h3>
            <div className="bg-transparent py-1 space-y-4">
              <div className="flex gap-3 items-start">
                <IonIcon icon={lockClosedOutline} className="text-orange-500 text-xl flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                  <strong className="text-gray-900 dark:text-white">Secure Hold:</strong> Your money is safely held and released to the seller <span className="underline decoration-orange-500 font-bold">only</span> when you confirm receipt of the product in good condition.
                </p>
              </div>
              <div className="flex gap-3 items-start">
                <IonIcon icon={alertCircleOutline} className="text-orange-500 text-xl flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                  <strong className="text-gray-900 dark:text-white">Raise Disputes:</strong> You can quickly raise disputes if the product is defective or doesn't match the description.
                </p>
              </div>
              <div className="flex gap-3 items-start">
                <IonIcon icon={timerOutline} className="text-orange-500 text-xl flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                  <strong className="text-gray-900 dark:text-white">Auto-Cancellations:</strong> You can automatically cancel the order after 2 days of non-response from the seller.
                </p>
              </div>
              <div className="flex gap-3 items-start">
                <IonIcon icon={refreshCircleOutline} className="text-orange-500 text-xl flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-700 dark:text-gray-300 font-medium leading-relaxed">
                  <strong className="text-gray-900 dark:text-white">Full Refunds:</strong> Request an instant refund if you realize the seller sold the product outside the platform.
                </p>
              </div>

              <div className="mt-6 border-t border-gray-200 dark:border-gray-800 pt-5">
                <p className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5 mb-3">
                  <IonIcon icon={documentTextOutline} className="text-lg text-orange-500" />
                  Manage all of this directly in your Orders page:
                </p>
                <div className="w-full aspect-video rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 relative shadow-sm">
                  <img src="/orders-guide.png" alt="Orders Guide" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
              </div>
            </div>
          </div>

        </div>
      </>
    );
  }

  return (
    <>
      <Toast {...toast} onClose={hideToast} />

      {isProcessingTx && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6 shadow-[0_0_20px_rgba(249,115,22,0.6)]"></div>
          <p className="text-white font-black text-xl animate-pulse tracking-wide">Securing Payment...</p>
          <p className="text-gray-300 text-sm mt-2">Please do not close this app.</p>
        </div>
      )}

      {/* Rubber-band wrapper: stays mounted in every state so the bounce always has its element */}
      <div ref={bounceRef} className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-24 relative">
        {content}
      </div>

      {ready && (
        <>
          {/* FULL WIDTH BOTTOM ACTION BAR */}
          <div className="fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] border-t border-gray-200 dark:border-gray-800 px-4 py-4 pb-6 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pointer-events-auto">
            <div className="max-w-xl mx-auto relative z-[110]">
              <button
                type="button"
                onClick={() => setActiveModal('checkout')}
                style={{ borderRadius: '9999px' }}
                className="!w-full !rounded-full !py-4 !text-base !font-black !bg-orange-500 hover:!bg-orange-600 !text-white transition-all cursor-pointer !shadow-none active:scale-[0.98] outline-none border-none flex items-center justify-center"
              >
                Confirm & Pay • {naira(totalCharge)}
              </button>
            </div>
          </div>

          {/* Extracted Modals */}
          <CheckoutBottomSheet
            isOpen={activeModal === 'checkout'}
            onClose={() => setActiveModal('none')}
            product={product}
            itemPrice={itemPrice}
            buyerFee={fees.buyerFee}
            totalCharge={fees.total}
            isPromo={fees.isPromo}
            wallet={wallet}
            hasEnoughFunds={hasEnoughFunds}
            onConfirmPayment={handleProceedToPin}
            onTopUp={() => router.push('/wallet')}
          />

          <PinPadModal
            isOpen={activeModal === 'pin'}
            onClose={() => { setActiveModal('checkout'); setPin(''); setTempPin(''); }}
            pinMode={pinMode}
            pin={pin}
            totalCharge={totalCharge}
            onPinPress={handlePinPress}
            onBackspace={handlePinBackspace}
          />
        </>
      )}
    </>
  );
}