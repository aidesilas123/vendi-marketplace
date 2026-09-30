"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { IonIcon } from '@ionic/react';
import { imageOutline, timeOutline, ellipsisVertical, createOutline, trashOutline, copyOutline, checkmarkCircleOutline } from 'ionicons/icons';

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

interface ProductCardProps {
  id: string;
  title: string;
  price: number;
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
  id, title, price, condition, status, createdAt, imageUrl,
  onEdit, onDelete, onDuplicate, onMarkSold
}: ProductCardProps) => {
  const router = useRouter();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuAlign, setMenuAlign] = useState<'left' | 'right'>('right');
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  // Listings that are live (ACTIVE = under 7 days old, APPROVED = older) can be marked sold
  const canMarkSold = status === 'APPROVED' || status === 'ACTIVE';

  return (
    <div
      onClick={() => router.push(`/seller/product?id=${id}`)}
      className="rounded-2xl cursor-pointer flex flex-col h-full bg-transparent relative"
    >
      {/* 3-Dots Menu */}
      <div ref={menuRef} className="absolute top-2 right-2 z-30">
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className="w-9 h-9 flex items-center justify-center text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] hover:opacity-70 active:scale-90 transition-all duration-150"
        >
          <IonIcon icon={ellipsisVertical} className="text-2xl" />
        </button>

        {/* Dropdown — flips side based on available space */}
        <div
          className={`absolute top-10 w-52 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden transition-all duration-150 ease-out z-40
            ${menuAlign === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}
            ${isMenuOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}
        >
          <button
            onClick={(e) => handleAction(e, onEdit)}
            className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 border-b border-gray-100 dark:border-gray-700 transition-colors"
          >
            <IonIcon icon={createOutline} className="!text-lg" />
            Edit
          </button>
          <button
            onClick={(e) => handleAction(e, onDuplicate)}
            className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b border-gray-100 dark:border-gray-700 transition-colors"
          >
            <IonIcon icon={copyOutline} className="!text-lg" />
            Duplicate
          </button>
          {canMarkSold && (
            <button
              onClick={(e) => handleAction(e, onMarkSold)}
              className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 border-b border-gray-100 dark:border-gray-700 transition-colors"
            >
              <IonIcon icon={checkmarkCircleOutline} className="!text-lg" />
              Mark Sold
            </button>
          )}
          <button
            onClick={(e) => handleAction(e, onDelete)}
            className="w-full flex items-center gap-3 !px-5 !py-3 !text-base font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <IonIcon icon={trashOutline} className="!text-lg" />
            Delete
          </button>
        </div>
      </div>

      {/* Image Section */}
      <div className="relative w-full aspect-square bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden rounded-t-2xl">
        {imageUrl ? (
          <>
            {!imageLoaded && <Skeleton className="absolute inset-0 w-full h-full rounded-none" />}
            <img
              src={imageUrl}
              alt={title}
              loading="lazy"
              decoding="async"
              onLoad={() => setImageLoaded(true)}
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
        <h3 className="font-bold text-gray-900 dark:text-white text-xs mb-0.5 truncate">{title}</h3>
        <div className="flex items-center justify-between mt-auto">
          <p className={`text-sm font-black ${status === 'SOLD' ? 'text-gray-400 line-through' : 'text-orange-500'}`}>
            ₦{price?.toLocaleString()}
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