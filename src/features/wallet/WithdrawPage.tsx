"use client";

// src/features/wallet/WithdrawPage.tsx
//
// Full-screen withdraw flow:
//   form  → pick a bank (live list from Monnify) → account name is verified automatically
//   pin   → create / confirm / verify the 4-digit transaction PIN
//   success → receipt with "Share as image"
//
// Alerts use the shared toast (showGlobalToast), so <GlobalToastHost /> must be in app/layout.tsx.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import { IonIcon } from '@ionic/react';
import {
  arrowBackOutline,
  backspaceOutline,
  checkmarkCircle,
  chevronForwardOutline,
  checkmarkOutline,
  searchOutline,
} from 'ionicons/icons';
import { FullScreenPage } from './FullScreenPage';
import { ReceiptContent, ShareReceiptButton } from './TransactionReceipt';
import { useBanks, type Bank, type Wallet } from './useWallet';
import { callEdge, friendlyError } from './walletApi';
import { formatNaira, type WalletTx } from './txUtils';
import { showGlobalToast } from '@/shared/Toast/Toast';

const MIN_WITHDRAWAL = 100;
const QUICK_AMOUNTS = [1000, 5000, 10000];

type Step = 'form' | 'pin' | 'success';
type PinMode = 'create' | 'confirm' | 'verify';

// `!` beats the app's global <button>/<input> styles (padding, height, borders, background)
const FLAT_BTN = 'bg-transparent! border-0! shadow-none! p-0!';
// Orange outline for the bank + account number fields
const ORANGE_BORDER = 'border-2! border-solid! border-orange-500!';
const ORANGE_FOCUS = 'focus:ring-4 focus:ring-orange-500/20';
const CHIP = 'rounded-full! px-3.5! py-2.5! text-[13px]! font-semibold! shadow-none! border-0! disabled:opacity-40';

/* -------------------------------------------------------------------------- */
/*  PIN keypad                                                                 */
/* -------------------------------------------------------------------------- */

