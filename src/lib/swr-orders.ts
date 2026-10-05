import { mutate as globalMutate } from 'swr';
import { supabase } from '@/lib/supabase';

// Cache keys. The first segment is unique per page shape, so keys can never collide.
// A `null` key means "don't fetch yet" (user still resolving, or no ref in the URL).
export const keys = {
  authUser: () => ['auth-user'] as const,
  orderDetails: (uid?: string, ref?: string | null) =>
    uid && ref ? (['order-details', uid, ref] as const) : null,
  orderCancel: (uid?: string, ref?: string | null) =>
    uid && ref ? (['order-cancel', uid, ref] as const) : null,
};

// Throws on real failures so SWR keeps the last good user. "No session" is a normal answer (null).
export const fetchAuthUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  return data?.user ?? null;
};

/**
 * Call after any write that changes an order (confirm, cancel, dispute).
 * - Cached copies of that order are dropped, so the next visit loads fresh instead of
 *   flashing the old status (e.g. a "Confirm Receipt" button on an order already released).
 *   Pass `keep` for the page you're currently on and have already patched yourself.
 * - Lists refetch quietly in the background. Add other related keys here (wallet, orders list).
 */
export function refreshAfterOrderWrite(ref: string, opts: { keep?: 'order-details' | 'order-cancel' } = {}) {
  globalMutate(
    (k: unknown) =>
      Array.isArray(k) &&
      (k[0] === 'order-details' || k[0] === 'order-cancel') &&
      k[0] !== opts.keep &&
      k[2] === ref,
    undefined,
    { revalidate: false }
  );
  globalMutate('activity');
}