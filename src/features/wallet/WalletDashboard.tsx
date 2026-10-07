"use client";

// src/features/wallet/WalletDashboard.tsx
//
// Wallet home. Data comes from SWR (useWallet), pull-to-refresh from <PullToRefresh> (only the
// spinner moves), alerts from the shared toast. Everything that opens on top of the page
// (top-up sheet, all transactions, withdraw, receipt) is a SIBLING of the scroller.
//
// Spacing knobs are the constants right below the imports.

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
import { PullToRefresh } from '@/shared/PullToRefresh/PullToRefresh';
import { showGlobalToast } from '@/shared/Toast/Toast';
import { useWallet } from './useWallet';
import { friendlyError } from './walletApi';
import { formatNaira, type WalletTx } from './txUtils';
import { TransactionList, TransactionListSkeleton } from './TransactionList';
import AllTransactionsPage from './AllTransactionsPage';
import WithdrawPage from './WithdrawPage';
import TransactionReceiptPage from './TransactionReceipt';

type View = 'none' | 'topup' | 'allTx' | 'withdraw';

// `!` = Tailwind important modifier. The app's global <button> styles would otherwise win over
// padding / height / background utilities, which is what made buttons look squeezed.
const FLAT = 'bg-transparent! border-0! shadow-none! p-0!';
const ICON_BTN = `flex h-10 min-h-10 w-10 items-center justify-center rounded-full! ${FLAT} text-gray-500 dark:text-gray-400`;
const PRIMARY_BTN =
  'h-12! min-h-12! min-w-32 rounded-full! bg-orange-500! px-8! py-0! text-sm! font-bold! text-white! border-0! shadow-none!';

