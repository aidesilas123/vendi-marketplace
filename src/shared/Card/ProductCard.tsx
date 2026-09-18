import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/shared/Avatar';
import { Badge } from '@/shared/Badge';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { IonIcon } from '@ionic/react';
import { supabase } from '@/lib/supabase';
import { imageOutline, schoolOutline, timeOutline, eyeOutline, bookmarkOutline, bookmark, star } from 'ionicons/icons';

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

interface BuyerProductCardProps {
  product: {
    id: string;
    title: string;
    buyer_price: number;
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
      average_rating?: number;
    }
  };
  initialSaved?: boolean;
  onUnsave?: (productId: string) => void;
}

export const BuyerProductCard = ({ product, initialSaved = false, onUnsave }: BuyerProductCardProps) => {
  const router = useRouter();
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [imageLoaded, setImageLoaded] = useState(false);

  let coverImage = null;
  if (Array.isArray(product.images) && product.images.length > 0) coverImage = product.images[0];
  else if (typeof product.images === 'string') {
    try { coverImage = JSON.parse(product.images)[0]; }
    catch { coverImage = product.images; }
  }

  const handleSaveClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      alert("Please log in to save items.");
      return;
    }
    if (isSaved) {
      setIsSaved(false);
      onUnsave?.(product.id);
      await supabase.from('saved_items').delete().match({ user_id: session.user.id, product_id: product.id });
    } else {
      setIsSaved(true);
      await supabase.from('saved_items').insert({ user_id: session.user.id, product_id: product.id });
    }
  };

  return (
    <div
      onClick={() => router.push(`/product?id=${product.id}`)}
      className="rounded-2xl overflow-hidden border border-gray-200/70 dark:border-gray-800/70 hover:border-gray-300 dark:hover:border-gray-700 transition-all cursor-pointer flex flex-col h-full"
    >
      {/* Tightened top bar padding */}
      <div className="px-2.5 py-1.5 flex justify-between items-center">
        <div className="flex items-center gap-1.5 overflow-hidden pr-2">
          <Avatar src={product.seller?.avatar_url} name={product.seller?.username || 'User'} size="sm" />
          <span className="text-[10px] font-bold text-gray-900 dark:text-white truncate">@{product.seller?.username || 'user'}</span>
          <Badge isVerified={product.seller?.is_verified} className="flex-shrink-0" />
        </div>
        <button onClick={handleSaveClick} className="w-7 h-7 flex flex-shrink-0 items-center justify-center text-gray-400 hover:text-orange-500 bg-transparent transition-colors">
          <IonIcon icon={isSaved ? bookmark : bookmarkOutline} className={`text-lg ${isSaved ? 'text-orange-500' : ''}`} />
        </button>
      </div>

      <div className="relative w-full aspect-square bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
        {coverImage ? (
          <>
            {!imageLoaded && (
              <Skeleton className="absolute inset-0 w-full h-full rounded-none" />
            )}
            <img
              src={coverImage}
              alt={product.title}
              onLoad={() => setImageLoaded(true)}
              className={`w-full h-full object-cover hover:scale-105 transition-transform duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </>
        ) : (
          <IonIcon icon={imageOutline} className="text-4xl text-gray-300 dark:text-gray-700" />
        )}
        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider z-10">{product.condition}</div>

        {product.status === 'SOLD' && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-20">
            <span className="bg-red-500 text-white font-black text-sm px-4 py-1 rounded-lg border-2 border-white transform -rotate-12 shadow-2xl tracking-widest uppercase">
              Sold
            </span>
          </div>
        )}
      </div>

      {/* Tightened internal padding and spacing */}
      <div className="p-2.5 flex flex-col flex-grow">
        <h3 className="font-bold text-gray-900 dark:text-white text-xs mb-0.5 truncate">{product.title}</h3>
        <p className={`text-base font-black mb-1.5 ${product.status === 'SOLD' ? 'text-gray-400 line-through' : 'text-orange-500'}`}>
          ₦{product.buyer_price?.toLocaleString()}
        </p>
        
        {/* Removed bottom border and padding to compress height */}
        <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-2 text-[10px] font-bold text-gray-500 tracking-wider mb-2">
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
          <div className="flex items-center gap-1 text-[11px] font-black text-gray-700 dark:text-gray-300">
            <IonIcon icon={star} className="text-[#D4AF37] text-xs" />
            <span>{product.seller?.average_rating ? product.seller.average_rating.toFixed(1) : 'New'}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
            <IonIcon icon={eyeOutline} className="text-xs" />
            <span>{product.views_count || 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
};