"use client";

// src/features/wallet/FullScreenPage.tsx
//
// Full-screen page that slides in from the right (same position as the old "All Transactions"
// overlay: pinned to the screen, header straight under the status bar, no border or shadow).
// The body is a <PullToRefresh> so every page gets the rubber-band scroll for free.
//
// `children` / `footer` can be a function that receives `close()` so inner buttons
// (Done, Cancel…) can play the slide-out animation before unmounting.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { arrowBackOutline } from 'ionicons/icons';
import { PullToRefresh } from '@/shared/PullToRefresh/PullToRefresh';

type Renderable = React.ReactNode | ((close: () => void) => React.ReactNode);

type Props = {
  title: string;
  /** Called after the slide-out animation finishes. Unmount the page here. */
  onClosed: () => void;
  /** Override the back arrow (e.g. go back a step). Receives close() for the default behaviour. */
  onBack?: (close: () => void) => void;
  children: Renderable;
  footer?: Renderable;
  /** Enables pull-to-refresh inside the page. Rubber band works either way. */
  onRefresh?: () => Promise<unknown> | unknown;
  zIndex?: number;
};

const ICON_BTN =
  'flex h-10 w-10 items-center justify-center rounded-full bg-transparent! border-0! shadow-none! p-0! text-gray-900 dark:text-white';

export function FullScreenPage({
  title,
  onClosed,
  onBack,
  children,
  footer,
  onRefresh,
  zIndex = 100,
}: Props) {
  const [entered, setEntered] = useState(false);
  const closingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const id = setTimeout(() => setEntered(true), 16);
    return () => {
      clearTimeout(id);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setEntered(false);
    timerRef.current = setTimeout(onClosed, 280);
  }, [onClosed]);

  const render = (node: Renderable) => (typeof node === 'function' ? node(close) : node);

  return (
    <div
      className={`fixed inset-0 flex flex-col bg-gray-50 text-gray-900 transition-transform duration-300 ease-out dark:bg-[#0b1120] dark:text-white ${
        entered ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{ zIndex }}
    >
      {/* Header: no border, no shadow, straight under the status bar */}
      <div className="flex shrink-0 items-center gap-1 px-4 py-4">
        <button
          type="button"
          aria-label="Back"
          onClick={() => (onBack ? onBack(close) : close())}
          className={`${ICON_BTN} -ml-2`}
        >
          <IonIcon icon={arrowBackOutline} className="text-2xl" />
        </button>
        <h2 className="text-xl font-black">{title}</h2>
      </div>

      <PullToRefresh onRefresh={onRefresh} className="min-h-0 flex-1">
        {render(children)}
      </PullToRefresh>

      {footer ? <div className="shrink-0">{render(footer)}</div> : null}
    </div>
  );
}

export default FullScreenPage;