"use client";

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { App as CapacitorApp } from '@capacitor/app';

export type BackHandler = () => boolean | void;

const backHandlers: BackHandler[] = [];

/**
 * Register a handler for the hardware/system back button.
 * Return `true` from the handler to indicate the event was handled (e.g. closing an overlay),
 * which prevents default router navigation or app exit.
 */
export function registerBackHandler(handler: BackHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const idx = backHandlers.indexOf(handler);
    if (idx !== -1) backHandlers.splice(idx, 1);
  };
}

export function HardwareBackButton() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const listener = CapacitorApp.addListener('backButton', () => {
      // Check registered overlay handlers from top (most recent) to bottom
      for (let i = backHandlers.length - 1; i >= 0; i--) {
        const handled = backHandlers[i]();
        if (handled === true) {
          return; // Consumed by the active overlay!
        }
      }

      // If the user is on the main feed, close the app.
      // Otherwise, go back to the previous screen.
      if (pathname === '/' || pathname === '/login') {
        CapacitorApp.exitApp();
      } else {
        router.back();
      }
    });

    return () => {
      listener.then(l => l.remove());
    };
  }, [router, pathname]);

  return null;
}