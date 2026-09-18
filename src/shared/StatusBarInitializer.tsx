"use client";

import { useEffect } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';

export function StatusBarInitializer() {
  useEffect(() => {
    const setupStatusBar = async () => {
      try {
        // Detect if the user's device is in Dark Mode
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (prefersDark) {
          await StatusBar.setStyle({ style: Style.Dark }); // White text
          await StatusBar.setBackgroundColor({ color: '#0b1120' }); // Exact match to your dark CSS
        } else {
          await StatusBar.setStyle({ style: Style.Light }); // Dark text
          await StatusBar.setBackgroundColor({ color: '#f9fafb' }); // Exact match to your light CSS
        }
      } catch (e) {
        console.log('Status bar plugin not active on web');
      }
    };
    setupStatusBar();
  }, []);

  return null;
}