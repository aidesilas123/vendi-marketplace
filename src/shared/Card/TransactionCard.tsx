"use client";

import React, { useEffect, useState } from 'react';
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

// Wrapper to prevent Next.js hydration errors from Ionicons injecting classes/roles
function ClientIcon({ icon, className }: { icon: string; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <span className={className} style={{ width: '1em', height: '1em', display: 'inline-block' }} />;
  }
  return <IonIcon icon={icon} className={className} />;
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
    if (status === 'disputed') return 'bg-orange-50 text-orange-600 dark:text-orange-400 dark:bg-orange-900/20';
    if (status === 'failed' || status === 'cancelled') return 'bg-red-50 text-red-500 dark:text-red-400 dark:bg-red-900/20';
    if (status === 'pending') return 'bg-yellow-50 text-yellow-600 dark:text-yellow-400 dark:bg-yellow-900/20';
    if (type === 'credit' || type === 'escrow_release' || type === 'refund') return 'bg-green-50 text-green-600 dark:text-green-400 dark:bg-green-900/20';
    return 'bg-gray-50 text-gray-500 dark:bg-white/10 dark:text-gray-400';
  };

  return (
    <button 
      type="button"
      onClick={handleClick}
      className="w-full bg-transparent px-4 py-2.5 flex items-center gap-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5 active:bg-black/10 cursor-pointer text-left border-0 shadow-none rounded-none"
    >
      <div style={{ borderRadius: '9999px' }} className={`w-9 h-9 flex items-center justify-center flex-shrink-0 ${getTxColors(tx.type, tx.status)}`}>
        <ClientIcon icon={getTxIcon(tx.type)} className="text-[17px]" />
      </div>
      
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-[13px] text-gray-900 dark:text-white truncate">{tx.title}</h4>
        <div className="flex items-center gap-1.5 mt-0.5 text-gray-500 dark:text-gray-400">
          <p className="text-[11px] font-medium">{new Date(tx.created_at).toLocaleDateString()}</p>
          <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600"></span>
          <p className="text-[11px] font-medium">{new Date(tx.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className={`font-bold text-[13px] tabular-nums ${tx.type === 'credit' || tx.type === 'escrow_release' || tx.type === 'refund' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
          {tx.type === 'credit' || tx.type === 'escrow_release' || tx.type === 'refund' ? '+' : '-'}₦{Math.abs(Number(tx.amount || 0)).toLocaleString()}
        </p>
        
        {tx.status === 'pending' && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-yellow-600 dark:text-yellow-500">
            <ClientIcon icon={timeOutline} className="text-[12px]" />
            <p className="text-[11px] font-medium">Pending</p>
          </div>
        )}

        {isDisputed && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-orange-500">
            <ClientIcon icon={warningOutline} className="text-[12px]" />
            <p className="text-[11px] font-medium">Disputed</p>
          </div>
        )}
        
        {(tx.status === 'completed' || tx.status === 'successful' || tx.status === 'success') && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-gray-400">
            <p className="text-[11px] font-medium">Completed</p>
          </div>
        )}
        
        {(tx.status === 'failed' || tx.status === 'cancelled') && (
          <div className="flex items-center justify-end gap-1 mt-0.5 text-red-500">
            <ClientIcon icon={closeCircleOutline} className="text-[12px]" />
            <p className="text-[11px] font-medium capitalize">{tx.status}</p>
          </div>
        )}
      </div>
      
      <ClientIcon icon={chevronForwardOutline} className="text-gray-300 dark:text-gray-600 text-sm ml-1 shrink-0" />
    </button>
  );
};