"use client";

import React, { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { IonIcon } from '@ionic/react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { calcFees, naira } from '@/lib/pricing';
import { useSavedIds } from '@/shared/hooks/useSavedIds';
import { usePlatformSettings } from '@/shared/hooks/usePlatformSettings';
import { imageOutline, schoolOutline, timeOutline, eyeOutline, bookmarkOutline, bookmark, star } from 'ionicons/icons';
import { Toast, useToast } from '@/shared/Toast/Toast';

const timeAgo = (dateString: string) => {
  const then = new Date(dateString).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

const formatViews = (n: number) => {
  const label = n === 1 ? 'view' : 'views';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m ${label}`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k ${label}`;
  return `${n} ${label}`;
};

/**
 * Ask Supabase for a smaller image. If image transformations aren't enabled on your
 * plan (or the URL isn't a Supabase one), the card falls back to the original on error.
 */
const optimizeImage = (url: string, width = 480) => {
  const marker = '/storage/v1/object/public/';
  if (!url.includes(marker) || url.includes('?')) return url;
  return url.replace(marker, '/storage/v1/render/image/public/') + `?width=${width}&quality=70`;
};

interface BuyerProductCardProps {
  product: {
    id: string;
    title: string;
    base_price?: number;
    buyer_price?: number; // Kept as fallback for older cached data
    condition: string;
    status: string;
    university_id?: string;
    campus: string;
    created_at: string;
    images: string[] | string | null;
    views_count?: number;
    seller: {
      username: string;
      avatar_url?: string | null;
      is_verified: boolean;
      average_rating?: number | string | null;
    };
  };
  /** Called after the user removes the item from saved (e.g. to refresh the Saved tab) */
  onUnsave?: (productId: string) => void;
}

const BuyerProductCardBase = ({ product, onUnsave }: BuyerProductCardProps) => {
  const router = useRouter();
  const { savedIds, toggle } = useSavedIds();
  const { settings, isLoading: settingsLoading } = usePlatformSettings();
  const { toast, showToast, hideToast } = useToast();

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [useOriginalImage, setUseOriginalImage] = useState(false);
  const savePending = useRef(false);

  const isSaved = savedIds.has(product.id);

  const coverImage = useMemo<string | null>(() => {
    if (Array.isArray(product.images) && product.images.length > 0) return product.images[0];
    if (typeof product.images === 'string') {
      try { return JSON.parse(product.images)[0] ?? null; }
      catch { return product.images; }
    }
    return null;
  }, [product.images]);

  const imageSrc = coverImage ? (useOriginalImage ? coverImage : optimizeImage(coverImage)) : null;

  // Cached images can finish loading before React attaches onLoad, so check on mount too
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) setImageLoaded(true);
  }, []);

  const handleImageError = () => {
    if (!useOriginalImage && coverImage && imageSrc !== coverImage) {
      setImageLoaded(false);
      setUseOriginalImage(true); // transformed URL failed, retry once with the original
    } else {
      setImageFailed(true);
    }
  };

  const handleSaveClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (savePending.current) return;
    savePending.current = true;

    // Just ONE light tap here to acknowledge the physical button press
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    
    const result = await toggle(product.id);
    savePending.current = false;

    if (result === 'unauthenticated') {
      // The double tap is now handled automatically by showToast!
      showToast('Please log in to save items', 'error');
    } else if (result === 'removed') {
      onUnsave?.(product.id);
    }
  };

  // Price is held (skeleton) until platform settings arrive so it never jumps
  const basePrice = Number(product.base_price || product.buyer_price || 0);
  const displayPrice = useMemo(() => calcFees(basePrice, settings).total, [basePrice, settings]);

  const rating = Number(product.seller?.average_rating);
  const views = product.views_count || 0;

  return (
    <div
      className="relative flex flex-col h-full bg-transparent transition-transform active:scale-[0.98]"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 300px' }}
    >
      <Toast {...toast} onClose={hideToast} />
      
      {/* Whole-card link (real <a>: prefetching, long-press, correct semantics) */}
      <Link
        href={`/product?id=${product.id}`}
        aria-label={product.title}
        className="absolute inset-0 z-[5]"
      />

      <div className="px-1 py-2 flex items-center gap-1.5 overflow-hidden w-full">
        <Avatar src={product.seller?.avatar_url} name={product.seller?.username || 'User'} size="sm" />
        <span className="text-[10px] font-bold text-gray-900 dark:text-white truncate">@{product.seller?.username || 'user'}</span>
        <Badge isVerified={product.seller?.is_verified} className="flex-shrink-0" />
      </div>

      <div className="relative w-full aspect-square bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden rounded-2xl">

        {/* Save button: 44px touch target, sits above the card link */}
        <button
          type="button"
          onClick={handleSaveClick}
          aria-label={isSaved ? 'Remove from saved' : 'Save item'}
          aria-pressed={isSaved}
          className="absolute top-0 right-0 w-11 h-11 flex items-center justify-center bg-transparent transition-transform active:scale-90 z-10"
        >
          <IonIcon icon={isSaved ? bookmark : bookmarkOutline} className="text-2xl text-orange-500" />
        </button>

        {imageSrc && !imageFailed ? (
          <>
            {!imageLoaded && (
              <Skeleton className="absolute inset-0 w-full h-full rounded-none" />
            )}
            <img
              ref={imgRef}
              key={imageSrc}
              src={imageSrc}
              alt={product.title}
              loading="lazy"
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              onError={handleImageError}
              className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </>
        ) : (
          <IonIcon icon={imageOutline} className="text-4xl text-gray-300 dark:text-gray-700" />
        )}

        <div className="absolute top-2 left-2 bg-black/70 text-white text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider z-10 pointer-events-none">
          {product.condition}
        </div>

        {product.status === 'SOLD' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20 pointer-events-none">
            <span className="bg-red-500 text-white font-black text-lg px-5 py-1.5 rounded-xl border-2 border-white transform -rotate-12 shadow-2xl tracking-widest uppercase">
              Sold
            </span>
          </div>
        )}
      </div>

      <div className="py-2.5 px-1 flex flex-col flex-grow">
        <h3 className="font-bold text-gray-900 dark:text-gray-200 text-[10px] mb-1 leading-tight line-clamp-2">{product.title}</h3>

        {settingsLoading ? (
          <Skeleton className="w-16 h-5 rounded-full mb-2" />
        ) : (
          <p className={`text-sm font-black mb-2 ${product.status === 'SOLD' ? 'text-gray-400 line-through' : 'text-orange-500'}`}>
            {naira(displayPrice)}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-2 text-[10px] font-bold text-gray-500 tracking-wider mb-2 border-b border-gray-100 dark:border-gray-800 pb-2">
          <div className="flex items-center gap-1 uppercase min-w-0">
            <IonIcon icon={schoolOutline} className="text-xs flex-shrink-0" />
            <span className="truncate">{product.university_id || product.campus}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <IonIcon icon={timeOutline} className="text-xs" />
            <span>{timeAgo(product.created_at)}</span>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10px] font-black text-gray-700 dark:text-gray-300">
            <IonIcon icon={star} className="text-[#D4AF37] text-xs" />
            <span>{rating > 0 ? rating.toFixed(1) : 'New'}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
            <IonIcon icon={eyeOutline} className="text-xs" />
            <span>{formatViews(views)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Memoised so typing in the search box doesn't re-render every card
export const BuyerProductCard = React.memo(BuyerProductCardBase);