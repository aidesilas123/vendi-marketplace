"use client";

// src/shared/hooks/useSavedIds.ts
//
// One shared list of the signed-in user's saved product IDs.
// Every card, the feed, the Saved tab and the product page can read the same cache,
// so a bookmark tapped anywhere updates everywhere instantly.

import { useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';

export const SAVED_IDS_KEY = 'saved-ids';

export type ToggleResult = 'saved' | 'removed' | 'unauthenticated' | 'error';

async function fetchSavedIds(): Promise<string[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data, error } = await supabase
    .from('saved_items')
    .select('product_id')
    .eq('user_id', session.user.id);
  if (error) throw error;

  return (data ?? []).map((row: any) => row.product_id);
}

export function useSavedIds() {
  const { data, mutate } = useSWR<string[]>(SAVED_IDS_KEY, fetchSavedIds, {
    revalidateOnFocus: true,
    dedupingInterval: 30000,
  });

  // Always read the latest list inside toggle() without re-creating it on every change
  const latest = useRef<string[] | undefined>(data);
  latest.current = data;

  const savedIds = useMemo(() => new Set(data ?? []), [data]);

  const toggle = useCallback(
    async (productId: string): Promise<ToggleResult> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return 'unauthenticated';

      const current = latest.current ?? [];
      const wasSaved = current.includes(productId);
      const next = wasSaved ? current.filter((id) => id !== productId) : [...current, productId];

      try {
        await mutate(
          async () => {
            if (wasSaved) {
              const { error } = await supabase
                .from('saved_items')
                .delete()
                .match({ user_id: session.user.id, product_id: productId });
              if (error) throw error;
            } else {
              const { error } = await supabase
                .from('saved_items')
                .insert({ user_id: session.user.id, product_id: productId });
              // 23505 = already saved (double tap / another device): treat as success
              if (error && (error as any).code !== '23505') throw error;
            }
            return next;
          },
          {
            optimisticData: next,   // heart flips instantly
            rollbackOnError: true,  // and flips back if the request fails
            populateCache: true,
            revalidate: false,
          }
        );
        return wasSaved ? 'removed' : 'saved';
      } catch {
        return 'error';
      }
    },
    [mutate]
  );

  return { savedIds, isLoaded: data !== undefined, toggle };
}