import React, { useState } from 'react';
import { Skeleton } from '@/shared/Skeleton/Skeleton';
import { IonIcon } from '@ionic/react';
import { imageOutline, timeOutline } from 'ionicons/icons';

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

export const ProductCard = ({
  id, title, price, condition, status, createdAt, imageUrl,
  onEdit, onDelete, onDuplicate, onMarkSold
}: ProductCardProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200/70 dark:border-gray-800/70 flex flex-col h-full bg-white dark:bg-[#0f172a]">
      
      {/* Image Section */}
      <div className="relative w-full aspect-square bg-gray-50 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <>
            {!imageLoaded && <Skeleton className="absolute inset-0 w-full h-full rounded-none" />}
            <img
              src={imageUrl}
              alt={title}
              onLoad={() => setImageLoaded(true)}
              className={`w-full h-full object-cover transition-opacity duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </>
        ) : (
          <IonIcon icon={imageOutline} className="text-4xl text-gray-300 dark:text-gray-700" />
        )}
        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider z-10">{condition}</div>

        {status === 'SOLD' && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-20">
            <span className="bg-red-500 text-white font-black text-sm px-4 py-1 rounded-lg border-2 border-white transform -rotate-12 shadow-2xl tracking-widest uppercase">
              Sold
            </span>
          </div>
        )}
      </div>

      {/* Details & Admin Buttons */}
      <div className="p-2.5 flex flex-col flex-grow">
        <h3 className="font-bold text-gray-900 dark:text-white text-xs mb-0.5 truncate">{title}</h3>
        <p className={`text-base font-black mb-1.5 ${status === 'SOLD' ? 'text-gray-400 line-through' : 'text-orange-500'}`}>
          ₦{price?.toLocaleString()}
        </p>
        <div className="flex items-center gap-1 text-[10px] font-bold text-gray-500 tracking-wider mb-3">
          <IonIcon icon={timeOutline} className="text-xs" />
          <span>{timeAgo(createdAt)}</span>
        </div>

        {/* Action Bar specific to Sellers */}
        <div className="mt-auto flex flex-col gap-1.5 border-t border-gray-100 dark:border-gray-800 pt-2.5">
          <div className="flex gap-1.5">
            <button
              onClick={() => onEdit(id)}
              className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
            >
              Edit
            </button>
            <button
              onClick={() => onDuplicate(id)}
              className="flex-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
            >
              Copy
            </button>
            <button
              onClick={() => onDelete(id)}
              className="flex-[0.7] bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
            >
              Del
            </button>
          </div>

          {status === 'APPROVED' && (
            <button
              onClick={() => onMarkSold(id)}
              className="w-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
            >
              Mark as Sold
            </button>
          )}
        </div>
      </div>
    </div>
  );
};