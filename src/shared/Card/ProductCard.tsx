"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { IonIcon } from '@ionic/react';
import { imageOutline, timeOutline, ellipsisVertical, createOutline, trashOutline, copyOutline, checkmarkCircleOutline } from 'ionicons/icons';

const timeAgo = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

// Cards show a small square image, so asking Supabase for a resized copy saves a lot of data on mobile.
// Image transformations are only available on some Supabase plans, so this is OFF by default.
// Turn it on if your plan includes them. If a resized image fails to load, the card falls
// back to the original automatically.
const USE_IMAGE_TRANSFORMS = false;
const THUMB_WIDTH = 400;
const THUMB_QUALITY = 70;

const toThumbnail = (url: string) => {
  const marker = '/storage/v1/object/public/';
  if (!USE_IMAGE_TRANSFORMS || !url.includes(marker)) return url;
  const resized = url.replace(marker, '/storage/v1/render/image/public/');
  return `${resized}${resized.includes('?') ? '&' : '?'}width=${THUMB_WIDTH}&quality=${THUMB_QUALITY}`;
};

interface ProductCardProps {
  id: string;
  title: string;
  basePrice: number;
  condition: string;
  status: string;
  createdAt: string;
  imageUrl?: string | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMarkSold: (id: string) => void;
}

const DROPDOWN_WIDTH = 208; // px — matches w-52 below
const VIEWPORT_MARGIN = 8;  // keep a small gap from the screen edge

export const ProductCard = ({
  id, title, basePrice, condition, status, createdAt, imageUrl,
  onEdit, onDelete, onDuplicate, onMarkSold
}: ProductCardProps) => {
  const router = useRouter();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuAlign, setMenuAlign] = useState<'left' | 'right'>('right');
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A different image means start the loading state over
  useEffect(() => {
    setImageLoaded(false);
    setThumbFailed(false);
    setImageFailed(false);
  }, [imageUrl]);

  const imageSrc = imageUrl ? (thumbFailed ? imageUrl : toThumbnail(imageUrl)) : null;

  const handleImageError = () => {
    if (!thumbFailed && imageUrl && imageSrc !== imageUrl) {
      setThumbFailed(true); // resized copy failed: try the original once
    } else {
      setImageFailed(true); // original failed too: show the placeholder instead of a stuck skeleton
    }
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isMenuOpen && buttonRef.current) {
      // Measure available space BEFORE opening, so it renders in the
      // correct spot immediately instead of flashing off-screen first.
      const rect = buttonRef.current.getBoundingClientRect();
      const wouldOverflowLeft = rect.right - DROPDOWN_WIDTH < VIEWPORT_MARGIN;
      setMenuAlign(wouldOverflowLeft ? 'left' : 'right');
    }
    setIsMenuOpen(!isMenuOpen);
  };

  const handleAction = (e: React.MouseEvent, action: (id: string) => void) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    action(id);
  };

  // Close on outside tap/click (pointer events cover mouse and touch) or Escape
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isMenuOpen]);

  // Listings that are live (ACTIVE = under 7 days old, APPROVED = older) can be marked sold
  const canMarkSold = status === 'APPROVED' || status === 'ACTIVE';

  // Sold listings are final: no editing them
  const canEdit = status !== 'SOLD';

  // Duplicates are published straight away, so only live listings that already passed review can be copied
  const canDuplicate = status === 'ACTIVE' || status === 'APPROVED';

  return (
    <div
      onClick={() => router.push(`/seller/product?id=${id}`)}
      className="rounded-2xl cursor-pointer flex flex-col h-full bg-transparent relative"
    >
      {/* 3-Dots Menu. stopPropagation so a tap anywhere inside it never opens the product page. */}
      <div ref={menuRef} onClick={(e) => e.stopPropagation()} className="absolute top-2 right-2 z-30">
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          aria-label="Listing options"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          className="w-9 h-9 flex items-center justify-center text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] hover:opacity-70 active:scale-90 transition-all duration-150"
        >
          <IonIcon icon={ellipsisVertical} className="text-2xl" />
        </button>

        {/* Dropdown: only exists while open (keeps the grid light), flips side based on available space */}
        {isMenuOpen && (
          <div
            role="menu"
            className={`absolute top-10 w-52 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden z-40 animate-in fade-in zoom-in-95 duration-150
              ${menuAlign === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}`}
          >
            {canEdit && (
              <button
                role="menuitem"
                onClick={(e) => handleAction(e, onEdit)}
                className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 border-b border-gray-100 dark:border-gray-700 transition-colors"
              >
                <IonIcon icon={createOutline} className="!text-lg" />
                Edit
              </button>
            )}

            {canDuplicate && (
              <button
                role="menuitem"
                onClick={(e) => handleAction(e, onDuplicate)}
                className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b border-gray-100 dark:border-gray-700 transition-colors"
              >
                <IonIcon icon={copyOutline} className="!text-lg" />
                Duplicate
              </button>
            )}

            {canMarkSold && (
              <button
                role="menuitem"
                onClick={(e) => handleAction(e, onMarkSold)}
                className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 border-b border-gray-100 dark:border-gray-700 transition-colors"
              >
                <IonIcon icon={checkmarkCircleOutline} className="!text-lg" />
                Mark Sold
              </button>
            )}

            <button
              role="menuitem"
              onClick={(e) => handleAction(e, onDelete)}
              className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <IonIcon icon={trashOutline} className="!text-lg" />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Image Section */}
      <div className="relative w-full aspect-square bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden rounded-t-2xl">
        {imageSrc && !imageFailed ? (
          <>
            {!imageLoaded && <Skeleton className="absolute inset-0 w-full h-full rounded-none" />}
            <img
              key={imageSrc}
              src={imageSrc}
              alt={title}
              loading="lazy"
              decoding="async"
              onLoad={() => setImageLoaded(true)}
              onError={handleImageError}
              className={`w-full h-full object-cover transition-all duration-500 hover:scale-105 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </>
        ) : (
          <IonIcon icon={imageOutline} className="text-4xl text-gray-300 dark:text-gray-700" />
        )}
        <div className="absolute top-2 left-2 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider z-10">{condition}</div>

        {status === 'SOLD' && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-20">
            <span className="bg-red-500 text-white font-black text-sm px-4 py-1 rounded-lg border-2 border-white transform -rotate-12 shadow-2xl tracking-widest uppercase">
              Sold
            </span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="p-2.5 flex flex-col flex-grow rounded-b-2xl">
        <h3 className="font-bold text-gray-900 dark:text-white text-[10px] mb-0.5 truncate">{title}</h3>
        <div className="flex items-center justify-between mt-auto">
          {/* Swapped to price (which maps to product.base_price from SellerDashboard) */}
          <p className={`text-sm font-black ${status === 'SOLD' ? 'text-gray-400 line-through' : 'text-orange-500'}`}>
            ₦{basePrice?.toLocaleString('en-NG')}
          </p>
          <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500 tracking-wider">
            <IonIcon icon={timeOutline} className="text-xs" />
            <span>{timeAgo(createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};