// src/shared/Navigation/PushBanner.tsx
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IonIcon } from '@/shared/Icon/Icon';
import { notificationsOutline } from 'ionicons/icons';

type PushPayload = { title: string; body: string; route: string };

/**
 * In-app banner for pushes that arrive while the app is open.
 * push.ts dispatches `vendi-push-received`; tapping the banner deep-links.
 */
export function PushBanner() {
  const router = useRouter();
  const [push, setPush] = useState<PushPayload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PushPayload>).detail;
      if (!detail?.title) return;
      setPush(detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPush(null), 6000);
    };
    window.addEventListener('vendi-push-received', handler);
    return () => {
      window.removeEventListener('vendi-push-received', handler);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!push) return null;

  return (
    <button
      onClick={() => {
        setPush(null);
        if (push.route) router.push(push.route);
      }}
      className="fixed top-0 left-0 right-0 z-[200] pt-safe text-left"
      aria-label="Open notification"
    >
      <div className="mx-3 mt-2 bg-white dark:bg-[#171717] rounded-2xl shadow-lg p-3 flex items-center gap-3 active:scale-[0.99] transition-transform">
        <div className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
          <IonIcon icon={notificationsOutline} className="text-xl" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{push.title}</p>
          {push.body ? (
            <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate">{push.body}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}
