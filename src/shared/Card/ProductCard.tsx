"use client";

import React, { useState, useRef, useEffect } from 'react';
import { IonIcon } from '@ionic/react';
import { imageOutline, ellipsisVertical, createOutline, trashOutline, copyOutline, checkmarkCircleOutline } from 'ionicons/icons';
import Link from 'next/link';

export interface ProductCardProps {
  id: string;
  title: string;
  price: number;
  condition: string;
  status: string;
  createdAt: string; 
  imageUrl?: string;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void; 
  onMarkSold?: (id: string) => void; 
}

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
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
};

export const ProductCard = ({
  id,
  title,
  price,
  condition,
  status,
  createdAt,
  imageUrl,
  onEdit,
  onDelete,
  onDuplicate,
  onMarkSold
}: ProductCardProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getStatusStyles = (status: string) => {
    switch(status) {
      case 'APPROVED': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800';
      case 'REJECTED': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800';
      case 'PENDING_REVIEW': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800';
      case 'SOLD': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800';
      case 'DRAFT': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700';
    }
  };

  const handleAction = (e: React.MouseEvent, action: (() => void) | undefined) => {
    e.preventDefault(); 
    e.stopPropagation(); 
    setIsMenuOpen(false);
    if (action) action();
  };

  return (
    <div className="relative group">
      {/* Sleek Floating 3-Dot Menu */}
      <div className="absolute top-1.5 right-1.5 z-20" ref={menuRef}>
        <button 
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }}
          className="p-1.5 text-white hover:text-orange-400 transition-colors"
        >
          <IonIcon icon={ellipsisVertical} className="text-2xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" />
        </button>

        {/* Premium Spaced Dropdown Menu (Mobile Optimized) */}
        {isMenuOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#1e293b] rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 z-30">
            {onEdit && (
              <button onClick={(e) => handleAction(e, () => onEdit(id))} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <IonIcon icon={createOutline} className="text-lg text-gray-500 dark:text-gray-400" /> 
                <span>Edit Listing</span>
              </button>
            )}
            
            {/* Only show Duplicate & Mark as Sold if NOT pending or rejected */}
            {status !== 'PENDING_REVIEW' && status !== 'REJECTED' && (
              <>
                {onDuplicate && (
                  <>
                    <div className="w-full h-px bg-gray-100 dark:bg-gray-800 my-0.5"></div>
                    <button onClick={(e) => handleAction(e, () => onDuplicate(id))} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                      <IonIcon icon={copyOutline} className="text-lg text-gray-500 dark:text-gray-400" /> 
                      <span>Duplicate</span>
                    </button>
                  </>
                )}
                
                {onMarkSold && status !== 'SOLD' && (
                  <>
                    <div className="w-full h-px bg-gray-100 dark:bg-gray-800 my-0.5"></div>
                    <button onClick={(e) => handleAction(e, () => onMarkSold(id))} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">
                      <IonIcon icon={checkmarkCircleOutline} className="text-lg" /> 
                      <span>Mark as Sold</span>
                    </button>
                  </>
                )}
              </>
            )}
            
            {onDelete && (
              <>
                <div className="w-full h-px bg-gray-100 dark:bg-gray-800 my-0.5"></div>
                <button onClick={(e) => handleAction(e, () => onDelete(id))} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <IonIcon icon={trashOutline} className="text-lg" /> 
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <Link href={`/seller/product/${id}`} className="block bg-white dark:bg-[#0f172a] rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md hover:border-orange-500/50 transition-all flex flex-col h-full">
        
        <div className={`absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border shadow-sm backdrop-blur-md ${getStatusStyles(status)}`}>
          {status.replace('_', ' ')}
        </div>

        <div className="relative aspect-square bg-gray-50 dark:bg-[#1e293b] flex items-center justify-center overflow-hidden border-b border-gray-100 dark:border-gray-800">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
          ) : (
            <IonIcon icon={imageOutline} className="text-3xl text-gray-300 dark:text-gray-600" />
          )}
        </div>

        <div className="p-3.5 flex-1 flex flex-col">
          <div className="flex justify-between items-start mb-1.5">
            <h3 className="font-bold text-sm text-gray-900 dark:text-white line-clamp-1 pr-2">{title || 'Untitled Item'}</h3>
          </div>
          
          <div className="flex justify-between items-center mb-3">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              {condition || 'Unknown Condition'}
            </p>
            <p className="text-[10px] font-bold text-gray-400/80">
              {timeAgo(createdAt)}
            </p>
          </div>

          <div className="mt-auto">
            <p className="text-lg font-black text-orange-500">₦{price.toLocaleString()}</p>
          </div>
        </div>
      </Link>
    </div>
  );
};