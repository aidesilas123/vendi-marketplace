// src/shared/hooks/useInstitutions.ts
"use client";

// src/shared/hooks/useInstitutions.ts
//
// The institution list, from the DB — not the hardcoded list.
//
// Source of truth is the public.institutions table (see
// supabase_notes/institutions.sql). The hardcoded NIGERIAN_UNIVERSITIES in
// src/constants/universities.ts is the OFFLINE FALLBACK only: while the
// fetch is loading — or when it fails on a slow/offline network — the
// fallback list stands in, so signup and badges never block on the
// network. An empty DB list falls back the same way (table exists but the
// seed has not run yet), so a picker never renders empty.
//
// Returns { institutions, activeInstitutions, isLoading, error, isFallback }:
//   institutions      — every institution (DB rows, or the fallback list).
//                       Badges and profile resolve against ALL of these, so
//                       a stored id still shows its name after the
//                       institution is switched off.
//   activeInstitutions — institutions with is_active true. Pickers
//                       (signup / complete-profile / AuthScreen) list these
//                       only. While loading, the fallback's active set is
//                       just ABU — it expands to the DB's active set once
//                       the fetch lands.
//   isFallback        — true while loading, on fetch error, or when the DB
//                       list is empty.

import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { NIGERIAN_UNIVERSITIES, type University } from '@/constants/universities';

type InstitutionRow = {
  id: string | null;
  name: string | null;
  short_name: string | null;
  campuses: string[] | null;
  is_active: boolean | null;
};

export function useInstitutions() {
  const { data, error, isLoading } = useSWR(
    ['institutions'],
    async (): Promise<University[]> => {
      const { data, error } = await supabase
        .from('institutions')
        .select('id, name, short_name, campuses, is_active')
        .order('name');
      if (error) throw error;
      return (data ?? []).map((row: InstitutionRow) => ({
        id: String(row.id ?? '').trim().toLowerCase(),
        name: row.name ?? '',
        shortName: row.short_name ?? '',
        campuses: row.campuses ?? [],
        isActive: !!row.is_active,
      }));
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5 * 60 * 1000,
    }
  );

  // Empty DB list (seed not run yet) degrades to the fallback, same as a
  // failed fetch — a picker must never render empty.
  const isFallback = !data || data.length === 0;
  const institutions = isFallback ? NIGERIAN_UNIVERSITIES : data;
  const activeInstitutions = institutions.filter((u) => u.isActive);

  return { institutions, activeInstitutions, isLoading, error, isFallback };
}
