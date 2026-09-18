"use client";

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { App as CapacitorApp } from '@capacitor/app';

export function HardwareBackButton() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const listener = CapacitorApp.addListener('backButton', () => {
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