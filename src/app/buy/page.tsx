// src/app/buy/page.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import { safeBack } from '@/shared/safeBack';
import useSWR, { useSWRConfig } from 'swr';
import { supabase } from '@/lib/supabase';
import { usePlatformSettings } from '@/shared/hooks/usePlatformSettings';
import { notify } from '@/lib/notify';
import { calcFees, naira } from '@/lib/pricing';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Button } from '@/shared/Button';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { CheckoutBottomSheet } from '@/shared/Checkout/CheckoutBottomSheet';
import { PinPadModal } from '@/shared/Checkout/PinPadModal';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline, shieldCheckmarkOutline, alertCircleOutline,
  lockClosedOutline, timerOutline, refreshCircleOutline, documentTextOutline, star, imageOutline,
  bookmarkOutline, warningOutline
} from 'ionicons/icons';

// Monnify Web Checkout SDK (loaded on demand from Monnify's CDN — see
// loadMonnifySDK). It opens Monnify's own modal over the app, the way
// Paystack's inline checkout does: the buyer never leaves Vendi.
declare global {
  interface Window {
    MonnifySDK?: {
      initialize: (config: Record<string, unknown>) => void;
    };
  }
}

/* ------------------------------------------------------------------ */
/*  SWR keys                                                          */
/*  'current-user-id', ['product', id] and ['product-seller', id]     */
/*  are shared with the product details page and hold the SAME data   */
/*  shape there, so opening checkout from a listing you just viewed   */
/*  is instant. Fee settings come from the shared usePlatformSettings */
/*  hook (institution-scoped key ['platform-settings', slug]).        */
/* ------------------------------------------------------------------ */

const USER_KEY = 'current-user-id';

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

// Resolves to null when the listing doesn't exist, and throws on network/server errors.
async function fetchProduct(id: string) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, images: parseImages(data.images) };
}