// Stretches the header securely to the absolute top of edge-to-edge mobile screens
const HEADER_SPACE = 'pt-[max(env(safe-area-inset-top),16px)] pb-6';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Spinner({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block shrink-0 animate-spin rounded-full border-[3px] border-orange-500 border-t-transparent ${className}`}
    />
  );
}

// Wrapper to prevent Next.js hydration errors from Ionicons injecting classes/roles
function ClientIcon({ icon, className }: { icon: string; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <span className={className} style={{ width: '1em', height: '1em', display: 'inline-block' }} />;
  }
  return <IonIcon icon={icon} className={className} />;
}

export default function WalletDashboard() {
  const { wallet, transactions, error, isLoading, refresh } = useWallet();

  const [showBalance, setShowBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>('none');
  const [receiptTx, setReceiptTx] = useState<WalletTx | null>(null);
  // Tapping the refresh icon (or Retry) reloads the wallet and shows a spinner where the balance
  // is. It never touches the page-level pull-to-refresh.
  const [reloading, setReloading] = useState(false);
  const lastErrorRef = useRef('');

  useEffect(() => {
    const stored = localStorage.getItem('vendi_show_balance');
    if (stored !== null) setShowBalance(stored === 'true');
  }, []);

  // One toast per distinct error (no repeat spam while the same failure persists)
  useEffect(() => {
    if (!error) {
      lastErrorRef.current = '';
      return;
    }
    const message = friendlyError(error, 'Could not sync your wallet');
    if (message === lastErrorRef.current) return;
    lastErrorRef.current = message;
    showGlobalToast(message, 'error');
  }, [error]);

  const reload = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await Promise.all([refresh(), sleep(700)]);
    } catch {
      /* the error toast above handles it */
    } finally {
      setReloading(false);
    }
  };

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

  // Top up / Withdraw stay tappable even before the wallet exists: tapping tries to load it
  const openWhenReady = (target: View) => () => {
    if (wallet) {
      setView(target);
      return;
    }
    showGlobalToast('Setting up your wallet…');
    void reload();
  };

  const balanceText = showBalance ? formatNaira(wallet?.balance ?? 0) : '₦ ••••••';
  const showSkeleton = (isLoading || reloading) && !wallet;
  const hasNothingToShow = !wallet && !isLoading;

  return (
    <>
      <PullToRefresh onRefresh={refresh} className="h-[100dvh]" contentClassName="text-gray-900 dark:text-white">
        <div className="mx-auto w-full max-w-md px-5 pb-40">
          {/* Header: z-10 allows the spinner to smoothly glide over it */}
          <header className={`sticky top-0 z-10 -mx-5 bg-gray-50 px-5 dark:bg-[#0b1120] ${HEADER_SPACE}`}>
            <h1 className="text-xl font-black">
              My <span className="text-orange-500">Wallet</span>
            </h1>
          </header>

          {/* ------------------------------ Balance ------------------------------ */}
          {showSkeleton ? (
            <div className="h-52 animate-pulse rounded-3xl bg-orange-50 dark:bg-[#141d33]" />
          ) : hasNothingToShow ? (
            <div className="rounded-3xl bg-orange-50 px-6 py-12 text-center dark:bg-[#141d33]">
              <p className="text-base font-bold">We couldn&apos;t load your wallet</p>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Check your connection and try again.</p>
              <button type="button" onClick={() => void reload()} className={`mt-6 ${PRIMARY_BTN}`}>
                Retry
              </button>
            </div>
          ) : (
            <section className="relative overflow-hidden rounded-3xl bg-orange-50 p-6 dark:bg-[#141d33]">
              <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-orange-500/15 blur-3xl" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Total balance</p>
                  <button
                    type="button"
                    aria-label="Refresh balance"
                    disabled={reloading}
                    onClick={() => void reload()}
                    className={`${ICON_BTN} -mr-2`}
                  >
                    <ClientIcon icon={refreshOutline} className={`text-xl ${reloading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div className="mt-2 flex h-12 items-center gap-2">
                  <div className="flex h-12 min-w-[8.5rem] items-center">
                    {reloading ? (
                      <Spinner className="h-7 w-7" />
                    ) : (
                      <h2 className="text-[32px] font-black leading-tight tracking-tight tabular-nums">
                        {balanceText}
                      </h2>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={showBalance ? 'Hide balance' : 'Show balance'}
                    onClick={toggleBalance}
                    className={ICON_BTN}
                  >
                    <ClientIcon icon={showBalance ? eyeOutline : eyeOffOutline} className="text-xl" />
                  </button>
                </div>

                <div className="mt-8">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Withdrawable</p>
                  <div className="mt-1.5 flex h-7 items-center">
                    {reloading ? (
                      <Spinner className="h-5 w-5" />
                    ) : (
                      <p className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400">
                        {showBalance ? formatNaira(wallet?.balance ?? 0) : '₦ ••••••'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ------------------------------ Actions ------------------------------ */}
          <div className="mt-10 grid grid-cols-4 gap-3">
            <ActionButton
              label="Top up"
              icon={arrowDownOutline}
              tint="bg-green-500/10 text-green-600 dark:text-green-400"
              onClick={openWhenReady('topup')}
            />
            <ActionButton
              label="Withdraw"
              icon={arrowUpOutline}
              tint="bg-red-500/10 text-red-500"
              onClick={openWhenReady('withdraw')}
            />
            <ActionButton label="Data" icon={wifiOutline} tint="bg-blue-500/10 text-blue-500" disabled soon />
            <ActionButton label="Airtime" icon={callOutline} tint="bg-purple-500/10 text-purple-500" disabled soon />
          </div>

          {/* ---------------------------- Transactions --------------------------- */}
          <section className="mt-14">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Recent transactions</h3>
              <button
                type="button"
                onClick={() => setView('allTx')}
                className="bg-transparent! border-0! shadow-none! px-0! py-2! text-xs font-semibold text-orange-500"
              >
                See all
              </button>
            </div>
            <div className="mt-2">
              {showSkeleton ? (
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
        <div className="mx-auto max-w-md px-6 pb-[calc(env(safe-area-inset-bottom,0px)+40px)] pt-3">
          <div className="mx-auto mb-7 h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
          <h3 className="text-xl font-black">Fund wallet</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Send money from any bank app to this account, then tap the refresh icon on your balance to see it.
          </p>

          <div className="mt-8 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Account number</p>
              <p className="mt-1.5 text-3xl font-black tracking-wider tabular-nums">
                {wallet?.virtual_account_number || '—'}
              </p>
            </div>
            <button
              type="button"
              aria-label="Copy account number"
              onClick={handleCopyAccount}
              className="flex h-12 min-h-12 w-12 shrink-0 items-center justify-center rounded-full! bg-orange-500/10! text-orange-500! border-0! shadow-none! p-0!"
            >
              <ClientIcon icon={copied ? checkmarkOutline : copyOutline} className="text-xl" />
            </button>
          </div>

          <dl className="mt-8 space-y-5 text-sm">
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
      className={`flex flex-col items-center gap-2.5 ${FLAT} ${disabled ? 'opacity-50' : 'active:scale-95'}`}
    >
      <span className={`flex h-14 w-14 items-center justify-center rounded-full ${tint}`}>
        <ClientIcon icon={icon} className="text-2xl" />
      </span>
      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
        {label}
        {soon ? <span className="mt-0.5 block text-[10px] font-medium text-gray-400">Soon</span> : null}
      </span>
    </button>
  );
}