"use client";

import { useState, useEffect } from 'react';
import { NetworkModal } from './NetworkModal';

export function NetworkListener() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(!navigator.onLine);

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const handleRetry = async () => {
    try {
      // Pings the local server to check for a true connection
      const response = await fetch('/', { method: 'HEAD' });
      if (response.ok) {
        setIsOffline(false);
      }
    } catch (error) {
      setIsOffline(true);
    }
  };

  return <NetworkModal isOpen={isOffline} onRetry={handleRetry} />;
}