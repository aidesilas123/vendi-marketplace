"use client";

// src/features/wallet/useWallet.ts
// SWR hooks for the wallet page: cached per user, background revalidation, optional realtime.

import { useEffect, useRef, useState } from 'react';
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

    // onAuthStateChange is the definitive real-time authority in Supabase v2.
    // 'INITIAL_SESSION' fires as soon as the client has resolved local storage.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUserId(session?.user.id ?? null);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session?.user.id) {
        setUserId(data.session.user.id);
      } else {
        // If getSession returns null initially (e.g. storage async restore in progress),
        // give onAuthStateChange a moment to fire INITIAL_SESSION before claiming signed out.
        setTimeout(() => {
          if (active) {
            setUserId((prev) => (prev === undefined ? null : prev));
          }
        }, 200);
      }
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
  if (error) {
    // Logged (not just thrown): until now a wallet failure left nothing
    // in the console — only the generic panel — so a first-visit failure
    // could never be traced to its step. The step tag tells which query
    // or edge call failed; the message tells why (network, session,
    // RLS, edge status).
    console.error('[wallet] wallets query failed:', error.message);
    throw new Error(error.message);
  }

  let wallet = data as Wallet | null;
  if (!wallet) {
    try {
      wallet = await createWalletOnce(userId);
    } catch (e) {
      console.error('[wallet] create-wallet failed:', e instanceof Error ? e.message : e);
      throw e;
    }
  } else if (!wallet.virtual_account_number) {
    // Row exists but the virtual account was never provisioned (e.g. created
    // before virtual accounts existed, or Monnify was down at creation).
    // Backfill it now — but never break the dashboard if provisioning fails.
    try {
      wallet = await createWalletOnce(userId);
    } catch (e) {
      console.warn('[wallet] virtual account backfill failed, using existing row:', e);
    }
  }

  // wallet_id OR user_id: a row written without a wallet_id still shows up.
  // We keep wallet balance visible even if transactions query experiences a hiccup.
  let transactions: WalletTx[] = [];
  try {
    const txFilter = wallet?.id
      ? `wallet_id.eq.${wallet.id},user_id.eq.${userId}`
      : `user_id.eq.${userId}`;
    const { data: txs, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .or(txFilter)
      .order('created_at', { ascending: false })
      .limit(100);
    if (txError) {
      console.warn('[wallet] transactions query failed, continuing with empty list:', txError.message);
    } else {
      transactions = (txs ?? []) as WalletTx[];
    }
  } catch (err) {
    console.warn('[wallet] transactions query threw:', err);
  }

  return { wallet: wallet ?? null, transactions };
}

export function useWallet() {
  const userId = useSessionUserId();
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const { data, error, isLoading, isValidating, mutate } = useSWR<WalletData>(
    userId ? ['wallet', userId] : null,
    (key: string[]) => fetchWalletData(key[1]),
    {
      revalidateOnFocus: true,
      focusThrottleInterval: 15_000,
      dedupingInterval: 4000,
      // Transient failures (mobile network switching, Supabase/edge cold
      // starts) used to fail the whole wallet load on first blip: with
      // shouldRetryOnError off, one blip meant the error panel at once,
      // even though a second later the same fetch succeeds. Bounded
      // retries absorb blips — 3 attempts with backoff (1s, 2s, 3s) —
      // and the error panel only shows after they all fail, which is a
      // real failure, not a blip. Bounded, never a loop; auth errors
      // fail fast through the same 3 attempts and surface as before.
      shouldRetryOnError: true,
      onErrorRetry: (err, _key, _config, revalidate, { retryCount }) => {
        // Logged per attempt: without this, retries were silent, so a
        // failure that exhausted all 4 attempts looked identical to one
        // that failed once. Attempt 1 is the initial fetch; attempts 2-4
        // are the retries (1s, 2s, 3s backoff).
        if (retryCount >= 3) {
          setIsRetrying(false);
          console.error('[wallet] load failed after 3 retries, giving up:', err instanceof Error ? err.message : err);
          return;
        }
        setIsRetrying(true);
        console.error(`[wallet] load failed (attempt ${retryCount + 1}/4), retrying in ${retryCount + 1}s:`, err instanceof Error ? err.message : err);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          revalidate({ retryCount });
        }, 1000 * (retryCount + 1));
      },
      onSuccess: () => {
        setIsRetrying(false);
      },
      keepPreviousData: true,
    }
  );

  // Realtime: new deposits / status changes appear without a manual refresh.
  // Needs Realtime enabled for `wallets` and `transactions` in Supabase; harmless if it isn't.
  const walletId = data?.wallet?.id;
  useEffect(() => {
    if (!walletId) return;
    const channel = supabase
      .channel(`wallet-${walletId}-${Date.now()}`)
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
    isValidating: isValidating || isRetrying,
    isRetrying,
    refresh: () => {
      setIsRetrying(false);
      return mutate();
    },
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
    /* storage full / unavailable */
  }
  return undefined;
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
      fallbackData: readBanksCache(),
      revalidateOnFocus: false,
      dedupingInterval: 6 * 60 * 60 * 1000,
      errorRetryCount: 2,
    }
  );
}
