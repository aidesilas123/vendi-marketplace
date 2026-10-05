"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { IonIcon } from '@ionic/react';
import { 
  arrowDownOutline, 
  arrowUpOutline, 
  shieldCheckmarkOutline,
  timeOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  chevronForwardOutline,
  warningOutline
} from 'ionicons/icons';

interface TransactionCardProps {
  tx: any;
  onClick?: () => void;
}

export const TransactionCard: React.FC<TransactionCardProps> = ({ tx, onClick }) => {
  const router = useRouter();
  const isDisputed = tx.status === 'disputed';

  // A disputed order skips the order details and opens the dispute progress page
  const handleClick = () => {
    if (isDisputed && tx.reference) {
      router.push(`/dispute?ref=${encodeURIComponent(tx.reference)}`);
      return;
    }
    onClick?.();
  };

  const getTxIcon = (type: string) => {
    if (type === 'escrow_hold' || type === 'escrow_release') return shieldCheckmarkOutline;
    if (type === 'credit' || type === 'refund') return arrowDownOutline;
    return arrowUpOutline;
  };

  const getTxColors = (type: string, status: string) => {
    if (status === 'disputed') return 'bg-orange-50 text-orange-600 dark:bg-orange-900/20';
    if (status === 'failed' || status === 'cancelled') return 'bg-red-50 text-red-500 dark:bg-red-900/20';
    if (status === 'pending') return 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20';
    if (type === 'credit' || type === 'escrow_release' || type === 'refund') return 'bg-green-50 text-green-500 dark:bg-green-900/20';
    return 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
  };

  return (
    <div 
      onClick={handleClick}
      className="w-full bg-transparent px-4 py-3.5 flex items-center gap-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5 active:bg-black/10 cursor-pointer"
    >
      <div style={{ borderRadius: '9999px' }} className={`w-10 h-10 flex items-center justify-center flex-shrink-0 ${getTxColors(tx.type, tx.status)}`}>
        <IonIcon icon={getTxIcon(tx.type)} className="text-lg" />
      </div>
      
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-[13px] text-gray-900 dark:text-white truncate">{tx.title}</h4>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">{new Date(tx.created_at).toLocaleDateString()}</p>
          <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600"></span>
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">{new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className={`font-black text-sm ${tx.type === 'credit' || tx.type === 'escrow_release' || tx.type === 'refund' ? 'text-green-500' : 'text-gray-900 dark:text-white'}`}>
          {tx.type === 'credit' || tx.type === 'escrow_release' || tx.type === 'refund' ? '+' : '-'}₦{Math.abs(tx.amount).toLocaleString()}
        </p>
        
        {tx.status === 'pending' && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-yellow-500">
            <IonIcon icon={timeOutline} className="text-[10px]" />
            <p className="text-[8px] font-black uppercase tracking-wider">Pending</p>
          </div>
        )}

        {isDisputed && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-orange-500">
            <IonIcon icon={warningOutline} className="text-[10px]" />
            <p className="text-[8px] font-black uppercase tracking-wider">Disputed</p>
          </div>
        )}
        
        {(tx.status === 'completed' || tx.status === 'successful' || tx.status === 'success') && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-green-500">
            <IonIcon icon={checkmarkCircleOutline} className="text-[10px]" />
            <p className="text-[8px] font-black uppercase tracking-wider">Completed</p>
          </div>
        )}
        
        {(tx.status === 'failed' || tx.status === 'cancelled') && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-red-500">
            <IonIcon icon={closeCircleOutline} className="text-[10px]" />
            <p className="text-[8px] font-black uppercase tracking-wider">{tx.status}</p>
          </div>
        )}
      </div>
      
      <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm ml-1" />
    </div>
  );
};