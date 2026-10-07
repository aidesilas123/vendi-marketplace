"use client";

// src/features/wallet/WalletDashboard.tsx
//
// Wallet home. Data comes from SWR (useWallet), pull-to-refresh + rubber band from
// <PullToRefresh>, alerts from the shared toast. Everything that opens on top of the page
// (top-up sheet, all transactions, withdraw, receipt) is rendered as a SIBLING of the
// scroller so the pull animation never shifts it.

import React, { useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { Clipboard } from '@capacitor/clipboard';
import {
  eyeOutline,
  eyeOffOutline,
  arrowDownOutline,
  arrowUpOutline,
  wifiOutline,
  callOutline,
  copyOutline,
  checkmarkOutline,
  refreshOutline,
} from 'ionicons/icons';
import { PullToRefresh, type PullToRefreshHandle } from '@/shared/PullToRefresh/PullToRefresh';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { useWallet } from './useWallet';
import { friendlyError } from './walletApi';
import { formatNaira, type WalletTx } from './txUtils';
import { TransactionList, TransactionListSkeleton } from './TransactionList';
import AllTransactionsPage from './AllTransactionsPage';
import WithdrawPage from './WithdrawPage';
import TransactionReceiptPage from './TransactionReceipt';

type View = 'none' | 'topup' | 'allTx' | 'withdraw';

// `!` = Tailwind important modifier, so the app's global <button> styles (shadow, bg) can't leak in
const ICON_BTN =
  'flex h-8 w-8 items-center justify-center rounded-full! bg-transparent! border-0! shadow-none! p-0! text-gray-500 dark:text-gray-400';

export default function WalletDashboard() {
  const { wallet, transactions, error, isLoading, refresh } = useWallet();

  const [showBalance, setShowBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>('none');
  const [receiptTx, setReceiptTx] = useState<WalletTx | null>(null);
  const ptrRef = useRef<PullToRefreshHandle>(null);

  useEffect(() => {
    const stored = localStorage.getItem('vendi_show_balance');
    if (stored !== null) setShowBalance(stored === 'true');
  }, []);

  useEffect(() => {
    if (error) showGlobalToast(friendlyError(error, 'Could not sync your wallet'), 'error');
  }, [error]);

  const toggleBalance = () => {
    const next = !showBalance;
    setShowBalance(next);
    localStorage.setItem('vendi_show_balance', String(next));
  };

  const handleCopyAccount = async () => {
    const number = wallet?.virtual_account_number;
    if (!number) return;
    try {
      await Clipboard.write({ string: number });
    } catch {
      try {
        await navigator.clipboard.writeText(number);
      } catch {
        showGlobalToast('Could not copy the account number', 'error');
        return;
      }
    }
    setCopied(true);
    showGlobalToast('Account number copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const balanceText = showBalance ? formatNaira(wallet?.balance ?? 0) : '₦ ••••••';
  const hasNothingToShow = !wallet && !isLoading;

  return (
    <>
      <PullToRefresh
        ref={ptrRef}
        onRefresh={refresh}
        className="h-[100dvh]"
        contentClassName="text-gray-900 dark:text-white"
      >
        <div className="mx-auto w-full max-w-md px-4 pb-32">
          {/* Header: no border, no shadow, straight under the status bar */}
          <header className="py-4">
            <h1 className="text-xl font-black">
              My <span className="text-orange-500">Wallet</span>
            </h1>
          </header>

          {/* ------------------------------ Balance ------------------------------ */}
          {isLoading && !wallet ? (
            <div className="h-44 animate-pulse rounded-3xl bg-orange-50 dark:bg-[#141d33]" />
          ) : hasNothingToShow ? (
            <div className="rounded-3xl bg-orange-50 px-6 py-10 text-center dark:bg-[#141d33]">
              <p className="text-sm font-bold">We couldn&apos;t load your wallet</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Check your connection and try again.</p>
              <button
                type="button"
                onClick={() => ptrRef.current?.refresh()}
                className="mt-4 rounded-full! bg-orange-500! px-5 py-2 text-sm font-bold text-white! border-0! shadow-none!"
              >
                Retry
              </button>
            </div>
          ) : (
            // Themed card: soft orange in light mode, deep navy in dark mode. No border.
            <section className="relative overflow-hidden rounded-3xl bg-orange-50 p-5 dark:bg-[#141d33]">
              <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-orange-500/15 blur-3xl" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Total balance</p>
                  <button
                    type="button"
                    aria-label="Refresh balance"
                    onClick={() => ptrRef.current?.refresh()}
                    className={ICON_BTN}
                  >
                    <IonIcon icon={refreshOutline} className="text-lg" />
                  </button>
                </div>

                <div className="mt-1 flex items-center gap-1">
                  <h2 className="text-[32px] font-black leading-tight tracking-tight tabular-nums">{balanceText}</h2>
                  <button
                    type="button"
                    aria-label={showBalance ? 'Hide balance' : 'Show balance'}
                    onClick={toggleBalance}
                    className={ICON_BTN}
                  >
                    <IonIcon icon={showBalance ? eyeOutline : eyeOffOutline} className="text-xl" />
                  </button>
                </div>

                <div className="mt-6">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Withdrawable</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-green-600 dark:text-green-400">
                    {showBalance ? formatNaira(wallet?.balance ?? 0) : '₦ ••••••'}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ------------------------------ Actions ------------------------------ */}
          <div className="mt-7 grid grid-cols-4 gap-2">
            <ActionButton
              label="Top up"
              icon={arrowDownOutline}
              tint="bg-green-500/10 text-green-600 dark:text-green-400"
              disabled={!wallet}
              onClick={() => setView('topup')}
            />
            <ActionButton
              label="Withdraw"
              icon={arrowUpOutline}
              tint="bg-red-500/10 text-red-500"
              disabled={!wallet}
              onClick={() => setView('withdraw')}
            />
            <ActionButton label="Data" icon={wifiOutline} tint="bg-blue-500/10 text-blue-500" disabled soon />
            <ActionButton label="Airtime" icon={callOutline} tint="bg-purple-500/10 text-purple-500" disabled soon />
          </div>

          {/* ---------------------------- Transactions --------------------------- */}
          <section className="mt-9">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Recent transactions</h3>
              <button
                type="button"
                onClick={() => setView('allTx')}
                className="bg-transparent! border-0! shadow-none! p-0! text-xs font-semibold text-orange-500"
              >
                See all
              </button>
            </div>
            <div className="mt-1">
              {isLoading && !wallet ? (
                <TransactionListSkeleton />
              ) : (
                <TransactionList txs={transactions} limit={3} onSelect={setReceiptTx} />
              )}
            </div>
          </section>
        </div>
      </PullToRefresh>

      {/* ----------------------------- Top-up sheet ---------------------------- */}
      <div
        onClick={() => setView('none')}
        className={`fixed inset-0 z-[90] bg-black/50 transition-opacity duration-300 ${
          view === 'topup' ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <div
        className={`fixed inset-x-0 bottom-0 z-[100] rounded-t-3xl bg-white text-gray-900 transition-transform duration-300 dark:bg-[#0f172a] dark:text-white ${
          view === 'topup' ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="mx-auto max-w-md px-6 pb-[calc(env(safe-area-inset-bottom,0px)+32px)] pt-3">
          <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
          <h3 className="text-xl font-black">Fund wallet</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Send money from any bank app to this account. Pull down on your wallet to refresh your balance after you transfer.
          </p>

          <div className="mt-7 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Account number</p>
              <p className="mt-1 text-3xl font-black tracking-wider tabular-nums">
                {wallet?.virtual_account_number || '—'}
              </p>
            </div>
            <button
              type="button"
              aria-label="Copy account number"
              onClick={handleCopyAccount}
              className="flex h-11 w-11 items-center justify-center rounded-full! bg-orange-500/10! text-orange-500! border-0! shadow-none! p-0!"
            >
              <IonIcon icon={copied ? checkmarkOutline : copyOutline} className="text-xl" />
            </button>
          </div>

          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-gray-400">Bank</dt>
              <dd className="font-semibold">{wallet?.bank_name || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500 dark:text-gray-400">Account name</dt>
              <dd className="text-right font-semibold">{wallet?.account_name || '—'}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* ------------------------ Full-screen pages ------------------------ */}
      {view === 'allTx' && (
        <AllTransactionsPage
          transactions={transactions}
          onSelect={setReceiptTx}
          onRefresh={refresh}
          onClosed={() => setView('none')}
        />
      )}

      {view === 'withdraw' && wallet && (
        <WithdrawPage wallet={wallet} onClosed={() => setView('none')} onCompleted={() => void refresh()} />
      )}

      {receiptTx && <TransactionReceiptPage tx={receiptTx} onClose={() => setReceiptTx(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ActionButton({
  label,
  icon,
  tint,
  onClick,
  disabled,
  soon,
}: {
  label: string;
  icon: string;
  tint: string;
  onClick?: () => void;
  disabled?: boolean;
  soon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-2 bg-transparent! border-0! shadow-none! p-0! ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${tint}`}>
        <IonIcon icon={icon} className="text-xl" />
      </span>
      <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
        {label}
        {soon ? <span className="block text-[9px] font-medium text-gray-400">Soon</span> : null}
      </span>
    </button>
  );
}