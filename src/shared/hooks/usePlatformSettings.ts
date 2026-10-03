"use client";

// src/shared/hooks/usePlatformSettings.ts
//
// Replaces the hand-rolled module cache in the product card.
// SWR merges identical requests (50 cards = 1 query), caches the result,
// and retries on failure instead of caching the failure forever.

import useSWR from 'swr';
import { supabase } from '@/lib/supabase';

async function fetchPlatformSettings() {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export function usePlatformSettings() {
  const { data, isLoading } = useSWR('platform-settings', fetchPlatformSettings, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60 * 1000,
  });

  return { settings: data ?? null, isLoading };
}