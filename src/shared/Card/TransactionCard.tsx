"use client";

import React from 'react';
import { IonIcon } from '@ionic/react';
import { 
  arrowDownOutline, 
  arrowUpOutline, 
  shieldCheckmarkOutline,
  timeOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  chevronForwardOutline
} from 'ionicons/icons';

interface TransactionCardProps {
  tx: any;
  onClick?: () => void;
}

export const TransactionCard: React.FC<TransactionCardProps> = ({ tx, onClick }) => {
  const getTxIcon = (type: string) => {
    if (type === 'escrow_hold' || type === 'escrow_release') return shieldCheckmarkOutline;
    if (type === 'credit') return arrowDownOutline;
    return arrowUpOutline;
  };

  const getTxColors = (type: string, status: string) => {
    if (status === 'failed') return 'bg-red-100 text-red-500 dark:bg-red-900/30';
    if (status === 'pending') return 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30';
    if (type === 'credit' || type === 'escrow_release') return 'bg-green-100 text-green-600 dark:bg-green-900/30';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  };

  return (
    <div 
      onClick={onClick}
      // FIX: Changed background to transparent, removed hard borders, added a subtle hover effect to create a pure floating layout
      className={`bg-transparent dark:bg-transparent !rounded-3xl p-4 flex items-center gap-4 transition-all hover:bg-black/5 dark:hover:bg-white/5 ${
        tx.status === 'pending' ? 'cursor-pointer opacity-100' : 'opacity-90'
      }`}
    >
      <div className={`w-12 h-12 !rounded-full flex items-center justify-center flex-shrink-0 ${getTxColors(tx.type, tx.status)}`}>
        <IonIcon icon={getTxIcon(tx.type)} className="text-xl" />
      </div>
      
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-sm text-gray-900 dark:text-white truncate">{tx.title}</h4>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{new Date(tx.created_at).toLocaleDateString()}</p>
          <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600"></span>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className={`font-black text-base ${tx.type === 'credit' || tx.type === 'escrow_release' ? 'text-green-500' : 'text-gray-900 dark:text-white'}`}>
          {tx.type === 'credit' || tx.type === 'escrow_release' ? '+' : '-'}₦{Math.abs(tx.amount).toLocaleString()}
        </p>
        
        {tx.status === 'pending' && (
          <div className="flex items-center justify-end gap-1 mt-1 text-yellow-500">
            <IonIcon icon={timeOutline} className="text-xs" />
            <p className="text-[9px] font-black uppercase tracking-wider">Pending</p>
          </div>
        )}
        
        {/* FIX: Now safely catches both 'completed' and 'successful' statuses */}
        {(tx.status === 'completed' || tx.status === 'successful' || tx.status === 'success') && (
          <div className="flex items-center justify-end gap-1 mt-1 text-green-500">
            <IonIcon icon={checkmarkCircleOutline} className="text-xs" />
            <p className="text-[9px] font-black uppercase tracking-wider">Completed</p>
          </div>
        )}
        
        {tx.status === 'failed' && (
          <div className="flex items-center justify-end gap-1 mt-1 text-red-500">
            <IonIcon icon={closeCircleOutline} className="text-xs" />
            <p className="text-[9px] font-black uppercase tracking-wider">Failed</p>
          </div>
        )}
      </div>
      
      <IonIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-lg ml-1" />
    </div>
  );
};