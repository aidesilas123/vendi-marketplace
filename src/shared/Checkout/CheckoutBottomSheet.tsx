import React, { useState, useEffect, useRef } from 'react';
import { IonIcon } from '@ionic/react';
import { closeOutline, shieldCheckmarkOutline } from 'ionicons/icons';

interface CheckoutBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  product: any;
  itemPrice: number;
  buyerFee: number;
  totalCharge: number;
  isPromo: boolean;
  wallet: any;
  hasEnoughFunds: boolean;
  onConfirmPayment: () => void;
  onTopUp: () => void;
}

export const CheckoutBottomSheet = ({
  isOpen, onClose, product, itemPrice, buyerFee, totalCharge, isPromo, wallet, hasEnoughFunds, onConfirmPayment, onTopUp
}: CheckoutBottomSheetProps) => {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  // Reset drag position when opened/closed
  useEffect(() => {
    if (!isOpen) setDragY(0);
  }, [isOpen]);

  // Touch logic for drag-to-close
  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    if (diff > 0) {
      setDragY(diff);
    }
  };

  const handleTouchEnd = () => {
    if (dragY > 100) {
      onClose();
    } else {
      setDragY(0);
    }
    startY.current = null;
  };

  // Keep component mounted to allow CSS transitions, but hide it from clicks when closed
  return (
    <div 
      className={`fixed inset-0 z-[200] transition-all duration-300 ${
        isOpen ? 'pointer-events-auto visible' : 'pointer-events-none invisible transition-[visibility] delay-300'
      }`}
    >
      {/* Background Blur Overlay */}
      <div 
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`} 
        onClick={onClose} 
      />
      
      {/* The Bottom Sheet */}
      <div 
        className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#0f172a] rounded-t-[32px] shadow-2xl will-change-transform"
        style={{
          transform: isOpen ? `translateY(${dragY > 0 ? dragY : 0}px)` : 'translateY(100%)',
          transition: dragY > 0 ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="p-6 pb-10 max-w-xl mx-auto">
          
          {/* Drag Handle Indicator */}
          <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mb-6" />

          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-gray-900 dark:text-white">Checkout summary</h3>
            <button onClick={onClose} className="p-2 -mr-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors bg-transparent border-none outline-none">
              <IonIcon icon={closeOutline} className="text-3xl" />
            </button>
          </div>
          
          {/* Order Summary (No Background Card) */}
          <div className="mb-8">
            <div className="flex gap-4 items-center mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
               {product?.images?.[0] && <img src={product.images[0]} alt="Product" className="w-16 h-16 rounded-2xl object-cover" />}
               <div>
                  <h4 className="font-bold text-base text-gray-900 dark:text-white leading-tight line-clamp-1">{product?.title}</h4>
                  <p className="text-xs text-gray-500 mt-1 font-bold">Qty: {product?.quantity || 1}</p>
               </div>
            </div>
            
            <div className="flex justify-between items-center text-sm mb-3">
              <span className="text-gray-500 font-bold">Item Price</span>
              <span className="font-black text-gray-900 dark:text-white">₦{itemPrice.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500 font-bold">Escrow Fee</span>
              <span className={`font-black ${isPromo ? 'text-green-500 bg-green-500/10 px-2 py-0.5 rounded-sm' : 'text-orange-500'}`}>
                {isPromo ? 'Free (Promo)' : `₦${buyerFee.toLocaleString()}`}
              </span>
            </div>
            <div className="flex justify-between items-center border-t border-gray-100 dark:border-gray-800 pt-4 mt-4">
              <span className="text-gray-500 font-black">Total Due</span>
              <span className="font-black text-orange-500 text-2xl">₦{totalCharge.toLocaleString()}</span>
            </div>
          </div>

          {/* Wallet Balance */}
          <div className="flex justify-between items-center mb-8">
             <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-orange-50 dark:bg-orange-500/10 text-orange-500 flex items-center justify-center">
                   <IonIcon icon={shieldCheckmarkOutline} className="text-2xl" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Wallet Balance</p>
                   <p className="font-black text-xl text-gray-900 dark:text-white leading-none mt-1">₦{Number(wallet?.balance || 0).toLocaleString()}</p>
                </div>
             </div>
          </div>

          {/* Thickened Action Buttons with strict Inline height overrides */}
          {hasEnoughFunds ? (
            <button 
              onClick={onConfirmPayment}
              style={{ minHeight: '60px', height: '60px', borderRadius: '9999px' }}
              className="w-full border-none outline-none flex items-center justify-center bg-orange-500 hover:bg-orange-600 text-white font-black text-lg transition-colors cursor-pointer active:scale-[0.98]"
            >
              Confirm Payment
            </button>
          ) : (
            <button 
              onClick={onTopUp}
              style={{ minHeight: '60px', height: '60px', borderRadius: '9999px' }}
              className="w-full border-none outline-none flex items-center justify-center bg-gray-900 dark:bg-white hover:opacity-90 text-white dark:text-gray-900 font-black text-lg transition-colors cursor-pointer active:scale-[0.98]"
            >
              Top Up Wallet
            </button>
          )}
        </div>
      </div>
    </div>
  );
};