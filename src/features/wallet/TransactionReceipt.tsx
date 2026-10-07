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
/*  Receipt body                                                               */
/* -------------------------------------------------------------------------- */

export function ReceiptContent({ tx }: { tx: WalletTx }) {
  const incoming = isIncoming(tx);
  const status = statusMeta(tx.status);
  const rows = buildReceiptRows(tx);
  const icon = status.kind === 'success' ? checkmarkOutline : status.kind === 'failed' ? closeOutline : timeOutline;

  return (
    <div className="mx-auto w-full max-w-md px-6 pb-8 pt-2">
      <div className="flex flex-col items-center text-center">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full ${status.soft} ${status.text}`}>
          <IonIcon icon={icon} className="text-3xl" />
        </div>

        <h2
          className={`mt-5 text-4xl font-black tracking-tight tabular-nums ${
            incoming ? 'text-green-600 dark:text-green-400' : ''
          } ${status.kind === 'failed' ? 'line-through opacity-60' : ''}`}
        >
          {incoming ? '+' : '-'}
          {formatNaira(tx.amount)}
        </h2>
        <p className="mt-1.5 text-sm font-medium text-gray-500 dark:text-gray-400">{txTitle(tx)}</p>

        <span className={`mt-3 rounded-full px-3 py-1 text-xs font-bold ${status.soft} ${status.text}`}>
          {status.label}
        </span>
      </div>

      <dl className="mt-10 space-y-5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-6">
            <dt className="shrink-0 text-sm text-gray-500 dark:text-gray-400">{row.label}</dt>
            <dd className="min-w-0 break-words text-right text-sm font-semibold">{row.value}</dd>
          </div>
        ))}
      </dl>
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

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={sharing}
      className={`flex h-14 w-full items-center justify-center gap-2 rounded-full! bg-orange-500! text-base font-bold text-white! shadow-none! border-0! disabled:opacity-60 ${className}`}
    >
      <IonIcon icon={shareSocialOutline} className="text-xl" />
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
        <div className="mx-auto w-full max-w-md px-6 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3">
          <ShareReceiptButton tx={tx} />
        </div>
      }
    >
      <ReceiptContent tx={tx} />
    </FullScreenPage>
  );
}