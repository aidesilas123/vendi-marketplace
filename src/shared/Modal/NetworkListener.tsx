"use client";
// src/shared/Modal/NetworkListener.tsx

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
      // Probe the app's own backend, not '/': in the Capacitor app '/' is the
      // local asset server, which answers even with no internet — so the old
      // HEAD '/' check always "succeeded" while offline and the modal closed
      // on a lie. no-cors: any resolution proves the network path works;
      // rejection (or the 5s timeout) proves it doesn't. Supabase itself
      // being down also keeps the modal up, which is correct — the app can't
      // work without its backend either way.
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!base) throw new Error('no backend configured');
      await fetch(`${base}/auth/v1/health`, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      setIsOffline(false);
    } catch (error) {
      setIsOffline(true);
    }
  };

  return <NetworkModal isOpen={isOffline} onRetry={handleRetry} />;
}