"use client";

// src/features/wallet/TransactionList.tsx
// Flat rows: no card background, no borders. Font sizes are the constants below.

import React from 'react';
import { IonIcon } from '@ionic/react';
import { arrowDownOutline, arrowUpOutline, receiptOutline } from 'ionicons/icons';
import {
  formatNaira,
  formatShortDate,
  isIncoming,
  statusMeta,
  txTitle,
  type WalletTx,
} from './txUtils';

// Tweak these to resize the whole list (they were text-xs / 9px / 8px with font-black before)
const TITLE_TEXT = 'text-[11px] font-semibold';
const AMOUNT_TEXT = 'text-[11px] font-bold tabular-nums';
const META_TEXT = 'text-[9px] font-medium';

export function TransactionRow({ tx, onSelect }: { tx: WalletTx; onSelect: (tx: WalletTx) => void }) {
  const incoming = isIncoming(tx);
  const status = statusMeta(tx.status);

  return (
    <button
      type="button"
      onClick={() => onSelect(tx)}
      className="flex w-full items-center gap-3 bg-transparent! py-3 text-left border-0! shadow-none! rounded-none!"
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          incoming ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'
        }`}
      >
        <IonIcon icon={incoming ? arrowDownOutline : arrowUpOutline} className="text-base" />
      </div>

      <div className="min-w-0 flex-1">
        <p className={`${TITLE_TEXT} truncate`}>{txTitle(tx)}</p>
        <p className={`${META_TEXT} mt-0.5 text-gray-500 dark:text-gray-400`}>
          {formatShortDate(tx.created_at)}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={`${AMOUNT_TEXT} ${
            status.kind === 'failed'
              ? 'text-gray-400 line-through'
              : incoming
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-900 dark:text-white'
          }`}
        >
          {incoming ? '+' : '-'}
          {formatNaira(tx.amount)}
        </p>
        <p className={`${META_TEXT} mt-0.5 ${status.kind === 'success' ? 'text-gray-400' : status.text}`}>
          {status.label}
        </p>
      </div>
    </button>
  );
}

export function TransactionListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <div className="h-9 w-9 rounded-full bg-gray-200 dark:bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-2/5 rounded bg-gray-200 dark:bg-white/10" />
            <div className="h-2 w-1/4 rounded bg-gray-200 dark:bg-white/10" />
          </div>
          <div className="h-2.5 w-16 rounded bg-gray-200 dark:bg-white/10" />
        </div>
      ))}
    </div>
  );
}

export function TransactionEmpty() {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10 text-orange-500">
        <IonIcon icon={receiptOutline} className="text-2xl" />
      </div>
      <p className="mt-3 text-sm font-bold">No transactions yet</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Money you receive, send or withdraw will show up here.
      </p>
    </div>
  );
}

export function TransactionList({
  txs,
  limit,
  onSelect,
}: {
  txs: WalletTx[];
  limit?: number;
  onSelect: (tx: WalletTx) => void;
}) {
  const visible = limit ? txs.slice(0, limit) : txs;
  if (visible.length === 0) return <TransactionEmpty />;
  return (
    <div>
      {visible.map((tx) => (
        <TransactionRow key={tx.id} tx={tx} onSelect={onSelect} />
      ))}
    </div>
  );
}