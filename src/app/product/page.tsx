"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { calcFees, naira } from '@/lib/pricing';
import { BuyerProductCard } from '@/shared/Card/BuyerProductCard';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { Button } from '@/shared/Button';
import { ImageViewer } from '@/shared/ImageViewer/ImageViewer';
import { EscrowBreakdown } from '@/shared/Checkout/EscrowBreakdown';
import { Toast, useToast } from '@/shared/Toast/Toast';
import { IonIcon } from '@ionic/react';
import {
  chevronBackOutline, shareOutline, eyeOutline, bookmarkOutline, bookmark, shieldCheckmarkOutline, star, starOutline,
  schoolOutline, locationOutline, timeOutline, sendOutline, expandOutline, imageOutline, flagOutline,
  chatbubblesOutline, warningOutline, syncOutline, checkmarkCircleOutline
} from 'ionicons/icons';

const CONTACT_REGEX = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)|(\d{8,})/;
const NETWORK_MSG = 'Network error. Check your connection and try again.';
const PAGE_SIZE = 3;

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

// Reads the session from local storage (no extra network round trip like getUser()).
// RLS still enforces identity on the server.
const getUserId = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
};

/* ------------------------------------------------------------------ */
/*  Typing components. Each owns its own state, so a keystroke only    */
/*  re-renders this tiny component instead of the whole page.          */
/* ------------------------------------------------------------------ */

function AutoGrowTextarea({
  value, onChange, placeholder, maxHeight = 140,
}: { value: string; onChange: (v: string) => void; placeholder: string; maxHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ maxHeight }}
      className="block w-full resize-none overflow-y-auto bg-transparent text-sm leading-5 focus:outline-none"
    />
  );
}

