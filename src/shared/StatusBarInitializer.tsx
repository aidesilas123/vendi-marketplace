"use client";

import { useEffect } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';

export function StatusBarInitializer() {
  useEffect(() => {
    const setupStatusBar = async () => {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#0f172a' });
      } catch (e) {
        // Gracefully handles web preview where native plugins aren't present
        console.log('Status bar plugin not active on web');
      }
    };
    setupStatusBar();
  }, []);

  return null;
}