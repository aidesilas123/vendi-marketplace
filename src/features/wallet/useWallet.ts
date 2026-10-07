"use client";

// src/features/wallet/useWallet.ts
// SWR hooks for the wallet page: cached per user, background revalidation, optional realtime.

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { callEdge } from './walletApi';
import type { WalletTx } from './txUtils';

export type Wallet = {
  id: string;
  user_id: string;
  balance: number | string;
  virtual_account_number: string | null;
  bank_name: string | null;
  account_name: string | null;
  pin_set: boolean | null;
};

export type Bank = { code: string; name: string };

type WalletData = { wallet: Wallet; transactions: WalletTx[] };

/* -------------------------------------------------------------------------- */
/*  Session user id (so the SWR cache is keyed per user)                       */
/* -------------------------------------------------------------------------- */

export function useSessionUserId() {
  // undefined = still checking, null = signed out
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return userId;
}

/* -------------------------------------------------------------------------- */
/*  Wallet + transactions                                                      */
/* -------------------------------------------------------------------------- */

// Only ever one create-wallet call in flight per user (focus events, double renders, taps…)
const creating = new Map<string, Promise<Wallet>>();

function createWalletOnce(userId: string): Promise<Wallet> {
  let pending = creating.get(userId);
  if (!pending) {
    pending = callEdge<Wallet>('create-wallet').finally(() => creating.delete(userId));
    creating.set(userId, pending);
  }
  return pending;
}

async function fetchWalletData(userId: string): Promise<WalletData> {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  let wallet = data as Wallet | null;
  if (!wallet) wallet = await createWalletOnce(userId);

  // wallet_id OR user_id: a row written without a wallet_id still shows up.
  const { data: txs, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .or(`wallet_id.eq.${wallet.id},user_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (txError) throw new Error(txError.message);

  return { wallet, transactions: (txs ?? []) as WalletTx[] };
}

export function useWallet() {
  const userId = useSessionUserId();

  const { data, error, isLoading, isValidating, mutate } = useSWR<WalletData>(
    userId ? ['wallet', userId] : null,
    (key: string[]) => fetchWalletData(key[1]),
    {
      revalidateOnFocus: true,
      focusThrottleInterval: 15_000,
      dedupingInterval: 4000,
      // A failed load (e.g. the bank provider is down) must NOT silently retry in a loop.
      // The user retries with the Retry button / pull-to-refresh.
      shouldRetryOnError: false,
      keepPreviousData: true,
    }
  );

  // Realtime: new deposits / status changes appear without a manual refresh.
  // Needs Realtime enabled for `wallets` and `transactions` in Supabase; harmless if it isn't.
  const walletId = data?.wallet.id;
  useEffect(() => {
    if (!walletId) return;
    const channel = supabase
      .channel(`wallet-${walletId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: `id=eq.${walletId}` }, () => {
        void mutate();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `wallet_id=eq.${walletId}` }, () => {
        void mutate();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [walletId, mutate]);

  return {
    userId,
    wallet: data?.wallet ?? null,
    transactions: data?.transactions ?? [],
    error: error as Error | undefined,
    isLoading: userId === undefined || isLoading,
    isValidating,
    refresh: () => mutate(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Live bank list                                                             */
/* -------------------------------------------------------------------------- */

const BANKS_CACHE_KEY = 'vendi_banks_v1';

function readBanksCache(): Bank[] | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(BANKS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Bank[]) : undefined;
  } catch {
    return undefined;
  }
}

export function useBanks() {
  return useSWR<Bank[]>(
    'wallet-banks',
    async () => {
      const { banks } = await callEdge<{ banks: Bank[] }>('list-banks');
      try {
        localStorage.setItem(BANKS_CACHE_KEY, JSON.stringify(banks));
      } catch {
        /* storage full / unavailable */
      }
      return banks;
    },
    {
      // Last live list is shown instantly (copy of the live data, not hard-coded), then refreshed.
      fallbackData: readBanksCache(),
      revalidateOnFocus: false,
      dedupingInterval: 6 * 60 * 60 * 1000,
      errorRetryCount: 2,
    }
  );
}