async function fetchSeller(sellerId: string) {
  // Public profile only: the users table is locked to the owner's own row,
  // so another seller's row must come from the public_profiles view.
  const { data, error } = await supabase.from('public_profiles').select('id, username, full_name, avatar_url, is_verified, is_admin, average_rating, total_reviews').eq('id', sellerId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// Fetches the wallet, creating one the first time this user checks out.
async function fetchWallet(userId: string) {
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (data) return data;

  // create-wallet authenticates the caller by JWT — a raw user id is
  // rejected, so pass the session access token, not the user id.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-wallet`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
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
  // Deep-link return (com.vendi.app://payment-return): AppShell routes here
  // with ?paymentReference= after Monnify sends the buyer back into the app.
  const paymentRefParam = searchParams.get('paymentReference');
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  // Rubber-band bounce for the page content. This ONE wrapper stays mounted in every state.
  // The toast, processing overlay, bottom bar and modals are rendered outside it so their
  // `fixed` positioning isn't affected by the wrapper's transform.
  const bounceRef = useRef<HTMLDivElement>(null);

  const [isProcessingTx, setIsProcessingTx] = useState(false);

  // Modal & Pin State
  const [activeModal, setActiveModal] = useState<'none' | 'checkout' | 'pin'>('none');
  // Client-only mount flag for the portaled bottom bar (avoids SSR mismatch).
  const [barMounted, setBarMounted] = useState(false);
  useEffect(() => { setBarMounted(true); }, []);
  const [pin, setPin] = useState('');
  const [pinMode, setPinMode] = useState<'create' | 'confirm' | 'verify'>('create');
  const [tempPin, setTempPin] = useState('');

  // A Monnify payment started from this page but not yet reconciled (the
  // buyer is in the browser, or came back before it finished). Tapping the
  // Monnify button again checks THIS payment instead of starting a new one,
  // so the buyer can never be charged twice for the same order.
  const [onlinePendingRef, setOnlinePendingRef] = useState<string | null>(null);
  // The Monnify SDK script, loaded once and cached (a failed load clears so
  // a retry loads it again).
  const monnifySdkPromiseRef = useRef<Promise<void> | null>(null);

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

  // The listing. undefined = loading, null = not found.
  // Refetched on mount, so a price change or a "sold" status is never stale.
  const { data: product, error: productError, mutate: mutateProduct } = useSWR(
    productId ? (['product', productId] as const) : null,
    ([, id]) => fetchProduct(id),
    { revalidateOnFocus: false, revalidateOnReconnect: true, dedupingInterval: 5000 }
  );

  // Fee settings: from the listing's institution (global row as fallback),
  // cached across visits, refreshed quietly. Sits after the product fetch
  // above because it needs the listing's university_id.
  const { settings: platformSettings, error: settingsError, mutate: mutateSettings, isLoading: settingsLoading } = usePlatformSettings(product?.university_id);

  const sellerId: string | null = product?.seller_id ?? null;
  const { data: seller } = useSWR(
    sellerId ? (['product-seller', sellerId] as const) : null,
    ([, id]) => fetchSeller(id),
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // The wallet balance decides "Pay" vs "Top up", so it is refetched on mount.
  // That way coming back from the wallet page after a top-up always shows the new balance.
  const { data: wallet, error: walletError, mutate: mutateWallet } = useSWR(
    userId ? (['wallet', userId] as const) : null,
    ([, uid]) => fetchWallet(uid),
    { revalidateOnFocus: false, revalidateOnReconnect: true, revalidateOnMount: true, dedupingInterval: 2000 }
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

  // Monnify gateway fee for the online path: 1.5% of the total, rounded UP so the
  // collected amount always covers it — capped at ₦2,000, matching Monnify's
  // local-card cap and the server's math. The buyer pays total + fee, so the escrow
  // amounts (item price, seller net) stay exact. The fee is shown in the sheet
  // before the buyer taps pay. VAT on the fee (~7.5%) and the fee-on-gross
  // rounding (a few naira) are absorbed by Vendi for now — flip the rate below
  // to pass them to the buyer later. The server re-computes this fee when the
  // payment starts; the client number is display-only, never trusted.
  const gatewayFee = Math.min(Math.ceil(totalCharge * 0.015), 2000);
  const gatewayTotal = totalCharge + gatewayFee;

  // A failed first load (nothing cached) gets a retry screen instead of an endless skeleton
  const loadError =
    (!!productError && product === undefined) ||
    (!!settingsError && !platformSettings) ||
    (!!walletError && wallet === undefined);

  const isLoading =
    !productId ||
    userId === undefined ||
    userId === null ||
    product === undefined ||
    settingsLoading ||
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

  // Loads Monnify's Web Checkout SDK (the Paystack-inline equivalent: it
  // opens Monnify's own modal over the app, so the buyer never leaves
  // Vendi). The script URL follows the API key: test keys (MK_TEST_) load
  // the sandbox SDK, live keys load the live SDK. Loaded once, then cached.
  const loadMonnifySDK = (apiKey: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.MonnifySDK) return Promise.resolve();
    if (monnifySdkPromiseRef.current) return monnifySdkPromiseRef.current;
    const src = apiKey.startsWith('MK_TEST_')
      ? 'https://sandbox.sdk.monnify.com/plugin/monnify.js'
      : 'https://sdk.monnify.com/plugin/monnify.js';
    monnifySdkPromiseRef.current = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        monnifySdkPromiseRef.current = null;
        reject(new Error('Could not load the Monnify checkout. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
    return monnifySdkPromiseRef.current;
  };

  // Online payment with Monnify (direct escrow), in-app modal: the server
  // quotes the payment and records it, then the Monnify SDK opens its modal
  // over the app. On completion (or on close) the payment is reconciled
  // with Monnify on the server — the webhook usually creates the escrow
  // first; the reconcile is the safety net that also covers a missed
  // webhook. No system browser, no redirect: the buyer never leaves Vendi.
  const handlePayOnline = async () => {
    if (!product || isProcessingTx) return;

    // A payment is already running for this order — check it instead of
    // starting (and charging) a second one.
    if (onlinePendingRef) {
      await reconcileOnlinePayment(onlinePendingRef);
      return;
    }

    // The SDK's apiKey + contractCode are public SDK credentials (like
    // Paystack's public key) — they ship in the app bundle. The SECRET key
    // stays only in Supabase secrets and is never used here.
    const apiKey = process.env.NEXT_PUBLIC_MONNIFY_API_KEY ?? '';
    const contractCode = process.env.NEXT_PUBLIC_MONNIFY_CONTRACT_CODE ?? '';
    if (!apiKey || !contractCode) {
      showToast('Online payment is not set up yet. Try the wallet instead.', 'error');
      return;
    }

    setIsProcessingTx(true);
    try {
      // Load the SDK first: if it can't load, no checkout row is created
      // and the buyer can simply retry.
      await loadMonnifySDK(apiKey);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        showToast('You must be logged in to checkout.', 'error');
        return;
      }
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/monnify-checkout-initialize`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, offerPrice: negotiatedOffer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the online payment');
      const paymentReference: string = data.paymentReference;
      const gatewayTotal: number = Number(data.gatewayTotal);
      const customerName: string = data.customerName ?? 'Vendi Buyer';
      const customerEmail: string = data.customerEmail ?? '';
      if (!paymentReference || !gatewayTotal) throw new Error('Could not start the online payment');

      setOnlinePendingRef(paymentReference);
      setIsProcessingTx(false);
      // Slide the sheet down: the Monnify modal opens over the buy page.
      // Reopening the sheet shows "Check my Monnify payment" for this
      // same payment.
      setActiveModal('none');

      // The SDK opens its own modal and initializes the payment with our
      // reference. `completed` guards onClose: after a successful payment
      // onClose may also fire, and it must not reconcile a second time.
      let completed = false;
      window.MonnifySDK!.initialize({
        amount: gatewayTotal,
        currency: 'NGN',
        reference: paymentReference,
        // Monnify's sample uses customerFullName; their field table lists
        // customerName. Both are passed so a doc mismatch can't break it.
        customerFullName: customerName,
        customerName,
        customerEmail,
        apiKey,
        contractCode,
        paymentDescription: `Vendi escrow: ${String(product.title).slice(0, 40)}`,
        metadata: { product_id: product.id },
        onComplete: (response: any) => {
          completed = true;
          void reconcileOnlinePayment(paymentReference, response?.transactionReference ?? null);
        },
        onClose: () => {
          if (completed) return;
          // Closed without completing (or completed but onComplete didn't
          // fire) — reconcile to find out which. A paid payment still
          // creates the escrow; an unpaid one is closed as cancelled.
          void reconcileOnlinePayment(paymentReference, null, true);
        },
      });
    } catch (error: any) {
      showToast(error.message || 'Could not start the online payment', 'error');
      setIsProcessingTx(false);
    }
  };

  // Asks the server to verify the Monnify payment and finish the escrow
  // (or refund). Retries a few times: the webhook usually lands first, but
  // on a slow network the payment can still be confirming when the modal
  // closes. `cancelled` means the buyer closed the modal without paying —
  // the server then closes the row (no money moved, nothing to refund).
  const reconcileOnlinePayment = async (
    paymentReference: string,
    monnifyTransactionReference?: string | null,
    cancelled?: boolean,
  ) => {
    setIsProcessingTx(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/monnify-checkout-reconcile`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentReference, monnifyTransactionReference: monnifyTransactionReference ?? null, cancelled: cancelled ?? false }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not confirm the payment');

        if (data.success && data.reference) {
          paymentDone.current = true;
          setOnlinePendingRef(null);
          setActiveModal('none');

          // Exact numbers from the reconcile; fallback to the local math.
          const itemAmount = Number(negotiatedOffer || product?.base_price || 0);
          const totalChargePaid = Number(data.total_charge ?? totalCharge);
          const sellerNet = Number(data.seller_net ?? itemAmount);
          const productImage = (product as any)?.images?.[0] || '';

          // Sold -> seller (same words as the wallet path)
          if (product?.seller_id && product.seller_id !== userId) {
            void (async () => {
              let buyerName = 'A buyer';
              try {
                const { data: buyer } = await supabase.from('users').select('full_name').eq('id', userId).maybeSingle();
                if (buyer?.full_name) buyerName = buyer.full_name.split(' ')[0];
              } catch { /* name is a nicety, never block the notification */ }
              await notify({
                userId: product.seller_id,
                type: 'order',
                title: `Your "${product.title}" has been sold!`,
                body: `${buyerName} has paid — your payout of ₦${sellerNet.toLocaleString()} is secured in escrow. Chat them to arrange inspection and delivery; once they confirm receipt, the payout will be released to your wallet.`,
                route: `/order?ref=${data.reference}`,
                data: {
                  amount: String(sellerNet),
                  itemTitle: product.title,
                  counterparty: buyerName,
                  reference: data.reference,
                  transaction_ref: data.reference,
                  detail: `Your payout is ₦${sellerNet.toLocaleString()}`,
                },
                imageUrl: productImage || undefined,
              });
            })();
          }

          // Escrow hold -> buyer (same words as the wallet path)
          if (userId) {
            void notify({
              userId,
              type: 'wallet',
              title: 'Payment secured in escrow',
              body: `Your ₦${totalChargePaid.toLocaleString()} for "${product?.title}" is held safely. It goes to the seller only after you confirm receipt.`,
              route: `/order?ref=${data.reference}`,
              data: {
                amount: String(totalChargePaid),
                direction: 'debit',
                itemTitle: product?.title ?? '',
                reference: data.reference,
              },
              imageUrl: productImage || undefined,
            });
          }

          globalMutate(['product', product.id]);
          router.push(`/order?ref=${data.reference}`);
          return;
        }

        if (data.refunded) {
          setOnlinePendingRef(null);
          setActiveModal('none');
          showToast('This item was just sold. Your payment was returned to your wallet.', 'info');
          mutateWallet();
          router.push('/wallet');
          return;
        }

        if (data.cancelled) {
          setOnlinePendingRef(null);
          showToast('Payment cancelled.', 'info');
          return;
        }

        if (data.dead) {
          setOnlinePendingRef(null);
          showToast('This payment has expired. Start a new one if you still want the item.', 'info');
          return;
        }

        // Monnify has no record of this payment — it never started, so
        // there is nothing to wait for. Free the button so the buyer can
        // start a fresh payment instead of re-checking a dead one.
        if (data.not_started) {
          setOnlinePendingRef(null);
          showToast('This payment never started. You can start a new one.', 'info');
          return;
        }

        // Not paid (yet) — wait a moment and try again, in case Monnify is
        // still confirming. After the last try, leave the sheet open: the
        // order appears once the webhook lands, and the button re-checks.
        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
      }
      showToast('Payment not confirmed yet. Your order will appear once Monnify confirms it.', 'info');
    } catch (error: any) {
      showToast(error.message || 'Could not confirm the payment', 'error');
    } finally {
      setIsProcessingTx(false);
    }
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
          await executeEscrowPayment(completedPin);
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
        await executeEscrowPayment(completedPin);
      } catch (error: any) {
        showToast(error.message, 'error');
        setPin('');
      } finally { setIsProcessingTx(false); }
    }
  };

  // Wallet escrow: the PIN the user just entered is sent with the charge —
  // the server verifies it before debiting (a stolen session alone must not
  // be able to spend the wallet).
  const executeEscrowPayment = async (pin: string) => {
    if (!product) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-escrow`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, offerPrice: negotiatedOffer, pin })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to secure payment');

      paymentDone.current = true;
      setActiveModal('none');

      // Exact numbers from the escrow function; fallback to the item price
      // if the deployed function predates the breakdown fields.
      const itemAmount = Number(negotiatedOffer || product.base_price || 0);
      const totalCharge = Number(data.total_charge ?? itemAmount);
      const sellerNet = Number(data.seller_net ?? itemAmount);
      const productImage = (product as any).images?.[0] || '';

      // Sold -> seller (warm and specific; routes to the seller's order view)
      if (product.seller_id && product.seller_id !== userId) {
        void (async () => {
          let buyerName = 'A buyer';
          try {
            const { data: buyer } = await supabase.from('users').select('full_name').eq('id', userId).maybeSingle();
            if (buyer?.full_name) buyerName = buyer.full_name.split(' ')[0];
          } catch { /* name is a nicety, never block the notification */ }
          await notify({
            userId: product.seller_id,
            type: 'order',
            title: `Your "${product.title}" has been sold!`,
            body: `${buyerName} has paid — your payout of ₦${sellerNet.toLocaleString()} is secured in escrow. Chat them to arrange inspection and delivery; once they confirm receipt, the payout will be released to your wallet.`,
            route: `/order?ref=${data.reference}`,
            data: {
              amount: String(sellerNet),
              itemTitle: product.title,
              counterparty: buyerName,
              reference: data.reference,
              transaction_ref: data.reference,
              detail: `Your payout is ₦${sellerNet.toLocaleString()}`,
            },
            imageUrl: productImage || undefined,
          });
        })();
      }

      // Escrow hold -> buyer (money-movement record for the bell + push)
      if (userId) {
        void notify({
          userId,
          type: 'wallet',
          title: 'Payment secured in escrow',
          body: `Your ₦${totalCharge.toLocaleString()} for "${product.title}" is held safely. It goes to the seller only after you confirm receipt.`,
          route: `/order?ref=${data.reference}`,
          data: {
            amount: String(totalCharge),
            direction: 'debit',
            itemTitle: product.title,
            reference: data.reference,
          },
          imageUrl: productImage || undefined,
        });
      }

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

  // Deep-link return: once the product has loaded, reconcile the payment the
  // deep link carries (idempotent). Runs once per reference — the modal's
  // onClose reconcile covers the case where this event is missed.
  const deepLinkReconciledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !paymentRefParam) return;
    if (deepLinkReconciledRef.current === paymentRefParam) return;
    deepLinkReconciledRef.current = paymentRefParam;
    setOnlinePendingRef(paymentRefParam);
    void reconcileOnlinePayment(paymentRefParam);
  }, [ready, paymentRefParam]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {/* Header row: back button + title */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-4 w-32 rounded-full" />
          <div className="w-10" />
        </div>
        {/* Safety verification row */}
        <div className="pt-2">
          <Skeleton className="h-2.5 w-24 rounded-full mb-3" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex flex-col gap-2 flex-1">
              <Skeleton className="h-4 w-32 rounded-full" />
              <Skeleton className="h-3 w-24 rounded-full" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
        {/* Order summary: product row + price rows */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-3">
          <Skeleton className="h-2.5 w-24 rounded-full" />
          <div className="flex gap-4 items-center">
            <Skeleton className="w-16 h-16 rounded-2xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full rounded-full" />
              <Skeleton className="h-3 w-2/3 rounded-full" />
            </div>
          </div>
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
            <div className="flex justify-between items-center">
              <Skeleton className="h-3 w-24 rounded-full" />
              <Skeleton className="h-3 w-16 rounded-full" />
            </div>
            <div className="flex justify-between items-center">
              <Skeleton className="h-3 w-28 rounded-full" />
              <Skeleton className="h-3 w-16 rounded-full" />
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
              <Skeleton className="h-4 w-28 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          </div>
        </div>
        {/* Protection rows */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-4 space-y-4">
          <Skeleton className="h-2.5 w-32 rounded-full" />
          <div className="flex gap-3 items-start">
            <Skeleton className="h-5 w-5 rounded-md shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-3/4 rounded-full" />
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <Skeleton className="h-5 w-5 rounded-md shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-2/3 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    content = (
      <>
        {/* FULL WIDTH HEADER (No Borders, No Shadow) */}
        <div className="sticky top-0 z-[60] -mx-4 md:-mx-8 bg-gray-50 dark:bg-background">
          <div className="h-12 px-4 md:px-8 flex items-center justify-between">
            <button onClick={() => safeBack(router)} className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-gray-900 dark:text-white transition-colors">
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
      <div ref={bounceRef} className="w-full min-h-full bg-gray-50 dark:bg-background text-gray-900 dark:text-white pb-24 relative">
        {content}
      </div>

      {/* BOTTOM ACTION BAR — portaled to <body> so it escapes AppShell's rubber-band
          wrapper: that wrapper gets a CSS transform during overscroll, and a transformed
          ancestor hijacks `fixed` positioning — that is why the bar used to ride up with
          the page (same fix as the order page's bottom bar). The /buy page keeps its bounce.
          Hidden while the checkout sheet, the PIN modal, or the processing overlay is up:
          the bar is portaled to <body> at z-100, so it paints above in-page sheets and
          would otherwise cover the sheet's bottom buttons (Top Up Wallet). The sheet has
          its own buttons, so the bar is redundant while it is open. */}
      {ready && barMounted && activeModal === 'none' && !isProcessingTx && createPortal(
          <div className="fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-black border-t border-gray-200 dark:border-gray-800 px-4 pt-4 pb-[max(1.5rem,var(--sab))] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pointer-events-auto">
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
          </div>,
        document.body
      )}

      {ready && (
        <>
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
            onTopUp={() => router.push('/wallet?topup=1')}
            gatewayFee={gatewayFee}
            gatewayTotal={gatewayTotal}
            onlinePending={onlinePendingRef !== null}
            onlineProcessing={isProcessingTx}
            onPayOnline={handlePayOnline}
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
