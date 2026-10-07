"use client";

// src/features/wallet/TransactionReceipt.tsx
//
//   <TransactionReceiptPage tx={tx} onClose={() => setTx(null)} />   → full-screen receipt page
//   <ReceiptContent tx={tx} />                                       → just the receipt body
//   <ShareReceiptButton tx={tx} />                                   → "Share as image" button
//
// The shared image is drawn by receiptImage.ts so it always looks the same, in either theme.

import React, { useState } from 'react';
import { IonIcon } from '@ionic/react';
import { checkmarkOutline, closeOutline, timeOutline, shareSocialOutline } from 'ionicons/icons';
import { FullScreenPage } from './FullScreenPage';
import { shareReceiptImage } from './receiptImage';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { friendlyError } from './walletApi';
import {
  buildReceiptRows,
  formatNaira,
  isIncoming,
  statusMeta,
  txTitle,
  type WalletTx,
} from './txUtils';

/* -------------------------------------------------------------------------- */
/*  Watermark: many small tilted "Vendi" marks, tiled in staggered rows        */
/*  Tweak: tile size (120), font-size (15), opacity (0.12), tilt (-20)          */
/* -------------------------------------------------------------------------- */

const WATERMARK_SVG = encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>` +
    `<text x='8' y='34' font-family='Arial, sans-serif' font-weight='800' font-size='15' fill='#F97316' fill-opacity='0.12' transform='rotate(-20 8 34)'>Vendi</text>` +
    `<text x='68' y='94' font-family='Arial, sans-serif' font-weight='800' font-size='15' fill='#F97316' fill-opacity='0.12' transform='rotate(-20 68 94)'>Vendi</text>` +
    `</svg>`
);

const WATERMARK_STYLE: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,${WATERMARK_SVG}")`,
  backgroundSize: '120px 120px',
};

/* -------------------------------------------------------------------------- */
/*  Receipt body                                                               */
/* -------------------------------------------------------------------------- */

export function ReceiptContent({ tx }: { tx: WalletTx }) {
  const incoming = isIncoming(tx);
  const status = statusMeta(tx.status);
  const rows = buildReceiptRows(tx);
  const icon = status.kind === 'success' ? checkmarkOutline : status.kind === 'failed' ? closeOutline : timeOutline;

  return (
    <div className="relative min-h-full">
      {/* Watermark layer, behind everything */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={WATERMARK_STYLE} />

      <div className="relative mx-auto w-full max-w-md px-6 pb-10 pt-4">
        <div className="flex flex-col items-center text-center">
          <div className={`flex h-16 w-16 items-center justify-center rounded-full ${status.soft} ${status.text}`}>
            <IonIcon icon={icon} className="text-3xl" />
          </div>

          <h2
            className={`mt-6 text-4xl font-black tracking-tight tabular-nums ${
              incoming ? 'text-green-600 dark:text-green-400' : ''
            } ${status.kind === 'failed' ? 'line-through opacity-60' : ''}`}
          >
            {incoming ? '+' : '-'}
            {formatNaira(tx.amount)}
          </h2>
          <p className="mt-2 text-sm font-medium text-gray-500 dark:text-gray-400">{txTitle(tx)}</p>

          <span className={`mt-4 rounded-full px-4 py-1.5 text-xs font-bold ${status.soft} ${status.text}`}>
            {status.label}
          </span>
        </div>

        <dl className="mt-12 space-y-6">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-6">
              <dt className="shrink-0 text-sm text-gray-500 dark:text-gray-400">{row.label}</dt>
              <dd className="min-w-0 break-words text-right text-sm font-semibold">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Share button                                                               */
/* -------------------------------------------------------------------------- */

export function ShareReceiptButton({ tx, className = '' }: { tx: WalletTx; className?: string }) {
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await shareReceiptImage(tx);
    } catch (e) {
      const message = friendlyError(e, 'Could not share receipt');
      // Closing the share sheet is not an error
      if (!/cancel|abort|dismiss/i.test(message)) showGlobalToast(message, 'error');
    } finally {
      setSharing(false);
    }
  };

  // h-16 + min-h-16: globals.css forces `button { height: auto !important }`, so min-h keeps it tall
  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={sharing}
      className={`flex h-16! min-h-16! w-full items-center justify-center gap-3 rounded-full! bg-orange-500! px-8! py-0! text-lg! font-black! text-white! shadow-[0_8px_30px_rgb(249,115,22,0.3)]! border-0! disabled:opacity-60 ${className}`}
    >
      <IonIcon icon={shareSocialOutline} className="text-2xl" />
      {sharing ? 'Preparing image…' : 'Share as image'}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Full-screen page                                                           */
/* -------------------------------------------------------------------------- */

export default function TransactionReceiptPage({ tx, onClose }: { tx: WalletTx; onClose: () => void }) {
  return (
    <FullScreenPage
      title="Receipt"
      zIndex={120}
      onClosed={onClose}
      footer={
        <div className="mx-auto w-full max-w-md px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4">
          <ShareReceiptButton tx={tx} />
        </div>
      }
    >
      <ReceiptContent tx={tx} />
    </FullScreenPage>
  );
}