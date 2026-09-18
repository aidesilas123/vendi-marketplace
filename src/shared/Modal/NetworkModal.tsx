"use client";

import React, { useState, useEffect } from 'react';
import { IonIcon } from '@ionic/react';
import { cloudOfflineOutline, refreshOutline } from 'ionicons/icons';
import { Modal } from './Modal';
import { Button } from '../Button/Button';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

interface NetworkModalProps {
  isOpen: boolean;
  onRetry: () => Promise<void> | void;
}

export const NetworkModal = ({ isOpen, onRetry }: NetworkModalProps) => {
  const [isRetrying, setIsRetrying] = useState(false);

  // Trigger double light vibration when modal opens
  useEffect(() => {
    if (isOpen) {
      const doubleVibrate = async () => {
        try {
          await Haptics.impact({ style: ImpactStyle.Light });
          setTimeout(async () => {
            await Haptics.impact({ style: ImpactStyle.Light });
          }, 150); // 150ms delay for a rapid "bzz-bzz" feel
        } catch (e) {
          console.log('Haptics not available');
        }
      };
      doubleVibrate();
    }
  }, [isOpen]);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setTimeout(() => setIsRetrying(false), 800);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => {}} maxWidth="max-w-xs">
      {/* Reduced padding, sizes, and margins for a tighter mobile feel */}
      <div className="flex flex-col items-center text-center py-2">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-900/10 rounded-full flex items-center justify-center mb-4">
          <IonIcon icon={cloudOfflineOutline} className="text-3xl text-red-500" />
        </div>
        
        <h3 className="text-xl font-black text-[#0f172a] dark:text-white mb-1">
          Connection Lost
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mb-6 px-2 leading-relaxed">
          You are currently offline. Please check your internet connection to continue.
        </p>

        <Button onClick={handleRetry} disabled={isRetrying} className="w-full flex items-center justify-center gap-2 !py-2.5">
          <IonIcon icon={refreshOutline} className={`text-lg ${isRetrying ? 'animate-spin' : ''}`} />
          {isRetrying ? 'Checking...' : 'Retry Connection'}
        </Button>
      </div>
    </Modal>
  );
};