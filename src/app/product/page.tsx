"use client";

import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Button } from '@/shared/Button';
import { Modal } from '@/shared/Modal/Modal';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline,
  shareOutline,
  bookmarkOutline,
  bookmark,
  shieldCheckmarkOutline,
  star,
  starOutline,
  schoolOutline,
  locationOutline,
  timeOutline,
  sendOutline,
  expandOutline,
  closeOutline,
  alertCircleOutline,
  checkmarkCircleOutline,
  imageOutline,
  flagOutline,
  chatbubblesOutline,
  warningOutline,
  syncOutline,
  backspaceOutline
} from 'ionicons/icons';

const timeAgo = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

export default function ProductDetails() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('id');
  const router = useRouter();
  
  const [product, setProduct] = useState<any>(null);
  const [similarItems, setSimilarItems] = useState<any[]>([]);
  const [otherItemsBySeller, setOtherItemsBySeller] = useState<any[]>([]);
  const [seller, setSeller] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Gallery State
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFullScreenGallery, setIsFullScreenGallery] = useState(false);

  // Save/Bookmark State
  const [isSaved, setIsSaved] = useState(false);

  // Seller Review & Modal State
  const [userRating, setUserRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [modalConfig, setModalConfig] = useState({ isOpen: false, title: '', message: '', type: 'error' });

  // Product Q&A State
  const [productQuestions, setProductQuestions] = useState<any[]>([]);
  const [newQuestionText, setNewQuestionText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false);

  // Reporting State
  const [showReport, setShowReport] = useState(false);
  const [reportText, setReportText] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // --- NEW: WALLET, CHECKOUT, FEES & PIN STATES ---
  const [wallet, setWallet] = useState<any>(null);
  const [activeModal, setActiveModal] = useState<'none' | 'checkout' | 'pin'>('none');
  const [isProcessingTx, setIsProcessingTx] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<any>(null);
  
  const [pin, setPin] = useState('');
  const [pinMode, setPinMode] = useState<'create' | 'confirm' | 'verify'>('create');
  const [tempPin, setTempPin] = useState('');

  useEffect(() => {
    const fetchProductDetails = async () => {
      if (!productId) return;
      
      try {
        const { data: productData, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .single();

        if (error || !productData) {
          console.error("Product fetch error:", error);
          return;
        }

        let parsedImages = [];
        if (Array.isArray(productData.images)) {
          parsedImages = productData.images;
        } else if (typeof productData.images === 'string') {
          try { parsedImages = JSON.parse(productData.images); }
          catch { parsedImages = [productData.images]; }
        }
        setProduct({ ...productData, images: parsedImages });

        // Fetch dynamic platform settings safely
        const { data: settingsData } = await supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle();
        if (settingsData) setPlatformSettings(settingsData);

        // View Tracking & Save Status Logic
        const { data: { user } } = await supabase.auth.getUser();
        if (!sessionStorage.getItem(`viewed_${productData.id}`)) {
          const recordView = async () => {
            await supabase.from('product_views').insert({
              product_id: productData.id,
              viewer_id: user?.id || null
            });
            sessionStorage.setItem(`viewed_${productData.id}`, 'true');
          };
          recordView();
        }

        if (user) {
          const { data: savedData } = await supabase
            .from('saved_items')
            .select('id')
            .match({ user_id: user.id, product_id: productData.id })
            .maybeSingle();
          if (savedData) setIsSaved(true);

          // Fetch user wallet safely
          const { data: walletData } = await supabase.from('wallets').select('*').eq('user_id', user.id).maybeSingle();
          if (walletData) setWallet(walletData);
        }

        // Fetch Similar Listings
        const { data: similarData } = await supabase
          .from('products')
          .select('*, seller:users(username, full_name, avatar_url, is_verified, average_rating)')
          .eq('status', 'APPROVED')
          .eq('category', productData.category)
          .neq('id', productData.id)
          .limit(4);
          
        if (similarData) {
          setSimilarItems(similarData.map(p => ({
            ...p,
            seller: {
              username: p.seller?.username || p.seller?.full_name?.split(' ')[0] || 'User',
              avatar_url: p.seller?.avatar_url,
              is_verified: p.seller?.is_verified,
              average_rating: p.seller?.average_rating
            }
          })));
        }

        // Fetch Seller Data & Seller Reviews
        if (productData.seller_id) {
          const { data: sellerData } = await supabase.from('users').select('*').eq('id', productData.seller_id).maybeSingle();
          if (sellerData) setSeller(sellerData);

          const { data: reviewData } = await supabase
            .from('seller_reviews')
            .select('*, buyer:buyer_id(full_name, avatar_url)')
            .eq('seller_id', productData.seller_id)
            .order('created_at', { ascending: false });
          if (reviewData) setReviews(reviewData);

          const { data: otherData } = await supabase
            .from('products')
            .select('*, seller:users(username, full_name, avatar_url, is_verified, average_rating)')
            .eq('status', 'APPROVED')
            .eq('seller_id', productData.seller_id)
            .neq('id', productData.id)
            .limit(4);
            
          if (otherData) {
            setOtherItemsBySeller(otherData.map(p => ({
              ...p,
              seller: {
                username: p.seller?.username || p.seller?.full_name?.split(' ')[0] || 'User',
                avatar_url: p.seller?.avatar_url,
                is_verified: p.seller?.is_verified,
                average_rating: p.seller?.average_rating
              }
            })));
          }
        } else {
          setSeller({ id: 'legacy', full_name: "Legacy User", is_verified: true, average_rating: 0, total_reviews: 0, created_at: new Date().toISOString() });
        }

        // Fetch Product Reviews (Q&A)
        const { data: qAndAData } = await supabase
          .from('product_reviews')
          .select('*, user:user_id(full_name, avatar_url, username)')
          .eq('product_id', productData.id)
          .order('created_at', { ascending: true });
        if (qAndAData) setProductQuestions(qAndAData);

      } catch (err) {
        console.error("Critical error loading product:", err);
      } finally {
        // THIS GUARANTEES THE SKELETON TURNS OFF
        setIsLoading(false);
      }
    };

    fetchProductDetails();
  }, [productId]);

  // --- ORIGINAL HANDLERS ---
  const handleToggleSave = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setModalConfig({ isOpen: true, title: 'Login Required', message: 'You must log in to save items.', type: 'error' });

    if (isSaved) {
      setIsSaved(false);
      await supabase.from('saved_items').delete().match({ user_id: user.id, product_id: product.id });
    } else {
      setIsSaved(true);
      await supabase.from('saved_items').upsert({ user_id: user.id, product_id: product.id }, { onConflict: 'user_id,product_id', ignoreDuplicates: true });
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: product?.title || 'Campus Marketplace', url });
      } catch (err) {
        console.log("Share cancelled or failed", err);
      }
    } else {
      await navigator.clipboard.writeText(url);
      setModalConfig({ isOpen: true, title: 'Link Copied', message: 'Product link copied to clipboard!', type: 'success' });
    }
  };

  const handleSubmitReview = async () => {
    if (userRating === 0) {
      return setModalConfig({ isOpen: true, title: "Rating Required", message: "Please select a star rating first.", type: 'error' });
    }
    if (!product.seller_id) {
      return setModalConfig({ isOpen: true, title: "Legacy Item", message: "This is a test item. Reviews can only be left for verified sellers.", type: 'error' });
    }
    setIsSubmittingReview(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setModalConfig({ isOpen: true, title: "Login Required", message: "You must be logged in to leave a review.", type: 'error' });
      setIsSubmittingReview(false);
      return;
    }

    const { error } = await supabase.from('seller_reviews').insert({
      seller_id: product.seller_id,
      buyer_id: user.id,
      rating: userRating,
      review_text: reviewText
    });

    if (!error) {
      const { data: freshReviews } = await supabase
        .from('seller_reviews')
        .select('*, buyer:buyer_id(full_name, avatar_url)')
        .eq('seller_id', product.seller_id)
        .order('created_at', { ascending: false });
      if (freshReviews) setReviews(freshReviews);
      setReviewText("");
      setUserRating(0);
      setModalConfig({ isOpen: true, title: "Review Submitted", message: "Thank you for your feedback!", type: 'success' });
    } else {
      setModalConfig({ isOpen: true, title: "Error", message: error.message, type: 'error' });
    }
    setIsSubmittingReview(false);
  };

  const handleAskQuestion = async (parentId: string | null = null) => {
    const textToSubmit = parentId ? replyText : newQuestionText;
    if (!textToSubmit.trim()) return;
    
    const containsContactInfo = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)|(\d{8,})/.test(textToSubmit);
    if (containsContactInfo) {
      setModalConfig({ isOpen: true, title: "Message Blocked by AI", message: "Contact information detected. For your safety, all transactions must remain on the platform.", type: 'error' });
      return;
    }

    setIsSubmittingQuestion(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setModalConfig({ isOpen: true, title: "Login Required", message: "You must be logged in to post.", type: 'error' });
      setIsSubmittingQuestion(false);
      return;
    }

    const { error } = await supabase.from('product_reviews').insert({
      content: textToSubmit,
      product_id: product.id,
      user_id: user.id,
      parent_id: parentId 
    });

    if (!error) {
      const { data: qAndAData } = await supabase
        .from('product_reviews')
        .select('*, user:user_id(full_name, avatar_url, username)')
        .eq('product_id', product.id)
        .order('created_at', { ascending: true });
      if (qAndAData) setProductQuestions(qAndAData);
      setNewQuestionText("");
      setReplyText("");
      setReplyingTo(null);
    } else {
      setModalConfig({ isOpen: true, title: "Error", message: error.message, type: 'error' });
    }
    setIsSubmittingQuestion(false);
  };

  const handleReportListing = async () => {
    if (!reportText.trim()) return;
    setIsSubmittingReport(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from('products_report').insert({
      product_id: product.id,
      reporter_id: user?.id || null,
      reason: reportText
    });

    if (!error) {
      setModalConfig({ isOpen: true, title: "Report Received", message: "Thank you. Our moderation team will review this listing shortly.", type: 'success' });
      setReportText("");
      setShowReport(false);
    } else {
      setModalConfig({ isOpen: true, title: "Error", message: "Could not submit report.", type: 'error' });
    }
    setIsSubmittingReport(false);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    const width = e.currentTarget.offsetWidth;
    const index = Math.round(scrollLeft / width);
    setCurrentImageIndex(index);
  };

  // --- NEW: CHECKOUT & PIN HANDLERS ---
  const handleBuyNowClick = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return setModalConfig({ isOpen: true, title: "Login Required", message: "You must log in to make a purchase.", type: 'error' });
    }
    
    if (!wallet) {
      setIsProcessingTx(true);
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-wallet`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${user.id}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const newWallet = await res.json();
        setWallet(newWallet);
      }
      setIsProcessingTx(false);
    }
    
    setActiveModal('checkout');
  };

  const handleConfirmPaymentClick = () => {
    const hasPinSet = wallet?.pin_set === true;
    setPinMode(hasPinSet ? 'verify' : 'create');
    setPin('');
    setTempPin('');
    setActiveModal('pin');
  };

  const handlePinBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handlePinPress = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        setTimeout(() => processPin(newPin), 300); 
      }
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
          setModalConfig({ isOpen: true, title: 'Error', message: error.message, type: 'error' });
          setPin('');
          setTempPin('');
          setPinMode('create');
        } finally {
          setIsProcessingTx(false);
        }
      } else {
        setModalConfig({ isOpen: true, title: 'Error', message: 'PINs do not match.', type: 'error' });
        setPin('');
        setTempPin('');
        setPinMode('create');
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
        setModalConfig({ isOpen: true, title: 'Error', message: error.message, type: 'error' });
        setPin(''); 
      } finally {
        setIsProcessingTx(false);
      }
    }
  };

  const executeEscrowPayment = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-escrow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ productId: product.id })
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to secure payment');
      }

      setActiveModal('none');
      router.push('/transactions');

    } catch (error: any) {
      setModalConfig({ isOpen: true, title: 'Transaction Failed', message: error.message, type: 'error' });
    }
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-2xl mx-auto p-4 space-y-4 pt-10">
        <Skeleton className="w-full aspect-[4/3] rounded-3xl" />
        <Skeleton className="w-3/4 h-8 rounded-full" />
        <Skeleton className="w-1/2 h-6 rounded-full" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center pt-32 text-gray-500 font-bold">
        <IonIcon icon={bookmarkOutline} className="text-6xl mb-4 text-gray-300" />
        <p>Product not found or has been removed.</p>
        <button onClick={() => router.push('/')} className="mt-4 text-orange-500 hover:underline">Return to Feed</button>
      </div>
    );
  }

  // --- DYNAMIC MATH LOGIC ---
  const itemPrice = Number(product.buyer_price || 0);
  let buyerFee = 0;
  let isPromo = true;

  if (platformSettings) {
      isPromo = platformSettings.is_launch_promo_active;
      if (!isPromo) {
          const splitPercent = Number(platformSettings.platform_fee_percentage) / 2;
          buyerFee = Math.floor(itemPrice * (splitPercent / 100));
      }
  }
  
  const totalCharge = itemPrice + buyerFee;
  const hasEnoughFunds = wallet ? Number(wallet.balance) >= totalCharge : false;

  const images: string[] = product.images?.length > 0 ? product.images : [];
  const joinYear = seller?.created_at ? new Date(seller.created_at).getFullYear() : "N/A";

  return (
    <div className="w-full bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pb-10">
      
      {/* Global Processing Blur */}
      {isProcessingTx && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center p-4 bg-black/50 backdrop-blur-md">
           <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4 shadow-[0_0_15px_rgba(249,115,22,0.5)]"></div>
           <p className="text-white font-black text-lg animate-pulse tracking-wide">Securing Funds...</p>
        </div>
      )}

      {modalConfig.isOpen && (
        <Modal isOpen={modalConfig.isOpen} onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}>
          <div className="p-6 text-center">
            <IonIcon icon={modalConfig.type === 'success' ? checkmarkCircleOutline : alertCircleOutline} className={`text-5xl mb-4 ${modalConfig.type === 'success' ? 'text-green-500' : 'text-red-500'}`} />
            <h2 className="text-xl font-black mb-2 text-gray-900 dark:text-white">{modalConfig.title}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{modalConfig.message}</p>
            <Button onClick={() => setModalConfig(prev => ({ ...prev, isOpen: false }))} className="w-full !py-3">
              Understood
            </Button>
          </div>
        </Modal>
      )}

      {isFullScreenGallery && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="absolute top-0 left-0 right-0 p-4 pt-safe flex justify-end z-10">
            <button onClick={() => setIsFullScreenGallery(false)} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-colors">
              <IonIcon icon={closeOutline} className="text-2xl" />
            </button>
          </div>
          <div className="flex-1 w-full h-full overflow-x-auto snap-x snap-mandatory flex scrollbar-hide">
            {images.map((img, i) => (
              <div key={i} className="min-w-full h-full snap-center flex items-center justify-center p-4">
                <img src={img} className="w-full h-auto max-h-full object-contain rounded-xl" alt="Fullscreen View" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sticky top-0 z-50 bg-white/90 dark:bg-[#0f172a]/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 py-3 flex items-center justify-between shadow-sm -mx-4 px-4 md:-mx-8 md:px-8">
        <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full bg-transparent hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-gray-900 dark:text-white">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
        <div className="flex gap-1">
          <button onClick={handleShare} className="w-10 h-10 flex items-center justify-center rounded-full bg-transparent text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <IonIcon icon={shareOutline} className="text-xl" />
          </button>
          <button onClick={handleToggleSave} className={`w-10 h-10 flex items-center justify-center rounded-full bg-transparent transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${isSaved ? 'text-orange-500' : 'text-gray-600 dark:text-gray-300'}`}>
            <IonIcon icon={isSaved ? bookmark : bookmarkOutline} className="text-xl" />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto w-full px-4 md:px-0">
        <div className="relative bg-black w-full aspect-[4/3] overflow-hidden rounded-3xl shadow-sm mt-4 cursor-pointer group">
          {images.length > 0 ? (
            <>
              <div className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide" onScroll={handleScroll}>
                {images.map((img, idx) => (
                  <div key={idx} onClick={() => setIsFullScreenGallery(true)} className="min-w-full h-full snap-center relative flex-shrink-0 bg-black flex items-center justify-center">
                    <img src={img} alt={`${product.title} - Image ${idx + 1}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  </div>
                ))}
              </div>

              {images.length > 1 && (
                <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 z-10 pointer-events-none">
                  {images.map((_, idx) => (
                    <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 shadow-sm ${currentImageIndex === idx ? 'w-6 bg-orange-500' : 'w-2 bg-white/60 backdrop-blur-sm'}`} />
                  ))}
                </div>
              )}
              <button onClick={(e) => { e.stopPropagation(); setIsFullScreenGallery(true); }} className="absolute bottom-4 right-4 w-8 h-8 flex items-center justify-center bg-black/50 backdrop-blur-md rounded-full text-white shadow-lg z-10 hover:bg-black/70">
                <IonIcon icon={expandOutline} className="text-lg" />
              </button>
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 text-gray-400">
              <IonIcon icon={imageOutline} className="text-5xl mb-2 opacity-50" />
              <p className="font-bold text-sm">No images provided</p>
            </div>
          )}
          <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md text-white text-[10px] px-3 py-1.5 rounded-lg font-black uppercase tracking-widest border border-white/10 shadow-lg pointer-events-none">
            {product.condition}
          </div>
        </div>

        <div className="pt-6 pb-2">
          <div className="flex justify-between items-start gap-4">
            <h1 className="text-2xl md:text-3xl font-black leading-tight">{product.title}</h1>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <p className="text-3xl font-black text-orange-500">₦{itemPrice.toLocaleString()}</p>
            {product.slashed_price && product.slashed_price > itemPrice && (
              <p className="text-lg font-bold text-gray-400 line-through mb-1">₦{product.slashed_price?.toLocaleString()}</p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-y-3 gap-x-6 text-xs font-bold text-gray-500 mt-4 border-b border-gray-100 dark:border-gray-800 pb-5">
            <div className="flex items-center gap-1">
              <IonIcon icon={schoolOutline} className="text-base text-gray-400" />
              <span className="uppercase tracking-wide">{product.university_id || product.campus}</span>
            </div>
            <div className="flex items-center gap-1">
              <IonIcon icon={locationOutline} className="text-base text-gray-400" />
              <span>{product.specific_location}</span>
            </div>
            <div className="flex items-center gap-1">
              <IonIcon icon={timeOutline} className="text-base text-gray-400" />
              <span>Posted {timeAgo(product.created_at)}</span>
            </div>
          </div>
        </div>

        <div className="py-4 space-y-5">
          {product.specifications && (
            <div className="bg-[#D4AF37]/5 border border-[#D4AF37]/20 p-4 rounded-2xl">
              <p className="text-[10px] text-[#D4AF37] font-black uppercase tracking-widest mb-1.5">Specifications</p>
              <p className="font-bold text-sm text-gray-900 dark:text-white leading-relaxed">{product.specifications}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-2">Description</p>
            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{product.description}</p>
          </div>
        </div>

        <div className="py-6 mt-2 -mx-4 px-4 md:mx-0 md:px-0">
          <div className="bg-orange-50 dark:bg-orange-500/5 border border-orange-200 dark:border-orange-500/20 p-5 rounded-3xl flex flex-col items-center text-center">
            <div className={`w-12 h-12 bg-white dark:bg-gray-900 rounded-full flex items-center justify-center mb-3 shadow-sm ${product.status === 'SOLD' ? 'text-gray-400' : 'text-orange-500'}`}>
              <IonIcon icon={shieldCheckmarkOutline} className="text-2xl" />
            </div>
            <h3 className="font-black text-gray-900 dark:text-white mb-1">Escrow Protected Payment</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-5 max-w-sm">
              Your money is held safely until you receive and inspect the item.
            </p>
            <Button
              onClick={handleBuyNowClick}
              disabled={product.status === 'SOLD'}
              className={`w-full !rounded-2xl !py-4 !text-lg !font-black transition-all ${
                product.status === 'SOLD'
                ? '!bg-gray-300 dark:!bg-gray-800 !text-gray-500 !shadow-none cursor-not-allowed'
                : 'shadow-[0_8px_30px_rgba(249,115,22,0.3)] hover:!bg-orange-600'
              }`}
            >
              {product.status === 'SOLD' ? 'Item Sold Out' : `Buy Now • ₦${totalCharge.toLocaleString()}`}
            </Button>
          </div>
        </div>

        <div className="py-6 border-t border-gray-100 dark:border-gray-800 mt-2">
          <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-4">About the Seller</p>
          {seller && (
            <div className="bg-white dark:bg-[#0f172a] border border-gray-200 dark:border-gray-800 rounded-3xl p-5 shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Avatar src={seller.avatar_url} name={seller.full_name} size="lg" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-black text-gray-900 dark:text-white">{seller.full_name}</h3>
                      <Badge isVerified={seller.is_verified} />
                    </div>
                    <p className="text-xs text-gray-500 font-bold mt-0.5">
                      @{seller.username || seller.full_name?.split(' ')[0]?.toLowerCase() || 'seller'} • Joined {joinYear}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 sm:gap-6 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-2xl mb-6 overflow-x-auto scrollbar-hide">
                <div>
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Rating</p>
                  <div className="flex items-center gap-1.5">
                    <IonIcon icon={star} className="text-[#D4AF37] text-lg" />
                    <span className="font-black text-lg text-gray-900 dark:text-white leading-none">{seller.average_rating || 0}</span>
                  </div>
                </div>
                <div className="w-px h-8 bg-gray-200 dark:bg-gray-700"></div>
                <div>
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Reviews</p>
                  <span className="font-black text-lg text-gray-900 dark:text-white leading-none">{seller.total_reviews || 0}</span>
                </div>
                <div className="w-px h-8 bg-gray-200 dark:bg-gray-700"></div>
                <div>
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Sales</p>
                  <span className="font-black text-lg text-gray-900 dark:text-white leading-none">12+</span>
                </div>
              </div>

              {/* Leave a Seller Review Section */}
              <div className="border-t border-gray-100 dark:border-gray-800 pt-5">
                <h4 className="text-sm font-black mb-3">Rate this Seller</h4>
                <div className="flex gap-2 mb-3">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <IonIcon
                      key={s}
                      icon={userRating >= s ? star : starOutline}
                      onClick={() => setUserRating(s)}
                      className={`text-2xl cursor-pointer transition-colors ${userRating >= s ? 'text-[#D4AF37]' : 'text-gray-300 dark:text-gray-600 hover:text-[#D4AF37]/50'}`}
                    />
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Write a review (optional)..."
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    className="flex-1 min-w-0 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                  />
                  <button
                    onClick={handleSubmitReview}
                    disabled={isSubmittingReview}
                    className="!bg-orange-500 text-white w-12 h-12 flex flex-shrink-0 items-center justify-center !rounded-xl shadow-md disabled:opacity-50 transition-all hover:!bg-orange-600"
                  >
                    {isSubmittingReview ? <IonIcon icon={syncOutline} className="text-xl animate-spin" /> : <IonIcon icon={sendOutline} className="text-xl pl-1" />}
                  </button>
                </div>
              </div>

              {/* Display Existing Seller Reviews */}
              {reviews.length > 0 && (
                <div className="mt-6 space-y-4 border-t border-gray-100 dark:border-gray-800 pt-5">
                  <h4 className="text-sm font-black mb-4">Recent Reviews</h4>
                  {reviews.map(review => (
                    <div key={review.id} className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Avatar src={review.buyer?.avatar_url} name={review.buyer?.full_name || "Buyer"} size="sm" />
                          <span className="text-xs font-bold">{review.buyer?.full_name || "Verified Buyer"}</span>
                        </div>
                        <div className="flex text-[#D4AF37] text-xs">
                          {[...Array(review.rating)].map((_, i) => <IonIcon key={i} icon={star} />)}
                        </div>
                      </div>
                      {review.review_text && <p className="text-sm text-gray-600 dark:text-gray-300">{review.review_text}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* --- PRODUCT Q&A SECTION --- */}
        <div className="py-6 border-t border-gray-100 dark:border-gray-800 mt-2">
          <div className="bg-white dark:bg-[#0f172a] p-5 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
            <h3 className="text-lg font-black text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-800 pb-3 mb-4">Product Q&A</h3>
            {/* Display Threaded Product Reviews */}
            <div className="space-y-5 mb-6">
              {productQuestions.filter(r => r.parent_id === null).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <IonIcon icon={chatbubblesOutline} className="text-4xl text-gray-300 dark:text-gray-700 mb-2" />
                  <p className="font-bold text-gray-500 text-sm">No questions yet. Be the first to ask!</p>
                </div>
              ) : (
                productQuestions.filter(r => r.parent_id === null).map((question) => (
                  <div key={question.id} className="border-b border-gray-100 dark:border-gray-800 pb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Avatar src={question.user?.avatar_url} name={question.user?.full_name || "User"} size="sm" />
                      <p className="text-xs font-bold text-gray-900 dark:text-white">{question.user?.full_name || "Buyer"}</p>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 ml-9">{question.content}</p>
                    {/* UI DIFFERENTIATION FOR SELLER REPLIES */}
                    {productQuestions.filter(reply => reply.parent_id === question.id).map(reply => (
                      <div key={reply.id} className={`ml-9 mt-3 pl-3 border-l-2 ${reply.user_id === product.seller_id ? 'border-orange-500' : 'border-gray-300 dark:border-gray-700'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          {reply.user_id === product.seller_id ? (
                            <span className="text-[10px] font-black uppercase text-orange-500 bg-orange-100 dark:bg-orange-500/10 px-2 py-0.5 rounded-sm">Seller Reply</span>
                          ) : (
                            <span className="text-xs font-bold text-gray-900 dark:text-white">{reply.user?.full_name}</span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{reply.content}</p>
                      </div>
                    ))}

                    <div className="ml-9 mt-2">
                      {replyingTo !== question.id ? (
                        <button onClick={() => setReplyingTo(question.id)} className="text-xs font-bold text-gray-400 hover:text-orange-500 transition-colors">Reply to thread</button>
                      ) : (
                        <div className="mt-2 flex gap-2 items-center animate-in fade-in">
                          <input
                            type="text"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Type your reply..."
                            className="flex-1 min-w-0 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500"
                          />
                          <button onClick={() => setReplyingTo(null)} className="text-xs text-gray-400 font-bold px-1 whitespace-nowrap flex-shrink-0 hover:text-gray-900 dark:hover:text-white transition-colors">Cancel</button>
                          <button
                            onClick={() => handleAskQuestion(question.id)}
                            disabled={isSubmittingQuestion}
                            className="!bg-orange-500 text-white w-12 h-12 flex flex-shrink-0 items-center justify-center !rounded-xl shadow-md disabled:opacity-50 transition-all hover:!bg-orange-600"
                          >
                            {isSubmittingQuestion ? <IonIcon icon={syncOutline} className="text-xl animate-spin" /> : <IonIcon icon={sendOutline} className="text-xl pl-1" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Post a New Question */}
            <div className="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-2xl border border-gray-100 dark:border-gray-800">
              <p className="text-xs font-bold text-gray-500 mb-2">Ask the seller a question</p>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  placeholder="Is the price negotiable?"
                  className="flex-1 min-w-0 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0f172a] px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
                <button
                  onClick={() => handleAskQuestion(null)}
                  disabled={isSubmittingQuestion}
                  className="!bg-orange-500 text-white w-12 h-12 flex flex-shrink-0 items-center justify-center !rounded-xl shadow-md disabled:opacity-50 transition-all hover:!bg-orange-600"
                >
                  {isSubmittingQuestion ? <IonIcon icon={syncOutline} className="text-xl animate-spin" /> : <IonIcon icon={sendOutline} className="text-xl pl-1" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Other Items by Seller */}
        {otherItemsBySeller.length > 0 && (
          <div className="py-6 border-t border-gray-100 dark:border-gray-800 -mx-4 md:mx-0">
            <div className="px-4 mb-4 flex justify-between items-center">
              <h3 className="font-black text-gray-900 dark:text-white">More from {seller?.full_name || 'Seller'}</h3>
              <button onClick={() => router.push(`/profile?id=${product.seller_id || seller.id}`)} className="text-xs font-bold text-orange-500 hover:underline">
                View All
              </button>
            </div>
            <div className="flex overflow-x-auto gap-4 px-4 pb-4 scrollbar-hide snap-x">
              {otherItemsBySeller.map(item => (
                <div key={item.id} className="w-[160px] md:w-[200px] flex-shrink-0 snap-start">
                  <BuyerProductCard product={item} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Similar Listings */}
        {similarItems.length > 0 && (
          <div className="py-6 border-t border-gray-100 dark:border-gray-800 mb-8 -mx-4 px-4 md:mx-0 md:px-0">
            <h3 className="font-black text-gray-900 dark:text-white mb-4">Similar Listings</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              {similarItems.map(item => (
                <BuyerProductCard key={item.id} product={item} />
              ))}
            </div>
          </div>
        )}

        {/* REPORT UI */}
        <div className="flex flex-col items-center border-t border-gray-200 dark:border-gray-800 pt-8 pb-12 text-center">
          {!showReport ? (
            <button onClick={() => setShowReport(true)} className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-red-500 transition-colors">
              <IonIcon icon={flagOutline} /> Report this listing
            </button>
          ) : (
            <div className="w-full max-w-sm animate-in fade-in">
              <p className="text-xs font-bold text-red-500 mb-2 flex items-center justify-center gap-1">
                <IonIcon icon={warningOutline} /> Why are you reporting this?
              </p>
              <textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="Spam, inappropriate content, fake item..."
                className="w-full text-xs rounded-xl border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10 p-3 focus:outline-none focus:border-red-500 min-h-[80px] mb-2 resize-none"
              />
              <div className="flex justify-center gap-4">
                <button onClick={() => setShowReport(false)} className="text-xs font-bold text-gray-500 hover:underline">Cancel</button>
                <button onClick={handleReportListing} disabled={isSubmittingReport} className="text-xs font-bold text-red-500 bg-red-100 dark:bg-red-900/30 px-4 py-1.5 rounded-full hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
                  Submit Report
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================== */}
      {/* CHECKOUT & PIN OVERLAYS */}
      {/* ========================================== */}

      {activeModal !== 'none' && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setActiveModal('none')} />
      )}

      {/* 1. CHECKOUT BOTTOM SHEET */}
      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${activeModal === 'checkout' ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="p-6 pb-12 max-w-md mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black">Checkout summary</h3>
            <button onClick={() => setActiveModal('none')} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">
              <IonIcon icon={closeOutline} />
            </button>
          </div>
          
          <div className="bg-gray-50 dark:bg-[#1f2937] rounded-2xl p-4 mb-6 border border-gray-100 dark:border-gray-800">
            <div className="flex gap-4 items-center mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
               {product?.images?.[0] && <img src={product.images[0]} className="w-16 h-16 rounded-xl object-cover" />}
               <div>
                  <h4 className="font-bold text-sm line-clamp-1">{product?.title}</h4>
                  <p className="text-xs text-gray-500 mt-1">Qty: 1</p>
               </div>
            </div>
            
            <div className="flex justify-between items-center text-sm mb-2">
              <span className="text-gray-500">Item Price</span>
              <span className="font-bold">₦{itemPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Escrow Fee</span>
              <span className={`font-bold ${isPromo ? 'text-green-500' : 'text-gray-900 dark:text-white'}`}>
                {isPromo ? 'Free (Launch Promo!)' : `₦${buyerFee.toLocaleString()}`}
              </span>
            </div>
            {!isPromo && (
              <div className="flex justify-between items-center text-sm border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                <span className="text-gray-500 font-bold">Total Due</span>
                <span className="font-black text-orange-500 text-lg">₦{totalCharge.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mb-8 px-2">
             <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-500 flex items-center justify-center">
                   <IonIcon icon={shieldCheckmarkOutline} className="text-xl" />
                </div>
                <div>
                   <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Wallet Balance</p>
                   <p className="font-black text-lg text-gray-900 dark:text-white">₦{Number(wallet?.balance || 0).toLocaleString()}</p>
                </div>
             </div>
          </div>

          {hasEnoughFunds ? (
            <button 
              onClick={handleConfirmPaymentClick}
              className="w-full border-none !bg-orange-500 hover:!bg-orange-600 text-white font-black py-4 !rounded-full shadow-[0_8px_30px_rgb(249,115,22,0.3)] text-lg transition-all"
            >
              Confirm Payment
            </button>
          ) : (
            <button 
              onClick={() => router.push('/wallet')}
              className="w-full border-none !bg-gray-900 dark:!bg-white hover:opacity-90 text-white dark:text-gray-900 font-black py-4 !rounded-full text-lg transition-all"
            >
              Top Up Wallet
            </button>
          )}
        </div>
      </div>

      {/* 2. PIN PAD MODAL */}
      <div className={`fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-[#0f172a] rounded-t-3xl shadow-2xl transition-transform duration-300 transform ${activeModal === 'pin' ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="p-6 pb-12 max-w-md mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black">
              {pinMode === 'create' ? 'Create Transaction PIN' : 
               pinMode === 'confirm' ? 'Confirm Your PIN' : 
               'Enter Transaction PIN'}
            </h3>
            <button onClick={() => {
              setActiveModal('checkout');
              setPin('');
              setTempPin('');
            }} className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">
              <IonIcon icon={closeOutline} />
            </button>
          </div>
          
          <p className="text-center text-gray-500 text-sm mb-10">
            {pinMode === 'create' ? 'Set a 4-digit PIN to secure your wallet transactions.' : 
             pinMode === 'confirm' ? 'Enter the same 4-digit PIN again to confirm.' : 
             `Enter your 4-digit PIN to authorize ₦${totalCharge.toLocaleString()}.`}
          </p>

          <div className="flex justify-center gap-6 mb-12">
            {[0, 1, 2, 3].map((index) => (
              <div 
                key={index} 
                className={`w-4 h-4 rounded-full transition-all duration-300 ${
                  index < pin.length 
                    ? 'bg-orange-500 scale-110 shadow-[0_0_12px_rgba(249,115,22,0.6)]' 
                    : 'bg-gray-200 dark:bg-gray-700 scale-100'
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-y-6 gap-x-4 max-w-[280px] mx-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button 
                key={num} 
                onClick={() => handlePinPress(num.toString())}
                className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-black mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {num}
              </button>
            ))}
            <div /> 
            <button 
              onClick={() => handlePinPress('0')}
              className="w-16 h-16 rounded-full flex items-center justify-center text-3xl font-black mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              0
            </button>
            <button 
              onClick={handlePinBackspace}
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl mx-auto hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500"
            >
              <IonIcon icon={backspaceOutline} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}