"use client";

import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { IonIcon } from '@ionic/react';
import { 
  chevronBackOutline, 
  shieldCheckmarkOutline, 
  star, 
  schoolOutline, 
  locationOutline, 
  timeOutline, 
  logoWhatsapp, 
  callOutline, 
  chatbubbleEllipsesOutline, 
  warningOutline, 
  alertCircleOutline, 
  expandOutline, 
  closeOutline, 
  imageOutline, 
  receiptOutline 
} from 'ionicons/icons';

export default function OrderDetails() {
  const searchParams = useSearchParams();
  // Support both ref and id just to be perfectly safe against routing mismatches
  const txRef = searchParams.get('ref') || searchParams.get('id');
  const router = useRouter();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [transaction, setTransaction] = useState<any>(null);
  const [product, setProduct] = useState<any>(null);
  const [seller, setSeller] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessingTx, setIsProcessingTx] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFullScreenGallery, setIsFullScreenGallery] = useState(false);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'info', action: () => {} });

  useEffect(() => {
    const fetchOrderData = async () => {
      if (!txRef) {
        setIsLoading(false);
        return;
      }
      
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/login');
          return;
        }
        
        setCurrentUser(user); // Save the current user to state

        const { data: txData, error: txError } = await supabase
          .from('transactions')
          .select('*')
          .eq('reference', txRef)
          .maybeSingle(); 

        if (txError || !txData) { 
          return; 
        }
        setTransaction(txData);

        if (txData.product_id) {
          const { data: productData } = await supabase.from('products').select('*').eq('id', txData.product_id).single();
          if (productData) {
            let parsedImages = [];
            if (Array.isArray(productData.images)) parsedImages = productData.images;
            else if (typeof productData.images === 'string') {
              try { parsedImages = JSON.parse(productData.images); } catch { parsedImages = [productData.images]; }
            }
            setProduct({ ...productData, images: parsedImages });
          }
        }

        // We fetch the seller details to display their profile on the order page
        if (txData.seller_id) {
          const { data: sellerData } = await supabase.from('users').select('*').eq('id', txData.seller_id).single();
          if (sellerData) setSeller(sellerData);
        }
      } catch (err) {
        console.error("Critical error loading order:", err);
      } finally {
        // Guaranteed to turn off the skeleton UI
        setIsLoading(false);
      }
    };
    fetchOrderData();
  }, [txRef, router]);

  const hoursPassed = transaction ? (new Date().getTime() - new Date(transaction.created_at).getTime()) / (1000 * 60 * 60) : 0;
  const canCancel = hoursPassed >= 24 && transaction?.status === 'pending';

  let itemPrice = 0;
  try {
    const meta = typeof transaction?.metadata === 'string' ? JSON.parse(transaction.metadata) : transaction?.metadata;
    itemPrice = meta?.item_price || 0;
  } catch (e) { }

  const images: string[] = product?.images?.length > 0 ? product.images : [];

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => setCurrentImageIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.offsetWidth));

  const copyPhoneNumber = () => {
    if (seller?.whatsapp) {
      navigator.clipboard.writeText(seller.whatsapp);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 4000);
    }
  };

  const openWhatsApp = () => {
    if (!seller?.whatsapp) return;
    const text = encodeURIComponent(`Hi ${seller.full_name}, I just purchased your ${product?.title} on Vendi. I'd like to arrange a meetup to inspect and pick it up!`);
    let formattedPhone = seller.whatsapp.startsWith('0') ? '234' + seller.whatsapp.slice(1) : seller.whatsapp;
    window.open(`https://wa.me/${formattedPhone}?text=${text}`, '_blank');
  };

  const handleCancelOrder = () => {
    setModalConfig({
      isOpen: true, 
      title: 'Cancel Order?', 
      message: `Because 24 hours have passed, you can cancel this order. ₦${itemPrice.toLocaleString()} will be refunded to your wallet. (Platform protection fees are non-refundable).`, 
      type: 'warning',
      action: async () => {
        setModalConfig(prev => ({ ...prev, isOpen: false }));
        setIsProcessingTx(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/cancel-escrow`, {
            method: 'POST', 
            headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ transactionRef: transaction.reference })
          });
          if (!res.ok) throw new Error('Failed to cancel order');
          router.push('/transactions');
        } catch (error: any) {
          setModalConfig({ isOpen: true, title: 'Error', message: error.message, type: 'error', action: () => setModalConfig(prev => ({ ...prev, isOpen: false })) });
        } finally {
          setIsProcessingTx(false);
        }
      }
    });
  };

  if (isLoading) {
    return (
      <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] pb-32 animate-pulse pt-safe">
        <div className="py-3 px-4 flex items-center justify-between border-b border-gray-200/40 dark:border-gray-800/40 max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 !rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="w-24 h-3.5 !rounded-md" />
              <Skeleton className="w-16 h-2.5 !rounded-md" />
            </div>
          </div>
          <Skeleton className="w-24 h-6 !rounded-full" />
        </div>

        <div className="max-w-2xl mx-auto px-4 mt-4 space-y-6">
          <Skeleton className="w-full aspect-[4/3] !rounded-[2rem]" />

          <div className="space-y-3 px-1">
            <Skeleton className="w-3/4 h-8 !rounded-xl" />
            <Skeleton className="w-1/3 h-10 !rounded-xl" />
            <Skeleton className="w-full h-14 !rounded-2xl mt-4" />
          </div>

          <Skeleton className="w-full h-28 !rounded-[1.5rem]" />
          <Skeleton className="w-full h-44 !rounded-[2rem]" />
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center text-gray-500 pb-20 px-4 text-center">
        <IonIcon icon={receiptOutline} className="text-5xl mb-4 text-gray-300 dark:text-gray-600" />
        <p className="text-lg font-bold text-gray-800 dark:text-gray-200">Order Details not found.</p>
        <p className="text-xs text-gray-400 mt-1 max-w-[240px]">This transaction may have been removed or does not exist.</p>
        <Button onClick={() => router.back()} className="mt-6 px-8 !py-3 !rounded-full">Go Back</Button>
      </div>
    );
  }

  // --- DYNAMIC PARTNER CALCULATION ---
  // If the person viewing is the seller, their chat partner is the buyer. Otherwise, it's the seller.
  const chatPartnerId = currentUser?.id === transaction.seller_id 
    ? (transaction.buyer_id || transaction.user_id) 
    : transaction.seller_id;

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-40 selection:bg-orange-500/30">

      {isProcessingTx && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300">
           <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4"></div>
           <p className="text-white font-black text-lg animate-pulse tracking-wide">Processing...</p>
        </div>
      )}

      {modalConfig.isOpen && (
        <Modal isOpen={modalConfig.isOpen} onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}>
          <div className="p-6 text-center">
            <IonIcon icon={warningOutline} className="text-6xl mb-4 text-orange-500" />
            <h2 className="text-2xl font-black mb-2 text-gray-900 dark:text-white tracking-tight">{modalConfig.title}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-8 font-medium leading-relaxed">{modalConfig.message}</p>
            <div className="flex gap-3">
              <Button onClick={() => setModalConfig(prev => ({ ...prev, isOpen: false }))} className="flex-1 !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white !py-3.5 !rounded-2xl">Abort</Button>
              <Button onClick={modalConfig.action} className="flex-1 !bg-orange-500 !py-3.5 !rounded-2xl shadow-lg shadow-orange-500/30">Confirm</Button>
            </div>
          </div>
        </Modal>
      )}

      {isFullScreenGallery && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="absolute top-0 left-0 right-0 p-4 pt-safe flex justify-end z-10">
            <button onClick={() => setIsFullScreenGallery(false)} className="p-2 text-white/80 hover:text-white active:scale-95 transition-transform">
              <IonIcon icon={closeOutline} className="text-4xl drop-shadow-md" />
            </button>
          </div>
          <div className="flex-1 w-full h-full overflow-x-auto snap-x snap-mandatory flex scrollbar-hide">
            {images.map((img, i) => (
               <div key={i} className="min-w-full h-full snap-center flex items-center justify-center p-4">
                  <img src={img} className="w-full h-auto max-h-full object-contain rounded-2xl" alt="Fullscreen View" />
               </div>
            ))}
          </div>
        </div>
      )}

      {/* STICKY HEADER */}
      <div className="sticky top-0 z-50 bg-gray-50/90 dark:bg-[#0a1120]/90 backdrop-blur-xl py-3 px-4 transition-all pt-safe border-b border-gray-200/40 dark:border-gray-800/40">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-1">
            <button onClick={() => router.back()} className="p-2 -ml-2 text-gray-900 dark:text-white active:scale-95 transition-transform">
              <IonIcon icon={chevronBackOutline} className="text-3xl drop-shadow-sm" />
            </button>
            <div>
              <h1 className="text-sm font-black uppercase tracking-wider text-gray-900 dark:text-white">Order Details</h1>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-bold tracking-widest">{transaction.reference}</p>
            </div>
          </div>

          <div className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 ${
            transaction.status === 'pending' ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-500/30' : 
            (transaction.status === 'successful' || transaction.status === 'completed') ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/30' : 
            'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30'
          }`}>
            {transaction.status === 'pending' && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>}
            <span className={`text-[10px] font-black uppercase tracking-widest ${
              transaction.status === 'pending' ? 'text-orange-600 dark:text-orange-500' : 
              (transaction.status === 'successful' || transaction.status === 'completed') ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'
            }`}>
              {transaction.status === 'pending' ? 'Awaiting Delivery' : transaction.status}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto w-full px-4 mt-2 space-y-6">

        {/* PRODUCT GALLERY */}
        <div className="relative bg-gray-900 w-full aspect-[4/3] overflow-hidden rounded-[2rem] shadow-lg shadow-gray-200/50 dark:shadow-none cursor-pointer group">
          {images.length > 0 ? (
            <>
              <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide" onScroll={handleScroll}>
                {images.map((img, idx) => (
                  <div key={idx} onClick={() => setIsFullScreenGallery(true)} className="min-w-full h-full snap-center relative flex-shrink-0 bg-white/5 flex items-center justify-center">
                    <img src={img} alt="Product" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                  </div>
                ))}
              </div>
              {images.length > 1 && (
                <div className="absolute bottom-5 left-0 right-0 flex justify-center gap-2 z-10 pointer-events-none">
                  {images.map((_, idx) => (
                    <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 shadow-sm ${currentImageIndex === idx ? 'w-6 bg-white' : 'w-2 bg-white/40'}`} />
                  ))}
                </div>
              )}
              <button onClick={(e) => { e.stopPropagation(); setIsFullScreenGallery(true); }} className="absolute top-4 right-4 p-2 text-white/90 hover:text-white active:scale-95 transition-transform z-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                <IonIcon icon={expandOutline} className="text-3xl" />
              </button>
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400">
              <IonIcon icon={imageOutline} className="text-6xl mb-3 opacity-40" />
            </div>
          )}
        </div>

        {/* ORDER SUMMARY */}
        <div className="px-2">
          <h2 className="text-2xl sm:text-3xl font-black leading-tight tracking-tight text-gray-900 dark:text-white">{product?.title || 'Marketplace Item'}</h2>
          <div className="mt-3 flex items-end gap-3">
            <p className="text-4xl font-black text-orange-500 tracking-tight">₦{Math.abs(transaction.amount).toLocaleString()}</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-y-3 gap-x-6 text-xs font-bold text-gray-500 dark:text-gray-400 mt-6 bg-white dark:bg-gray-800/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-800/60 shadow-sm">
            <div className="flex items-center gap-1.5">
              <IonIcon icon={schoolOutline} className="text-lg text-gray-400 dark:text-gray-500" />
              <span className="uppercase tracking-wider">{product?.university_id || product?.campus || 'Campus'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <IonIcon icon={locationOutline} className="text-lg text-gray-400 dark:text-gray-500" />
              <span>{product?.specific_location || 'Campus Meetup'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <IonIcon icon={timeOutline} className="text-lg text-gray-400 dark:text-gray-500" />
              <span>{new Date(transaction.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* DESCRIPTION BLOCK */}
        <div className="space-y-4 px-2">
          {product?.specifications && (
            <div className="bg-gray-100/70 dark:bg-gray-800/40 p-5 rounded-[1.5rem] border border-gray-200/50 dark:border-gray-700/30">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                <IonIcon icon={receiptOutline} className="text-sm" /> Specifications
              </p>
              <p className="font-bold text-sm leading-relaxed text-gray-800 dark:text-gray-200">{product.specifications}</p>
            </div>
          )}
          {product?.description && (
            <div className="px-1">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-widest mb-2 mt-4">Description</p>
              <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap font-medium">{product.description}</p>
            </div>
          )}
        </div>

        {/* SELLER CONTACT BLOCK */}
        {seller && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[2rem] p-6 shadow-sm mt-8">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-widest mb-4">Meet The Seller</p>

            <div 
              onClick={() => router.push(`/profile?id=${seller.id}`)}
              className="flex items-center gap-4 mb-6 cursor-pointer hover:opacity-80 transition-opacity active:scale-[0.98]"
            >
              <Avatar src={seller.avatar_url} name={seller.full_name} size="lg" />
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-black text-lg text-gray-900 dark:text-white tracking-tight">{seller.full_name}</h3>
                  <Badge isVerified={seller.is_verified} />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[#D4AF37] font-bold mt-1">
                  <IonIcon icon={star} /> {seller.average_rating || 0} <span className="text-gray-400 font-medium">({seller.total_reviews || 0} Reviews)</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <button 
                onClick={() => router.push(`/chats?seller=${chatPartnerId}&ref=${transaction.reference}`)}
                className="!flex items-center justify-center gap-2 !bg-gray-100 dark:!bg-gray-800 text-gray-900 dark:text-white font-bold !py-3.5 !rounded-2xl text-sm transition-all hover:!bg-gray-200 dark:hover:!bg-gray-700 active:scale-[0.98]"
              >
                <IonIcon icon={chatbubbleEllipsesOutline} className="text-xl" /> Vendi Chat
              </button>
              <button onClick={openWhatsApp} className="!flex items-center justify-center gap-2 !bg-[#25D366]/10 text-[#25D366] font-bold !py-3.5 !rounded-2xl text-sm transition-all hover:!bg-[#25D366]/20 active:scale-[0.98]">
                <IonIcon icon={logoWhatsapp} className="text-xl" /> WhatsApp
              </button>
            </div>

            <button onClick={copyPhoneNumber} className="!w-full !flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-bold !py-3.5 !rounded-2xl text-sm transition-all hover:!bg-gray-50 dark:hover:!bg-gray-800 active:scale-[0.98]">
              {hasCopied ? (
                <>
                  <IonIcon icon={shieldCheckmarkOutline} className="text-xl text-green-500" /> 
                  <span className="text-green-500">Copied!</span>
                </>
              ) : (
                <>
                  <IonIcon icon={callOutline} className="text-xl" /> 
                  {seller.whatsapp || 'Number unavailable'}
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* BOTTOM STICKY ACTION NAV */}
      {transaction?.status === 'pending' && (
        <div className="fixed bottom-0 left-0 right-0 z-[90] bg-white/90 dark:bg-[#0a1120]/90 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 p-4 pt-5 pb-safe shadow-[0_-20px_40px_rgba(0,0,0,0.05)] dark:shadow-[0_-20px_40px_rgba(0,0,0,0.3)]">
          <div className="max-w-2xl mx-auto space-y-3">
            <Button 
              onClick={() => router.push(`/order/confirm?ref=${transaction.reference}`)} 
              className="w-full !bg-green-500 hover:!bg-green-600 !rounded-full !py-4 shadow-[0_8px_30px_rgba(34,197,94,0.3)] !text-lg !font-black transition-all active:scale-[0.98]"
            >
              Confirm Receipt
            </Button>

            <div className="flex gap-3">
              <button onClick={() => router.push(`/dispute?ref=${transaction.reference}`)} className="flex-1 !bg-gray-100 dark:!bg-gray-800/60 text-gray-600 dark:text-gray-300 font-bold !py-3.5 !rounded-full text-sm hover:!bg-gray-200 dark:hover:!bg-gray-700 transition-all active:scale-[0.98]">
                Raise Dispute
              </button>

              {canCancel && (
                <button onClick={handleCancelOrder} className="flex-1 !bg-red-50 dark:!bg-red-900/20 text-red-600 dark:text-red-500 font-bold !py-3.5 !rounded-full text-sm hover:!bg-red-100 dark:hover:!bg-red-900/40 transition-all active:scale-[0.98]">
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