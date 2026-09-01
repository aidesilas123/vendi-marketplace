"use client";

import React, { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/shared/Button';
import { IonIcon } from '@ionic/react';
import { chevronBackOutline, shieldCheckmarkOutline, warningOutline } from 'ionicons/icons';

export default function ConfirmReceiptPage() {
  const params = useSearchParams()
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleConfirm = async () => {
    if (!agreed) return;
    setIsProcessing(true);
    setErrorMsg('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/release-escrow`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionRef: params.get('ref') })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to release funds');

      // Success: Redirect to completed transaction list
      router.push('/transactions');
      
    } catch (error: any) {
      setErrorMsg(error.message);
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#0a1120] text-gray-900 dark:text-white pt-safe pb-32">
      <div className="flex items-center px-4 py-4 border-b border-gray-200 dark:border-gray-800">
        <button onClick={() => router.back()} className="p-2 -ml-2 text-gray-900 dark:text-white active:scale-95 transition-transform">
          <IonIcon icon={chevronBackOutline} className="text-3xl" />
        </button>
        <h1 className="text-xl font-black ml-2">Confirm Receipt</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 mt-8 space-y-6">
        <div className="bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-900/30 rounded-3xl p-6 text-center shadow-sm">
          <IonIcon icon={shieldCheckmarkOutline} className="text-6xl text-orange-500 mb-4" />
          <h2 className="text-2xl font-black mb-2 text-gray-900 dark:text-white">Finalize Purchase</h2>
          <p className="text-gray-600 dark:text-gray-300 font-medium leading-relaxed">
            By confirming this receipt, you are verifying that you have met with the seller and thoroughly inspected the item.
          </p>
        </div>

        <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 rounded-2xl p-5 flex gap-3 shadow-sm">
          <IonIcon icon={warningOutline} className="text-2xl text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-800 dark:text-red-200/90 font-bold leading-relaxed">
            <span className="uppercase tracking-wider text-[10px] block mb-1 opacity-80">Warning</span>
            Once confirmed, the funds will be permanently disbursed to the seller. This action cannot be undone, and Vendi cannot issue refunds after this point.
          </p>
        </div>

        <label className="flex items-start gap-4 p-5 mt-4 border border-gray-200 dark:border-gray-700 rounded-2xl cursor-pointer bg-white dark:bg-gray-800/50 shadow-sm hover:border-orange-500/50 transition-colors">
          <input 
            type="checkbox" 
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="w-6 h-6 mt-0.5 rounded-md border-gray-300 text-orange-500 focus:ring-orange-500 bg-gray-100 dark:bg-gray-900"
          />
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
            I confirm that I have received and inspected the item, and I authorize the release of funds to the seller.
          </span>
        </label>

        {errorMsg && (
          <p className="text-center text-red-500 font-bold text-sm mt-4 bg-red-50 dark:bg-red-900/20 p-4 rounded-2xl border border-red-200 dark:border-red-900/30">{errorMsg}</p>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-white/90 dark:bg-[#0a1120]/90 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 p-4 pt-5 pb-safe">
        <div className="max-w-2xl mx-auto flex gap-3">
          <Button onClick={() => router.back()} className="flex-1 !bg-gray-200 dark:!bg-gray-800 !text-gray-900 dark:!text-white !py-4 !rounded-2xl font-bold">
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!agreed || isProcessing}
            className={`flex-[2] !py-4 !rounded-2xl font-bold transition-all duration-300 ${agreed ? '!bg-orange-500 shadow-lg shadow-orange-500/30 active:scale-95' : '!bg-gray-300 dark:!bg-gray-700 !text-gray-500 shadow-none'}`}
          >
            {isProcessing ? 'Processing...' : 'Confirm & Release'}
          </Button>
        </div>
      </div>
    </div>
  );
}