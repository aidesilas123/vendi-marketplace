"use client";

import { useEffect } from 'react';
import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core';

export function StatusBarManager() {
  useEffect(() => {
    const applyStatusBarStyle = async () => {
      try {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        await SystemBars.setStyle({
          bar: SystemBarType.StatusBar,
          style: isDark ? SystemBarsStyle.Light : SystemBarsStyle.Dark, // light icons on dark bg, dark icons on light bg
        });
      } catch (e) {
        console.log('SystemBars plugin not active on web');
      }
    };

    applyStatusBarStyle();

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyStatusBarStyle);
    return () => media.removeEventListener('change', applyStatusBarStyle);
  }, []);

  return null;
}