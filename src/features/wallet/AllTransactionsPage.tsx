"use client";

// src/features/wallet/AllTransactionsPage.tsx

import React, { useMemo, useState } from 'react';
import { FullScreenPage } from './FullScreenPage';
import { TransactionEmpty, TransactionRow } from './TransactionList';
import { dayLabel, isIncoming, type WalletTx } from './txUtils';

type Filter = 'all' | 'in' | 'out';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'Money in' },
  { id: 'out', label: 'Money out' },
];

export default function AllTransactionsPage({
  transactions,
  onSelect,
  onRefresh,
  onClosed,
}: {
  transactions: WalletTx[];
  onSelect: (tx: WalletTx) => void;
  onRefresh: () => Promise<unknown> | unknown;
  onClosed: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo(() => {
    const filtered = transactions.filter((tx) =>
      filter === 'all' ? true : filter === 'in' ? isIncoming(tx) : !isIncoming(tx)
    );
    const map = new Map<string, WalletTx[]>();
    for (const tx of filtered) {
      const label = dayLabel(tx.created_at);
      map.set(label, [...(map.get(label) ?? []), tx]);
    }
    return Array.from(map.entries());
  }, [transactions, filter]);

  return (
    <FullScreenPage title="All Transactions" onClosed={onClosed} onRefresh={onRefresh}>
      <div className="mx-auto w-full max-w-md px-4 pb-16">
        <div className="flex gap-2 pb-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full! px-4 py-1.5 text-xs font-semibold border-0! shadow-none! ${
                filter === f.id
                  ? 'bg-orange-500! text-white!'
                  : 'bg-gray-200/70! text-gray-600! dark:bg-white/10! dark:text-gray-300!'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {groups.length === 0 ? (
          <TransactionEmpty />
        ) : (
          groups.map(([label, txs]) => (
            <section key={label} className="mt-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</h3>
              <div className="mt-1">
                {txs.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} onSelect={onSelect} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </FullScreenPage>
  );
}