function PinPad({
  pin,
  onDigit,
  onBackspace,
}: {
  pin: string;
  onDigit: (d: string) => void;
  onBackspace: () => void;
}) {
  const keyClass = `${FLAT_BTN} mx-auto flex h-16 min-h-16 w-16 items-center justify-center rounded-full! text-2xl font-bold active:bg-gray-200/70! dark:active:bg-white/10!`;
  return (
    <>
      <div className="my-12 flex justify-center gap-6">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full transition-all duration-200 ${
              i < pin.length ? 'scale-110 bg-orange-500' : 'bg-gray-300 dark:bg-gray-700'
            }`}
          />
        ))}
      </div>
      <div className="mx-auto grid max-w-[300px] grid-cols-3 gap-x-5 gap-y-6">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => onDigit(d)} className={keyClass}>
            {d}
          </button>
        ))}
        <div />
        <button type="button" onClick={() => onDigit('0')} className={keyClass}>
          0
        </button>
        <button type="button" aria-label="Delete" onClick={onBackspace} className={`${keyClass} text-gray-500`}>
          <IonIcon icon={backspaceOutline} />
        </button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Bank picker (portal, so it is independent of the page's scroll/gestures)   */
/* -------------------------------------------------------------------------- */

function BankPicker({
  banks,
  loading,
  error,
  selected,
  onSelect,
  onClose,
  onRetry,
}: {
  banks: Bank[] | undefined;
  loading: boolean;
  error: Error | undefined;
  selected: Bank | null;
  onSelect: (bank: Bank) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (banks ?? []).filter((b) => b.name.toLowerCase().includes(q));
  }, [banks, query]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex animate-fade-in flex-col bg-gray-50 text-gray-900 dark:bg-[#0b1120] dark:text-white">
      <div className="flex shrink-0 items-center gap-2 px-5 py-5">
        <button
          type="button"
          aria-label="Back"
          onClick={onClose}
          className={`${FLAT_BTN} -ml-2 flex h-11 min-h-11 w-11 items-center justify-center rounded-full!`}
        >
          <IonIcon icon={arrowBackOutline} className="text-2xl" />
        </button>
        <h2 className="text-xl font-black">Select bank</h2>
      </div>

      <div className="shrink-0 px-5 pb-4">
        <div className={`flex items-center gap-3 rounded-2xl bg-gray-200/60 px-4 dark:bg-white/10 ${ORANGE_BORDER}`}>
          <IonIcon icon={searchOutline} className="text-lg text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search banks"
            className="h-12 w-full bg-transparent! text-sm font-medium outline-none border-0! shadow-none!"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-12" style={{ overscrollBehaviorY: 'contain' }}>
        {loading && !banks ? (
          <div className="animate-pulse space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="my-4 h-4 w-3/5 rounded bg-gray-200 dark:bg-white/10" />
            ))}
          </div>
        ) : error && !banks ? (
          <div className="py-14 text-center">
            <p className="text-base font-semibold">Couldn&apos;t load banks</p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{friendlyError(error)}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-6 h-12! min-h-12! rounded-full! bg-orange-500! px-8! py-0! text-sm! font-bold! text-white! border-0! shadow-none!"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500 dark:text-gray-400">No banks found</p>
        ) : (
          filtered.map((bank) => (
            <button
              key={bank.code}
              type="button"
              onClick={() => onSelect(bank)}
              className="flex w-full items-center justify-between rounded-none! bg-transparent! border-0! shadow-none! px-0! py-4! text-left text-sm font-semibold"
            >
              <span className="truncate pr-3">{bank.name}</span>
              {selected?.code === bank.code && <IonIcon icon={checkmarkOutline} className="text-lg text-orange-500" />}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function WithdrawPage({
  wallet,
  onClosed,
  onCompleted,
}: {
  wallet: Wallet;
  onClosed: () => void;
  /** Called right after a successful request so the dashboard can refresh balance + history. */
  onCompleted: () => void;
}) {
  const balance = Number(wallet.balance || 0);

  const [step, setStep] = useState<Step>('form');
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const [pin, setPin] = useState('');
  const [pinMode, setPinMode] = useState<PinMode>(wallet.pin_set ? 'verify' : 'create');
  const [tempPin, setTempPin] = useState('');
  const [processing, setProcessing] = useState(false);
  const [receipt, setReceipt] = useState<WalletTx | null>(null);

  const { data: banks, error: banksError, isLoading: banksLoading, mutate: reloadBanks } = useBanks();

  // Verify the account name against the live banking network as soon as bank + 10 digits are set
  const canResolve = !!bank && accountNumber.length === 10;
  const {
    data: resolved,
    error: resolveError,
    isLoading: resolving,
  } = useSWR(
    canResolve ? ['resolve-account', bank!.code, accountNumber] : null,
    (key: string[]) =>
      callEdge<{ accountName: string }>('resolve-account', { accountNumber: key[2], bankCode: key[1] }),
    { shouldRetryOnError: false, revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const resolvedName = resolved?.accountName ?? '';

  useEffect(() => {
    if (resolveError) showGlobalToast(friendlyError(resolveError, 'Could not verify this account'), 'error');
  }, [resolveError]);

  const amountNum = Number(amount) || 0;
  // Shown with thousands separators (70,000); `amount` itself stays the raw digits
  const displayAmount = (() => {
    if (!amount) return '';
    const [whole, dec] = amount.split('.');
    const wholeFmt = whole ? Number(whole).toLocaleString('en-NG') : '0';
    return dec !== undefined ? `${wholeFmt}.${dec}` : wholeFmt;
  })();
  const amountHint =
    amount && amountNum < MIN_WITHDRAWAL
      ? `Minimum withdrawal is ${formatNaira(MIN_WITHDRAWAL)}`
      : amountNum > balance
        ? 'This is more than your available balance'
        : '';
  const canSubmit = !!resolvedName && !resolving && amountNum >= MIN_WITHDRAWAL && amountNum <= balance;

  /* ----------------------------- form handlers ---------------------------- */

  const handleAmountChange = (raw: string) => {
    let v = raw.replace(/[^\d.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    const [whole, dec] = v.split('.');
    setAmount(dec !== undefined ? `${whole}.${dec.slice(0, 2)}` : whole);
  };

  const handleContinue = () => {
    if (!navigator.onLine) return showGlobalToast('No internet connection. Check your network and try again.', 'error');
    if (!bank || !resolvedName) return showGlobalToast('Select a bank and verify the account first', 'error');
    if (amountNum < MIN_WITHDRAWAL) return showGlobalToast(`Minimum withdrawal is ${formatNaira(MIN_WITHDRAWAL)}`, 'error');
    if (amountNum > balance) return showGlobalToast('Insufficient withdrawable funds', 'error');

    setPin('');
    setTempPin('');
    setPinMode(wallet.pin_set || pinMode === 'verify' ? 'verify' : 'create');
    setStep('pin');
  };

  /* ------------------------------ PIN handlers ---------------------------- */

  const submitWithdrawal = async (code: string, isNewPin: boolean) => {
    if (!bank) return;
    setProcessing(true);
    try {
      if (isNewPin) {
        await callEdge('manage-pin', { action: 'set', pin: code });
        setPinMode('verify'); // PIN now exists; any retry should verify instead of create
        setTempPin('');
      }
      // The PIN is verified on the server inside process-withdrawal
      const res = await callEdge<{ transaction: WalletTx }>('process-withdrawal', {
        amount: amountNum,
        accountNumber,
        bankCode: bank.code,
        bankName: bank.name,
        accountName: resolvedName,
        pin: code,
      });
      setReceipt(res.transaction);
      setStep('success');
      onCompleted();
    } catch (e) {
      showGlobalToast(friendlyError(e, 'Withdrawal failed. Please try again.'), 'error');
      setPin('');
    } finally {
      setProcessing(false);
    }
  };

  const handlePinComplete = async (code: string, mode: PinMode, firstPin: string) => {
    if (mode === 'create') {
      setTempPin(code);
      setPin('');
      setPinMode('confirm');
      return;
    }
    if (mode === 'confirm') {
      if (code !== firstPin) {
        showGlobalToast('PINs do not match. Please try again.', 'error');
        setPin('');
        setTempPin('');
        setPinMode('create');
        return;
      }
      await submitWithdrawal(code, true);
      return;
    }
    await submitWithdrawal(code, false);
  };

  const pressDigit = (d: string) => {
    if (processing || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      const mode = pinMode;
      const first = tempPin;
      setTimeout(() => void handlePinComplete(next, mode, first), 180);
    }
  };

  /* --------------------------------- render ------------------------------- */

  const pinTitle =
    pinMode === 'create' ? 'Create transaction PIN' : pinMode === 'confirm' ? 'Confirm your PIN' : 'Enter transaction PIN';
  const pinHint =
    pinMode === 'create'
      ? 'Set a 4-digit PIN to secure your wallet.'
      : pinMode === 'confirm'
        ? 'Enter the same PIN again to confirm.'
        : 'Enter your 4-digit PIN to authorise this withdrawal.';

  const title = step === 'form' ? 'Withdraw' : step === 'pin' ? 'Confirm withdrawal' : 'Receipt';

  return (
    <>
      <FullScreenPage
        title={title}
        onClosed={onClosed}
        onBack={(close) => {
          if (processing) return;
          if (step === 'pin') {
            setPin('');
            setStep('form');
          } else {
            close();
          }
        }}
        footer={(close) => {
          if (step === 'form') {
            return (
              <div className="mx-auto w-full max-w-md px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4">
                {/* h-16 + min-h keep the button tall; `!` overrides the global button styles */}
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={!canSubmit}
                  className="h-16! min-h-16! w-full rounded-full! border-none! bg-orange-500! px-6! py-0! text-lg! font-black! text-white! shadow-[0_8px_30px_rgb(249,115,22,0.3)]! transition-all hover:bg-orange-600! disabled:bg-gray-300! disabled:shadow-none! dark:disabled:bg-gray-800!"
                >
                  Process Withdrawal
                </button>
              </div>
            );
          }
          if (step === 'success' && receipt) {
            return (
              <div className="mx-auto w-full max-w-md space-y-3 px-6 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4">
                <ShareReceiptButton tx={receipt} />
                <button
                  type="button"
                  onClick={close}
                  className="h-14! min-h-14! w-full rounded-full! bg-transparent! px-6! py-0! text-base! font-bold text-gray-900 shadow-none! border-0! dark:text-white"
                >
                  Done
                </button>
              </div>
            );
          }
          return null;
        }}
      >
        {step === 'form' && (
          <div className="mx-auto w-full max-w-md px-5 pb-12">
            {/* Amount */}
            <div className="pt-4 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Available balance <span className="font-bold text-gray-900 dark:text-white">{formatNaira(balance)}</span>
              </p>
              <div className="relative mt-6">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-black text-orange-500">
                  ₦
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={displayAmount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder="0.00"
                  aria-label="Amount to withdraw"
                  className={`h-16 w-full rounded-2xl bg-gray-200/60 pl-10 pr-4 text-left text-lg font-semibold outline-none dark:bg-white/10 ${ORANGE_BORDER} ${ORANGE_FOCUS}`}
                />
              </div>
              <p className={`mt-2 h-4 px-1 text-left text-xs font-medium text-red-500 ${amountHint ? '' : 'invisible'}`}>{amountHint || '.'}</p>

              <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                {QUICK_AMOUNTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={q > balance}
                    onClick={() => setAmount(String(q))}
                    className={`${CHIP} bg-gray-200/70! text-gray-700! dark:bg-white/10! dark:text-gray-200!`}
                  >
                    ₦{q.toLocaleString()}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={balance < MIN_WITHDRAWAL}
                  onClick={() => setAmount(String(Math.floor(balance * 100) / 100))}
                  className={`${CHIP} bg-orange-500/10! text-orange-500!`}
                >
                  Max
                </button>
              </div>
            </div>

            {/* Recipient */}
            <div className="mt-14 space-y-9">
              <div>
                <label className="mb-3 block text-xs font-semibold text-gray-500 dark:text-gray-400">Bank</label>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className={`flex h-16! min-h-16! w-full items-center justify-between rounded-2xl! bg-gray-200/60! px-4! py-0! text-left text-base font-semibold shadow-none! dark:bg-white/10! ${ORANGE_BORDER}`}
                >
                  <span className={`truncate pr-3 ${bank ? '' : 'text-gray-400'}`}>{bank ? bank.name : 'Select bank'}</span>
                  <IonIcon icon={chevronForwardOutline} className="shrink-0 text-gray-400" />
                </button>
              </div>

              <div>
                <label className="mb-3 block text-xs font-semibold text-gray-500 dark:text-gray-400">Account number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="0000000000"
                  className={`h-16 w-full rounded-2xl bg-gray-200/60 px-4 text-lg font-semibold tracking-widest outline-none dark:bg-white/10 ${ORANGE_BORDER} ${ORANGE_FOCUS}`}
                />
                <div className="mt-4 min-h-6 px-1">
                  {canResolve && resolving && (
                    <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
                  )}
                  {resolvedName && !resolving && (
                    <p className="flex items-center gap-2 text-sm font-bold text-green-600 dark:text-green-400">
                      <IonIcon icon={checkmarkCircle} className="text-base" />
                      <span className="truncate">{resolvedName}</span>
                    </p>
                  )}
                  {canResolve && !resolving && !resolvedName && resolveError && (
                    <p className="text-xs font-medium text-red-500">
                      {friendlyError(resolveError, 'Could not verify this account')}
                    </p>
                  )}
                  {!bank && accountNumber.length === 10 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">Select a bank to verify this account</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'pin' && (
          <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 pb-12 pt-4 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Sending <span className="font-bold text-gray-900 dark:text-white">{formatNaira(amountNum)}</span> to
            </p>
            <p className="mt-2 text-base font-bold">{resolvedName}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {bank?.name} · {accountNumber}
            </p>

            <h3 className="mt-12 text-lg font-black">{pinTitle}</h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{pinHint}</p>

            <PinPad pin={pin} onDigit={pressDigit} onBackspace={() => setPin((p) => p.slice(0, -1))} />
          </div>
        )}

        {step === 'success' && receipt && (
          <>
            <ReceiptContent tx={receipt} />
            <p className="mx-auto max-w-xs px-6 pb-10 pt-2 text-center text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Your bank transfer is being processed. This page updates once the bank confirms it.
            </p>
          </>
        )}
      </FullScreenPage>

      {pickerOpen && (
        <BankPicker
          banks={banks}
          loading={banksLoading}
          error={banksError as Error | undefined}
          selected={bank}
          onRetry={() => void reloadBanks()}
          onClose={() => setPickerOpen(false)}
          onSelect={(b) => {
            setBank(b);
            setPickerOpen(false);
          }}
        />
      )}

      {processing &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/50 p-4 backdrop-blur-md">
            <div className="mb-4 h-14 w-14 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
            <p className="animate-pulse text-lg font-black tracking-wide text-white">Processing securely…</p>
          </div>,
          document.body
        )}
    </>
  );
}