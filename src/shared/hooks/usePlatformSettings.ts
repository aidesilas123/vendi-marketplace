// src/shared/hooks/usePlatformSettings.ts
"use client";

// src/shared/hooks/usePlatformSettings.ts
//
// ONE hook for platform fees, used by every fee reader in the app
// (listing cards, buy, product details, seller dashboard). The fee comes
// from the listing's / seller's institution when one is configured, and
// falls back to the global platform_settings row (id = 1) otherwise — see
// resolveInstitutionSettings in src/lib/institutionSettings.ts.
//
// The SWR key is institution-scoped (['platform-settings', slug]), so
// cards from the same institution share one fetch and a different
// institution never reads another one's cached row. The old divergent keys
// ('platform-settings', 'platform-settings-raw',
// 'product-details-settings', 'seller-platform-settings') are gone.
//
// Returns { settings, isLoading, error, mutate }:
//   settings   — the resolved row (calcFees-compatible) or null while loading.
//   isLoading  — true until the first fetch resolves (feed cards hold the
//                price skeleton on this; buy/product wait on it before
//                showing a price, so it never jumps).
//   error      — the fetch error, if any (seller dashboard toasts on it).
//   mutate     — SWR revalidate, for the retry screens.

import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { normalizeUniversityId } from '@/constants/universities';
import { resolveInstitutionSettings } from '@/lib/institutionSettings';

export function usePlatformSettings(universityId?: string | null) {
  const slug = normalizeUniversityId(universityId);
  const { data, error, isLoading, mutate } = useSWR(
    ['platform-settings', slug || null],
    ([, uni]) => resolveInstitutionSettings(supabase, uni),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5 * 60 * 1000,
    }
  );

  return { settings: data ?? null, isLoading, error, mutate };
}
