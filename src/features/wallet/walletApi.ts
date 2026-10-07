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

  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new NetworkError();
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