"use client";

import React, { useState } from 'react';
import { IonIcon } from '@ionic/react';
import { cloudOfflineOutline, refreshOutline } from 'ionicons/icons';
import { Modal } from './Modal';
import { Button } from '../Button/Button';

interface NetworkModalProps {
  isOpen: boolean;
  onRetry: () => Promise<void> | void;
}

export const NetworkModal = ({ isOpen, onRetry }: NetworkModalProps) => {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      // Add a tiny delay to make the spinning animation feel natural
      setTimeout(() => setIsRetrying(false), 800);
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={() => {}} // Empty function prevents closing by clicking the backdrop
      maxWidth="max-w-sm"
    >
      <div className="flex flex-col items-center text-center py-4">
        {/* Offline Icon Wrapper */}
        <div className="w-24 h-24 bg-red-50 dark:bg-red-900/10 rounded-full flex items-center justify-center mb-6">
          <IonIcon icon={cloudOfflineOutline} className="text-5xl text-red-500" />
        </div>
        
        {/* Text Content */}
        <h3 className="text-2xl font-black text-[#0f172a] dark:text-white mb-2">
          Connection Lost
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-8 px-4">
          It looks like you are offline. Please check your internet connection and try again to continue using the marketplace.
        </p>

        {/* Retry Action */}
        <Button 
          onClick={handleRetry} 
          disabled={isRetrying}
          className="w-full flex items-center justify-center gap-2"
        >
          <IonIcon 
            icon={refreshOutline} 
            className={`text-xl ${isRetrying ? 'animate-spin' : ''}`} 
          />
          {isRetrying ? 'Checking Connection...' : 'Retry Connection'}
        </Button>
      </div>
    </Modal>
  );
};