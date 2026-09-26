"use client";
import { useEffect } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';

export const StatusBarSync = () => {
  useEffect(() => {
    const updateStatusBar = async () => {
      try {
        // Detects if the device is in Dark Mode
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        // Sync the native Android status bar with your Next.js background colors
        await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
        await StatusBar.setBackgroundColor({ color: isDark ? '#0f172a' : '#ffffff' });
      } catch (e) {
        // Silently fails in standard web browsers, works natively on APK
      }
    };
    
    updateStatusBar();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateStatusBar);
  }, []);

  return null;
};