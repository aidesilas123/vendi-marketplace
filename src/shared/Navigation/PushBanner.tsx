// src/shared/Navigation/PushBanner.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IonIcon } from '@/shared/Icon/Icon';
import { notificationsOutline } from 'ionicons/icons';

type PushPayload = { title: string; body: string; route: string };

const AUTO_DISMISS_MS = 5000;
const EXIT_MS = 280;

/**
 * In-app banner for pushes that arrive while the app is open.
 * Source: push.ts dispatches `vendi-push-received` when the push plugin
 * reports a foreground arrival. Behavior: slides down from the top, swipe
 * up / left / right dismisses, tap opens the destination, auto-dismisses
 * after 5s.
 */
export function PushBanner() {
  const router = useRouter();
  const [push, setPush] = useState<PushPayload | null>(null);
  const [entered, setEntered] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [exitTo, setExitTo] = useState<{ x: number; y: number } | null>(null);

  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);

  const clearAuto = () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
  };

  const dismiss = useCallback((to?: { x: number; y: number }) => {
    clearAuto();
    setExitTo(to ?? { x: 0, y: -180 });
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setPush(null);
      setDrag(null);
      setExitTo(null);
      setEntered(false);
    }, EXIT_MS);
  }, []);

  const restartAuto = useCallback(() => {
    clearAuto();
    autoTimer.current = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
  }, [dismiss]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PushPayload>).detail;
      if (!detail?.title) return;
      if (exitTimer.current) clearTimeout(exitTimer.current);
      setExitTo(null);
      setDrag(null);
      setEntered(false);
      setPush(detail);
      // Slide in on the next frame so the transform transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      restartAuto();
    };
    window.addEventListener('vendi-push-received', handler);
    return () => {
      window.removeEventListener('vendi-push-received', handler);
      clearAuto();
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [restartAuto]);

  if (!push) return null;

  const transform = exitTo
    ? `translate(${exitTo.x}px, ${exitTo.y}px)`
    : drag
      ? `translate(${drag.x}px, ${drag.y}px)`
      : entered
        ? 'translate(0px, 0px)'
        : 'translate(0px, -130%)';

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    clearAuto(); // hold the banner while the finger is down
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    // Follow the finger up / left / right; resist downward drags.
    setDrag({ x: dx, y: dy < 0 ? dy : dy * 0.25 });
  };

  const onTouchEnd = () => {
    touchStart.current = null;
    if (!drag) {
      restartAuto();
      return;
    }
    const { x, y } = drag;
    if (y < -48) {
      swipedRef.current = true;
      dismiss({ x: 0, y: -180 });
    } else if (x < -72) {
      swipedRef.current = true;
      dismiss({ x: -440, y });
    } else if (x > 72) {
      swipedRef.current = true;
      dismiss({ x: 440, y });
    } else {
      setDrag(null);
      restartAuto();
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] pt-safe pointer-events-none">
      <div
        className="pointer-events-auto mx-3 mt-2"
        style={{
          transform,
          transition: drag ? 'none' : `transform ${EXIT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
          // 'none': the banner owns its gestures — otherwise the WebView
          // steals upward swipes as page scrolls and dismissal never fires.
          touchAction: 'none',
        }}
      >
        <button
          onClick={() => {
            if (swipedRef.current) {
              swipedRef.current = false;
              return;
            }
            const route = push.route;
            dismiss();
            if (route) router.push(route);
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => {
            touchStart.current = null;
            setDrag(null);
            restartAuto();
          }}
          className="w-full text-left bg-white dark:bg-[#171717] rounded-2xl shadow-lg p-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
          aria-label="Open notification"
        >
          <div className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
            <IonIcon icon={notificationsOutline} className="text-xl" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{push.title}</p>
            {push.body ? (
              <p className="text-[13px] text-gray-500 dark:text-gray-400 truncate">{push.body}</p>
            ) : null}
          </div>
        </button>
      </div>
    </div>
  );
}
