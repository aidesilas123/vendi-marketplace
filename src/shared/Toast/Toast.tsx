"use client";

// src/shared/Toast/Toast.tsx
//
// Usage:
//   const { toast, showToast, hideToast } = useToast();
//   showToast('Link copied!');                 // success
//   showToast('Something went wrong', 'error');
//   ...
//   <Toast {...toast} onClose={hideToast} />

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { checkmarkCircle, alertCircle, informationCircle } from 'ionicons/icons';

export type ToastType = 'success' | 'error' | 'info';
export type ToastState = { show: boolean; message: string; type: ToastType };

export function useToast(duration = 4000) {
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'success' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    // Keep the message so the text doesn't vanish while the toast slides out.
    setToast((prev) => ({ ...prev, show: false }));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'success') => {
      if (timer.current) clearTimeout(timer.current); // a new toast replaces the old one and restarts the timer
      setToast({ show: true, message, type });
      timer.current = setTimeout(() => setToast((prev) => ({ ...prev, show: false })), duration);
    },
    [duration]
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { toast, showToast, hideToast };
}

const STYLES: Record<ToastType, { box: string; icon: string }> = {
  success: { box: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900', icon: checkmarkCircle },
  error: { box: 'bg-red-500 text-white', icon: alertCircle },
  info: { box: 'bg-orange-500 text-white', icon: informationCircle },
};

export function Toast({ show, message, type, onClose }: ToastState & { onClose?: () => void }) {
  const style = STYLES[type];

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[300] flex justify-center px-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
    >
      <div
        role="status"
        aria-hidden={!show}
        onClick={onClose}
        className={`flex max-w-sm items-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold shadow-lg transition-all duration-300 ease-out ${style.box} ${
          show ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-24 opacity-0'
        }`}
      >
        <IonIcon icon={style.icon} className="shrink-0 text-base" />
        <span className="leading-snug">{message}</span>
      </div>
    </div>
  );
}