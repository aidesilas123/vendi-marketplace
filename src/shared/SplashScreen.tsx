"use client";

// src/shared/SplashScreen.tsx
//
// Branded cold-start splash. On a fresh app open the WebView paints the shell
// before safe-area insets and JS-driven layout settle, which made the header
// snap under the status bar and the bottom nav push up from below. This overlay
// covers that first paint with the Vendi brand, then fades away — the opening
// looks intentional instead of janky.
//
// It lives in the root layout, so it only shows on a full load, never on
// client-side route changes.

import { useEffect, useState } from "react";

const VISIBLE_MS = 850;
const FADE_MS = 350;

export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), VISIBLE_MS);
    const t2 = setTimeout(() => setVisible(false), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white dark:bg-[#0a1120] transition-opacity ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <img
        src="/icon.png"
        alt=""
        className="w-20 h-20 rounded-3xl shadow-lg shadow-orange-500/20"
      />
      <h1 className="vendi-wordmark mt-4 text-3xl text-gray-900 dark:text-white">
        Vendi
      </h1>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.25em] text-gray-400">
        Secure campus trading
      </p>
    </div>
  );
}