// Inline styles strictly enforce a 44x44 perfect circle, bypassing any flex stretching
function SendButton({ onClick, disabled, busy }: { onClick: () => void; disabled: boolean; busy: boolean }) {
  return (
    <button
      type="button"
      aria-label="Send"
      onClick={onClick}
      disabled={disabled}
      style={{ 
        width: '44px', 
        height: '44px', 
        minWidth: '44px', 
        minHeight: '44px', 
        borderRadius: '50%', 
        flexShrink: 0, 
        padding: 0, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}
      className="bg-orange-500 text-white transition-colors hover:bg-orange-600 disabled:opacity-50 border-none outline-none"
    >
      <IonIcon icon={busy ? syncOutline : sendOutline} className={`text-xl ${busy ? 'animate-spin' : 'pl-0.5'}`} />
    </button>
  );
}

function ComposeBox({
  placeholder, onSubmit, onCancel, allowEmpty = false,
}: {
  placeholder: string;
  onSubmit: (text: string) => Promise<boolean>; // return true to clear the box
  onCancel?: () => void;
  allowEmpty?: boolean;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const canSend = !busy && (allowEmpty || value.trim().length > 0);

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    let ok = false;
    try { ok = await onSubmit(value.trim()); } finally { setBusy(false); }
    if (ok) setValue('');
  };

  return (
    <div className="flex items-end gap-2">
      <div className="min-h-[44px] min-w-0 flex-1 rounded-3xl border border-orange-500 px-4 py-[11px]">
        <AutoGrowTextarea value={value} onChange={setValue} placeholder={placeholder} />
      </div>
      {onCancel && (
        <button type="button" onClick={onCancel} className="mb-3 shrink-0 text-xs font-bold text-gray-400 transition-colors hover:text-gray-900 dark:hover:text-white">
          Cancel
        </button>
      )}
      <SendButton onClick={send} disabled={!canSend} busy={busy} />
    </div>
  );
}

function RateSeller({
  onSubmit, showToast,
}: {
  onSubmit: (rating: number, text: string) => Promise<boolean>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [rating, setRating] = useState(0);

  const handle = async (text: string) => {
    if (rating === 0) { showToast('Please select a star rating first.', 'error'); return false; }
    const ok = await onSubmit(rating, text);
    if (ok) setRating(0);
    return ok;
  };

  return (
    <div className="border-t border-gray-100 pt-5 dark:border-gray-800">
      <h4 className="mb-3 text-sm font-black">Rate this Seller</h4>
      <div className="mb-3 flex gap-2">
        {[1, 2, 3, 4, 5].map((s) => (
          <IonIcon
            key={s}
            icon={rating >= s ? star : starOutline}
            onClick={() => setRating(s)}
            className={`cursor-pointer text-2xl transition-colors ${rating >= s ? 'text-[#D4AF37]' : 'text-gray-300 hover:text-[#D4AF37]/50 dark:text-gray-600'}`}
          />
        ))}
      </div>
      <ComposeBox placeholder="Write a review (optional)..." onSubmit={handle} allowEmpty />
    </div>
  );
}

function ReportSection({ onSubmit }: { onSubmit: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    let ok = false;
    try { ok = await onSubmit(text.trim()); } finally { setBusy(false); }
    if (ok) { setText(''); setOpen(false); }
  };

  return (
    <div className="flex flex-col items-center border-t border-gray-200 pb-12 pt-8 text-center dark:border-gray-800">
      {!open ? (
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-red-500">
          <IonIcon icon={flagOutline} /> Report this listing
        </button>
      ) : (
        <div className="w-full max-w-sm animate-in fade-in">
          <p className="mb-3 flex items-center justify-center gap-1 text-xs font-bold text-red-500">
            <IonIcon icon={warningOutline} /> Why are you reporting this?
          </p>
          <div className="mb-3 min-h-[80px] rounded-2xl border border-orange-500 px-4 py-3 text-left">
            <AutoGrowTextarea value={text} onChange={setText} placeholder="Spam, inappropriate content, fake item..." maxHeight={200} />
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ borderRadius: 9999 }}
              className="!rounded-full !border !border-gray-300 !px-5 !py-2 text-xs font-bold text-gray-600 transition-colors hover:!bg-gray-100 dark:!border-gray-700 dark:text-gray-300 dark:hover:!bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !text.trim()}
              style={{ borderRadius: 9999 }}
              className="!rounded-full !bg-red-500 !px-5 !py-2 text-xs font-bold text-white transition-colors hover:!bg-red-600 disabled:opacity-50"
            >
              {busy ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Offer typing lives here so the page never re-renders while the buyer types an amount.
function NegotiationBox({
  basePrice, lastPrice, settings, onAccepted, showToast,
}: {
  basePrice: number;
  lastPrice: number;
  settings: any;
  onAccepted: (offer: number) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [raw, setRaw] = useState('');
  const offer = Number(raw.replace(/,/g, '')) || 0;
  const fees = calcFees(offer, settings);

  const handleChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 9);
    setRaw(digits ? Number(digits).toLocaleString('en-US') : '');
  };

  const submit = () => {
    if (offer <= 0) return showToast('Enter the amount you want to offer.', 'error');
    if (offer >= basePrice) return showToast('That matches the asking price. Tap Buy Now instead.', 'error');
    if (offer < lastPrice) return showToast('The seller declined this offer. Try a higher amount.', 'error');
    onAccepted(offer);
  };

  return (
    <div className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800">
      <h4 className="text-sm font-black">This price is negotiable</h4>
      <p className="mb-3 mt-1 text-xs text-gray-500">Enter the amount you want to pay for the item.</p>

      <div className="relative mb-3">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-black text-orange-500">₦</span>
        <input
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Your offer"
          className="w-full rounded-2xl border border-orange-500 bg-transparent py-3 pl-9 pr-4 text-lg font-black text-gray-900 outline-none dark:text-white"
        />
      </div>

      {offer > 0 && (
        <div className="mb-3">
          <EscrowBreakdown priceLabel="Your offer" price={offer} fees={fees} />
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        style={{ borderRadius: 9999 }}
        className="w-full !rounded-full !border !border-orange-500 !px-6 !py-3 font-black text-orange-500 transition-colors hover:!bg-orange-500 hover:text-white"
      >
        Make Offer
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function ProductDetails() {
  const searchParams = useSearchParams();
  const productId = searchParams.get('id');
  const router = useRouter();
  const { toast, showToast, hideToast } = useToast();

  const [product, setProduct] = useState<any>(null);
  const [similarItems, setSimilarItems] = useState<any[]>([]);
  const [otherItemsBySeller, setOtherItemsBySeller] = useState<any[]>([]);
  const [seller, setSeller] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [productQuestions, setProductQuestions] = useState<any[]>([]);
  const [platformSettings, setPlatformSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFullScreenGallery, setIsFullScreenGallery] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [showAllQA, setShowAllQA] = useState(false);
  const [acceptedOffer, setAcceptedOffer] = useState<number | null>(null);

  const topQuestions = useMemo(() => productQuestions.filter((q) => !q.parent_id), [productQuestions]);
  const repliesByParent = useMemo(() => {
    const map: Record<string, any[]> = {};
    productQuestions.forEach((q) => {
      if (q.parent_id) {
        if (!map[q.parent_id]) map[q.parent_id] = [];
        map[q.parent_id].push(q);
      }
    });
    return map;
  }, [productQuestions]);

  useEffect(() => {
    const fetchProductDetails = async () => {
      if (!productId) return;
      try {
        const [productRes, authRes] = await Promise.all([
          supabase.from('products').select('*').eq('id', productId).single(),
          supabase.auth.getUser()
        ]);

        if (productRes.error || !productRes.data) return;

        const productData = productRes.data;
        const user = authRes.data.user;

        let parsedImages: string[] = [];
        if (Array.isArray(productData.images)) {
          parsedImages = productData.images;
        } else if (typeof productData.images === 'string') {
          try { parsedImages = JSON.parse(productData.images); }
          catch { parsedImages = [productData.images]; }
        }

        if (!sessionStorage.getItem(`viewed_${productData.id}`)) {
          supabase.from('product_views').insert({ product_id: productData.id, viewer_id: user?.id || null }).then(() => {});
          sessionStorage.setItem(`viewed_${productData.id}`, 'true');
        }

        const [settingsRes, viewsRes, savedRes, similarRes, sellerRes, reviewsRes, otherRes, qAndARes] = await Promise.all([
          supabase.from('platform_settings').select('*').eq('id', 1).maybeSingle(),
          supabase.from('product_views').select('id', { count: 'exact', head: true }).eq('product_id', productData.id),
          user ? supabase.from('saved_items').select('id').match({ user_id: user.id, product_id: productData.id }).maybeSingle() : Promise.resolve({ data: null }),
          supabase.from('products').select('*, seller:users(username, full_name, avatar_url, is_verified, average_rating)').eq('status', 'ACTIVE').eq('category', productData.category).neq('id', productData.id).limit(4),
          productData.seller_id ? supabase.from('users').select('*').eq('id', productData.seller_id).maybeSingle() : Promise.resolve({ data: null }),
          productData.seller_id ? supabase.from('seller_reviews').select('*, buyer:buyer_id(full_name, avatar_url)').eq('seller_id', productData.seller_id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
          productData.seller_id ? supabase.from('products').select('*, seller:users(username, full_name, avatar_url, is_verified, average_rating)').eq('status', 'ACTIVE').eq('seller_id', productData.seller_id).neq('id', productData.id).limit(4) : Promise.resolve({ data: [] }),
          supabase.from('product_reviews').select('*, user:user_id(full_name, avatar_url, username)').eq('product_id', productData.id).order('created_at', { ascending: true })
        ]);

        if (settingsRes.data) setPlatformSettings(settingsRes.data);
        if (savedRes.data) setIsSaved(true);

        setProduct({ ...productData, images: parsedImages, views_count: viewsRes.count || 0 });

        if (sellerRes.data) setSeller(sellerRes.data);
        else setSeller({ id: 'legacy', full_name: "Legacy User", is_verified: true, average_rating: 0, total_reviews: 0, created_at: new Date().toISOString() });

        const mapSeller = (p: any) => ({ ...p, seller: { username: p.seller?.username || p.seller?.full_name?.split(' ')[0] || 'User', avatar_url: p.seller?.avatar_url, is_verified: p.seller?.is_verified, average_rating: p.seller?.average_rating } });
        if (similarRes.data) setSimilarItems(similarRes.data.map(mapSeller));
        if (otherRes.data) setOtherItemsBySeller(otherRes.data.map(mapSeller));
        if (reviewsRes.data) setReviews(reviewsRes.data);
        if (qAndARes.data) setProductQuestions(qAndARes.data);
      } catch (err) {
        console.error("Critical error loading product:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProductDetails();
  }, [productId]);

  /* ---------------- handlers ---------------- */

  const handleToggleSave = async () => {
    try {
      const userId = await getUserId();
      if (!userId) return showToast('You must log in to save items.', 'error');
      if (isSaved) {
        setIsSaved(false);
        await supabase.from('saved_items').delete().match({ user_id: userId, product_id: product.id });
      } else {
        setIsSaved(true);
        await supabase.from('saved_items').upsert({ user_id: userId, product_id: product.id }, { onConflict: 'user_id,product_id', ignoreDuplicates: true });
      }
    } catch {
      setIsSaved((prev) => !prev); // roll back the optimistic toggle
      showToast(NETWORK_MSG, 'error');
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: product?.title || 'Campus Marketplace', url }); } catch { /* user dismissed */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied!');
      } catch {
        showToast('Could not copy the link.', 'error');
      }
    }
  };

  const submitSellerReview = async (rating: number, text: string): Promise<boolean> => {
    if (!product.seller_id) { showToast('Reviews can only be left for verified sellers.', 'error'); return false; }
    try {
      const userId = await getUserId();
      if (!userId) { showToast('You must be logged in to leave a review.', 'error'); return false; }

      const { error } = await supabase.from('seller_reviews').insert({ seller_id: product.seller_id, buyer_id: userId, rating, review_text: text });
      if (error) { showToast(error.message, 'error'); return false; }

      const { data: fresh } = await supabase.from('seller_reviews').select('*, buyer:buyer_id(full_name, avatar_url)').eq('seller_id', product.seller_id).order('created_at', { ascending: false });
      if (fresh) setReviews(fresh);
      showToast('Thank you for your feedback!');
      return true;
    } catch {
      showToast(NETWORK_MSG, 'error');
      return false;
    }
  };

  const postQuestion = async (text: string, parentId: string | null): Promise<boolean> => {
    if (CONTACT_REGEX.test(text)) { showToast('Message blocked: contact information detected.', 'error'); return false; }
    try {
      const userId = await getUserId();
      if (!userId) { showToast('You must be logged in to post.', 'error'); return false; }

      const { error } = await supabase.from('product_reviews').insert({ content: text, product_id: product.id, user_id: userId, parent_id: parentId });
      if (error) { showToast(error.message, 'error'); return false; }

      const { data } = await supabase.from('product_reviews').select('*, user:user_id(full_name, avatar_url, username)').eq('product_id', product.id).order('created_at', { ascending: true });
      if (data) setProductQuestions(data);
      if (parentId) setReplyingTo(null);
      return true;
    } catch {
      // "TypeError: Failed to fetch" lands here: the request never reached Supabase (offline / blocked / project paused).
      showToast(NETWORK_MSG, 'error');
      return false;
    }
  };

  const reportListing = async (reason: string): Promise<boolean> => {
    try {
      const userId = await getUserId();
      const { error } = await supabase.from('products_report').insert({ product_id: product.id, reporter_id: userId, reason });
      if (error) {
        console.error('Report failed:', error);
        showToast('Could not submit your report. Please try again.', 'error');
        return false;
      }
      showToast('Report submitted. Thank you.');
      return true;
    } catch {
      showToast(NETWORK_MSG, 'error');
      return false;
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    const width = e.currentTarget.offsetWidth;
    setCurrentImageIndex(Math.round(scrollLeft / width));
  };

  /* ---------------- early returns ---------------- */

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-10 md:px-0 pb-10">
        {/* Image & Title */}
        <Skeleton className="mb-6 aspect-[4/3] w-full rounded-3xl" />
        <Skeleton className="mb-3 h-8 w-3/4 rounded-full" />
        <Skeleton className="mb-6 h-10 w-1/3 rounded-full" />

        {/* Badges */}
        <div className="mb-6 flex gap-4 border-b border-gray-100 pb-5 dark:border-gray-800">
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="h-4 w-20 rounded-full" />
        </div>

        {/* Description */}
        <Skeleton className="mb-8 h-32 w-full rounded-2xl" />

        {/* Seller Skeleton */}
        <div className="border-t border-gray-100 py-6 dark:border-gray-800">
          <Skeleton className="mb-4 h-3 w-24 rounded-full" />
          <div className="mb-6 flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32 rounded-full" />
              <Skeleton className="h-3 w-24 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center pt-32 font-bold text-gray-500">
        <IonIcon icon={bookmarkOutline} className="mb-4 text-6xl text-gray-300" />
        <p>Product not found or has been removed.</p>
        <button onClick={() => router.push('/')} className="mt-4 text-orange-500 hover:underline">Return to Feed</button>
      </div>
    );
  }

  /* ---------------- derived values ---------------- */

  const images: string[] = product.images?.length > 0 ? product.images : [];
  const joinYear = seller?.created_at ? new Date(seller.created_at).getFullYear() : "N/A";
  const isSold = product.status === 'SOLD';

  // Price shown to buyers = base_price + platform fee (fee is 0 while the launch promo is active).
  const basePrice = Number(product.base_price || 0);
  const priceFees = calcFees(basePrice, platformSettings);
  const displayPrice = priceFees.total;

  // last_price null/undefined = not negotiable. A value = negotiable, and it is the lowest offer the seller accepts.
  const isNegotiable = product.last_price !== null && product.last_price !== undefined;
  const lastPrice = Number(product.last_price);

  const visibleReviews = showAllReviews ? reviews : reviews.slice(0, PAGE_SIZE);
  const visibleQuestions = showAllQA ? topQuestions : topQuestions.slice(0, PAGE_SIZE);

  return (
    <div className="w-full bg-gray-50 pb-10 text-gray-900 dark:bg-[#0a1120] dark:text-white">

      <Toast {...toast} onClose={hideToast} />

      <ImageViewer images={images} isOpen={isFullScreenGallery} onClose={() => setIsFullScreenGallery(false)} />

      <div className="sticky top-0 z-50 -mx-4 flex items-center justify-between bg-white/90 px-4 py-3 backdrop-blur-md dark:bg-[#0f172a]/90 md:-mx-8 md:px-8">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-transparent text-gray-900 transition-colors hover:bg-black/5 dark:text-white dark:hover:bg-white/10">
          <IonIcon icon={chevronBackOutline} className="text-2xl" />
        </button>
        <div className="flex gap-1">
          <button onClick={handleShare} className="flex h-10 w-10 items-center justify-center rounded-full bg-transparent text-gray-600 transition-colors hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10">
            <IonIcon icon={shareOutline} className="text-xl" />
          </button>
          <button onClick={handleToggleSave} className={`flex h-10 w-10 items-center justify-center rounded-full bg-transparent transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${isSaved ? 'text-orange-500' : 'text-gray-600 dark:text-gray-300'}`}>
            <IonIcon icon={isSaved ? bookmark : bookmarkOutline} className="text-xl" />
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 md:px-0">
        {/* Gallery */}
        <div className="group relative mt-4 aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-3xl bg-black">
          {images.length > 0 ? (
            <>
              <div className="scrollbar-hide flex h-full w-full snap-x snap-mandatory overflow-x-auto" onScroll={handleScroll}>
                {images.map((img, idx) => (
                  <div key={idx} onClick={() => setIsFullScreenGallery(true)} className="relative flex h-full min-w-full flex-shrink-0 snap-center items-center justify-center bg-black">
                    <img src={img} alt={`${product.title} - Image ${idx + 1}`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  </div>
                ))}
              </div>
              {images.length > 1 && (
                <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-10 flex justify-center gap-1.5">
                  {images.map((_, idx) => (
                    <div key={idx} className={`h-1.5 rounded-full transition-all duration-300 ${currentImageIndex === idx ? 'w-6 bg-orange-500' : 'w-2 bg-white/60 backdrop-blur-sm'}`} />
                  ))}
                </div>
              )}
              <button onClick={(e) => { e.stopPropagation(); setIsFullScreenGallery(true); }} className="absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white shadow-lg backdrop-blur-md hover:bg-black/70">
                <IonIcon icon={expandOutline} className="text-lg" />
              </button>
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gray-100 text-gray-400 dark:bg-gray-900">
              <IonIcon icon={imageOutline} className="mb-2 text-5xl opacity-50" />
              <p className="text-sm font-bold">No images provided</p>
            </div>
          )}
          <div className="pointer-events-none absolute left-4 top-4 flex gap-2 rounded-lg bg-black/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white backdrop-blur-md">
            <span>{product.condition}</span>
            {product.quantity && <span className="border-l border-white/30 pl-2">QTY: {product.quantity}</span>}
          </div>
        </div>

        {/* Title + price */}
        <div className="pb-2 pt-6">
          <h1 className="text-2xl font-black leading-tight md:text-3xl">{product.title}</h1>
          <div className="mt-3 flex items-end gap-3">
            <p className="text-3xl font-black text-orange-500">{naira(displayPrice)}</p>
            {product.slashed_price && Number(product.slashed_price) > displayPrice && (
              <p className="mb-1 text-lg font-bold text-gray-400 line-through">{naira(Number(product.slashed_price))}</p>
            )}
          </div>

          <div className="mt-4 flex flex-col items-start gap-x-6 gap-y-3 border-b border-gray-100 pb-5 text-xs font-bold text-gray-500 dark:border-gray-800 sm:flex-row sm:flex-wrap sm:items-center">
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
            <div className="flex items-center gap-1">
              <IonIcon icon={eyeOutline} className="text-base text-gray-400" />
              <span>{product.views_count} views</span>
            </div>
          </div>
        </div>

        {/* Specs + description */}
        <div className="space-y-5 py-4">
          {product.specifications && (
            <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-[#D4AF37]">Specifications</p>
              <p className="text-sm font-bold leading-relaxed text-gray-900 dark:text-white">{product.specifications}</p>
            </div>
          )}
          <div>
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">Description</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">{product.description}</p>
          </div>
        </div>

        {/* Seller: profile -> stats -> recent reviews -> rate this seller */}
        <div className="mt-2 border-t border-gray-100 py-6 dark:border-gray-800">
          <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-gray-500">About the Seller</p>
          {seller && (
            <div className="bg-transparent p-1">
              <div className="mb-4 flex items-start justify-between">
                <div className="flex cursor-pointer items-center gap-3" onClick={() => router.push(`/profile?id=${product.seller_id}`)}>
                  <Avatar src={seller.avatar_url} name={seller.full_name} size="lg" />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-black text-gray-900 hover:underline dark:text-white">{seller.full_name}</h3>
                      <Badge isVerified={seller.is_verified} />
                    </div>
                    <p className="mt-0.5 text-xs font-bold text-gray-500">
                      @{seller.username || seller.full_name?.split(' ')[0]?.toLowerCase() || 'seller'} • Joined {joinYear}
                    </p>
                  </div>
                </div>
              </div>

              <div className="scrollbar-hide mb-6 flex items-center gap-4 overflow-x-auto bg-transparent py-2 sm:gap-6">
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-500">Rating</p>
                  <div className="flex items-center gap-1.5">
                    <IonIcon icon={star} className="text-lg text-[#D4AF37]" />
                    <span className="text-lg font-black leading-none text-gray-900 dark:text-white">{seller.average_rating || 0}</span>
                  </div>
                </div>
                <div className="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-500">Reviews</p>
                  <span className="text-lg font-black leading-none text-gray-900 dark:text-white">{seller.total_reviews || 0}</span>
                </div>
                <div className="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-500">Sales</p>
                  <span className="text-lg font-black leading-none text-gray-900 dark:text-white">12+</span>
                </div>
              </div>

              {reviews.length > 0 && (
                <div className="mb-6 border-t border-gray-100 pt-5 dark:border-gray-800">
                  <h4 className="mb-2 text-sm font-black">Recent Reviews</h4>
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {visibleReviews.map((review) => (
                      <div key={review.id} className="bg-transparent py-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Avatar src={review.buyer?.avatar_url} name={review.buyer?.full_name || "Buyer"} size="sm" />
                            <span className="text-xs font-bold">{review.buyer?.full_name || "Verified Buyer"}</span>
                          </div>
                          <div className="flex text-xs text-[#D4AF37]">
                            {[...Array(review.rating)].map((_, i) => <IonIcon key={i} icon={star} />)}
                          </div>
                        </div>
                        {review.review_text && <p className="text-sm text-gray-600 dark:text-gray-300">{review.review_text}</p>}
                      </div>
                    ))}
                  </div>
                  {reviews.length > PAGE_SIZE && (
                    <button onClick={() => setShowAllReviews((v) => !v)} className="mt-2 text-xs font-bold text-orange-500 hover:underline">
                      {showAllReviews ? 'Show less' : 'Show more..'}
                    </button>
                  )}
                </div>
              )}

              <RateSeller onSubmit={submitSellerReview} showToast={showToast} />
            </div>
          )}
        </div>

        {/* Product Q&A */}
        <div className="mt-2 border-t border-gray-100 py-6 dark:border-gray-800">
          <div className="bg-transparent p-1">
            <h3 className="mb-2 border-b border-gray-100 pb-3 text-lg font-black text-gray-900 dark:border-gray-800 dark:text-white">Product Q&A</h3>

            {topQuestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <IonIcon icon={chatbubblesOutline} className="mb-2 text-4xl text-gray-300 dark:text-gray-700" />
                <p className="text-sm font-bold text-gray-500">No questions yet. Be the first to ask!</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleQuestions.map((question) => (
                  <div key={question.id} className="py-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <Avatar src={question.user?.avatar_url} name={question.user?.full_name || "User"} size="sm" />
                      <p className="text-xs font-bold text-gray-900 dark:text-white">{question.user?.full_name || "Buyer"}</p>
                    </div>
                    <p className="ml-8 text-sm text-gray-700 dark:text-gray-300">{question.content}</p>

                    {(repliesByParent[question.id] || []).map((reply) => {
                      const isSellerReply = reply.user_id === product.seller_id;
                      return (
                        <div key={reply.id} className={`ml-8 mt-2 border-l-2 pl-3 ${isSellerReply ? 'border-orange-500' : 'border-gray-300 dark:border-gray-700'}`}>
                          <div className="mb-1 flex items-center gap-2">
                            {isSellerReply ? (
                              <span className="rounded-sm bg-orange-100 px-2 py-0.5 text-[10px] font-black uppercase text-orange-500 dark:bg-orange-500/10">Seller Reply</span>
                            ) : (
                              <span className="text-xs font-bold text-gray-900 dark:text-white">{reply.user?.full_name}</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{reply.content}</p>
                        </div>
                      );
                    })}

                    <div className="ml-8 mt-2">
                      {replyingTo !== question.id ? (
                        <button onClick={() => setReplyingTo(question.id)} className="text-xs font-bold text-gray-400 transition-colors hover:text-orange-500">Reply to thread</button>
                      ) : (
                        <ComposeBox
                          placeholder="Type your reply..."
                          onSubmit={(text) => postQuestion(text, question.id)}
                          onCancel={() => setReplyingTo(null)}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {topQuestions.length > PAGE_SIZE && (
              <button onClick={() => setShowAllQA((v) => !v)} className="mb-4 mt-1 text-xs font-bold text-orange-500 hover:underline">
                {showAllQA ? 'Show less' : 'Show more..'}
              </button>
            )}

            <div className="mt-2 border-t border-gray-100 bg-transparent pt-4 dark:border-gray-800">
              <p className="mb-2 text-xs font-bold text-gray-500">Ask the seller a question</p>
              <ComposeBox placeholder="Is the item still available?" onSubmit={(text) => postQuestion(text, null)} />
            </div>
          </div>
        </div>

        {/* Buy Now, with the negotiation block underneath */}
        <div className="-mx-4 mt-2 px-4 py-6 md:mx-0 md:px-0">
          <div className="flex flex-col items-center bg-transparent p-1 text-center">
            <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm dark:bg-gray-900 ${isSold ? 'text-gray-400' : 'text-orange-500'}`}>
              <IonIcon icon={shieldCheckmarkOutline} className="text-2xl" />
            </div>
            <h3 className="mb-1 font-black text-gray-900 dark:text-white">Escrow Protected Payment</h3>
            <p className="mb-5 max-w-sm text-xs text-gray-600 dark:text-gray-400">
              Your money is held safely until you receive and inspect the item.
            </p>
            <Button
              onClick={() => router.push(`/buy?id=${product.id}`)}
              disabled={isSold}
              className={`w-full !rounded-full !py-4 !text-lg !font-black transition-all ${
                isSold
                  ? 'cursor-not-allowed !bg-gray-300 !text-gray-500 !shadow-none dark:!bg-gray-800'
                  : 'shadow-none hover:!bg-orange-600'
              }`}
            >
              {isSold ? 'Item Sold Out' : `Buy Now • ${naira(displayPrice)}`}
            </Button>
          </div>

          {isNegotiable && !isSold && (
            <NegotiationBox
              basePrice={basePrice}
              lastPrice={lastPrice}
              settings={platformSettings}
              onAccepted={setAcceptedOffer}
              showToast={showToast}
            />
          )}
        </div>

        {otherItemsBySeller.length > 0 && (
          <div className="-mx-4 border-t border-gray-100 py-6 dark:border-gray-800 md:mx-0">
            <div className="mb-4 flex items-center justify-between px-4">
              <h3 className="font-black text-gray-900 dark:text-white">More from {seller?.full_name || 'Seller'}</h3>
              <button onClick={() => router.push(`/profile?id=${product.seller_id || seller.id}`)} className="text-xs font-bold text-orange-500 hover:underline">
                View All
              </button>
            </div>
            <div className="scrollbar-hide flex snap-x gap-4 overflow-x-auto px-4 pb-4">
              {otherItemsBySeller.map((item) => (
                <div key={item.id} className="w-[160px] flex-shrink-0 snap-start md:w-[200px]">
                  <BuyerProductCard product={item} />
                </div>
              ))}
            </div>
          </div>
        )}

        {similarItems.length > 0 && (
          <div className="-mx-4 mb-8 border-t border-gray-100 px-4 py-6 dark:border-gray-800 md:mx-0 md:px-0">
            <h3 className="mb-4 font-black text-gray-900 dark:text-white">Similar Listings</h3>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
              {similarItems.map((item) => (
                <BuyerProductCard key={item.id} product={item} />
              ))}
            </div>
          </div>
        )}

        <ReportSection onSubmit={reportListing} />
      </div>

      {/* "Price accepted by seller" modal */}
      {acceptedOffer !== null && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setAcceptedOffer(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-[#0f172a]">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 text-green-500">
              <IonIcon icon={checkmarkCircleOutline} className="text-4xl" />
            </div>
            <h3 className="text-lg font-black">Price accepted by seller</h3>
            <p className="mb-4 mt-1 text-xs text-gray-500">Continue to payment to buy at this price.</p>

            <EscrowBreakdown priceLabel="Agreed price" price={acceptedOffer} fees={calcFees(acceptedOffer, platformSettings)} />

            <button
              type="button"
              onClick={() => router.push(`/buy?id=${product.id}&offer=${acceptedOffer}`)}
              style={{ borderRadius: 9999 }}
              className="mt-4 w-full !rounded-full !bg-orange-500 !py-3.5 font-black text-white transition-colors hover:!bg-orange-600"
            >
              Make Payment
            </button>
            <button
              type="button"
              onClick={() => setAcceptedOffer(null)}
              className="mt-3 text-xs font-bold text-gray-500 hover:underline"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}