// src/features/wallet/walletApi.ts
// One place to call the Supabase edge functions, with errors the UI can show in a toast.

import { supabase } from '@/lib/supabase';

const FUNCTIONS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

export class NetworkError extends Error {
  constructor(message = 'No internet connection. Check your network and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export async function callEdge<T = any>(name: string, body?: Record<string, unknown>): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session has expired. Please sign in again.');

  const post = async (token: string): Promise<Response> => {
    try {
      return await fetch(`${FUNCTIONS_URL}/${name}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      });
    } catch {
      throw new NetworkError();
    }
  };

  let res = await post(session.access_token);

  // Auth-aware retry: on a cold first visit the stored token can be stale
  // (clock skew, slow refresh) — PostgREST may still accept it while the
  // edge function rejects it with 401 (the wallet first-visit failure).
  // Refresh once and retry once with the fresh token before surfacing
  // the failure, instead of failing the whole load on a token the next
  // second would have fixed. Bounded (one refresh, one retry); if the
  // refresh fails or the retry also 401s, the original failure surfaces
  // and the caller's retries / panel handle it as before.
  if (res.status === 401) {
    try {
      const {
        data: { session: fresh },
      } = await supabase.auth.refreshSession();
      if (fresh) {
        console.warn(`[edge] ${name} returned 401, refreshed session, retrying once`);
        res = await post(fresh.access_token);
      }
    } catch (e) {
      // Only a failed refresh is swallowed here. A NetworkError from the
      // retry post must propagate as itself, not masquerade as a 401 —
      // and refresh failures are supabase-js errors, never NetworkError,
      // so this check separates the two cleanly.
      if (e instanceof NetworkError) throw e;
      /* refresh failed — fall through with the original 401 */
    }
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  }
  return data as T;
}

/** Turns any thrown value into a short message that is safe to show in a toast. */
export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof NetworkError) return e.message;
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (!message) return fallback;
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return 'No internet connection. Check your network and try again.';
  }
  return message;
}