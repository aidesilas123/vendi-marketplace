"use client";

import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { calcFees, naira } from '@/lib/pricing';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { CheckoutBottomSheet } from '@/shared/Checkout/CheckoutBottomSheet';
import { PinPadModal } from '@/shared/Checkout/PinPadModal';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline, shieldCheckmarkOutline, alertCircleOutline,
  lockClosedOutline, timerOutline, refreshCircleOutline, documentTextOutline, star, imageOutline
} from 'ionicons/icons';

export default function BuyPage() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('id');
  const offerQuery = searchParams.get('offer');
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingTx, setIsProcessingTx] = useState(false);
  const [product, setProduct] = useState<any>(null);
  const [seller, setSeller] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [platformSettings, setPlatformSettings] = useState<any>(null);

  // Modal & Pin State
  const [activeModal, setActiveModal] = useState<'none' | 'checkout' | 'pin'>('none');
  const [pin, setPin] = useState('');
  const [pinMode, setPinMode] = useState<'create' | 'confirm' | 'verify'>('create');
  const [tempPin, setTempPin] = useState('');

  useEffect(() => {
    const loadCheckoutData = async () => {
      if (!productId) {
        router.push('/');
        return;
      }

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          showToast('You must be logged in to checkout.', 'error');
          setTimeout(() => router.push('/login'), 2000);
          return;
        }

        const [productRes, settingsRes, walletRes] = await Promise.all([
          supabase.from('products').select('*').eq('id', productId).single(),
          supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
          supabase.from('wallets').select('*').eq('user_id', user.id).maybeSingle()
        ]);

        if (productRes.error || !productRes.data) {
          showToast('Product not found.', 'error');
          return;
        }

        if (productRes.data.status === 'SOLD') {
          showToast('Sorry, this item is already sold.', 'error');
          router.back();
          return;
        }

        let parsedImages = [];
        if (Array.isArray(productRes.data.images)) {
          parsedImages = productRes.data.images;
        } else if (typeof productRes.data.images === 'string') {
          try { parsedImages = JSON.parse(productRes.data.images); }
          catch { parsedImages = [productRes.data.images]; }
        }

        const prod = { ...productRes.data, images: parsedImages };
        setProduct(prod);

        if (settingsRes.data) setPlatformSettings(settingsRes.data);

        if (walletRes.data) {
          setWallet(walletRes.data);
        } else {
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-wallet`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${user.id}`, 'Content-Type': 'application/json' }
          });
          if (res.ok) {
            setWallet(await res.json());
          }
        }

        if (prod.seller_id) {
          const { data: sellerData } = await supabase.from('users').select('*').eq('id', prod.seller_id).maybeSingle();
          setSeller(sellerData);
        }
      } catch (err: any) {
        showToast(err.message || 'Failed to load checkout', 'error');
      } finally {
        setIsLoading(false);
      }
    };

    loadCheckoutData();
  }, [productId, router]);

  // --- MATH CALCS (Using pricing logic) ---
  const basePrice = Number(product?.base_price || 0);
  const negotiatedOffer = offerQuery ? Number(offerQuery) : null;
  const itemPrice = negotiatedOffer || basePrice;

  const fees = calcFees(itemPrice, platformSettings);
  const totalCharge = fees.total;
  const hasEnoughFunds = wallet ? Number(wallet.balance) >= totalCharge : false;

  // --- ACTIONS ---
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
          setWallet({ ...wallet, pin_set: true });
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
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-escrow`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, offerPrice: negotiatedOffer })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to secure payment');
      
      setActiveModal('none');
      router.push(`/order?ref=${data.reference || 'ESC-63510822'}`);

    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-xl mx-auto p-4 space-y-6 pt-10">
        <Skeleton className="w-full h-12 rounded-2xl" />
        <Skeleton className="w-full h-32 rounded-3xl" />
        <Skeleton className="w-full h-48 rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-24 relative">
      <Toast {...toast} onClose={hideToast} />

      {isProcessingTx && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
           <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6 shadow-[0_0_20px_rgba(249,115,22,0.6)]"></div>
           <p className="text-white font-black text-xl animate-pulse tracking-wide">Securing Payment...</p>
           <p className="text-gray-300 text-sm mt-2">Please do not close this app.</p>
        </div>
      )}

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
    </div>
  );
}