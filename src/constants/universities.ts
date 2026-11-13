// src/constants/universities.ts
//
// OFFLINE FALLBACK ONLY — the institution list lives in the DB now
// (public.institutions, see supabase_notes/institutions.sql; read it via
// src/shared/hooks/useInstitutions.ts). This list stands in while the DB
// fetch is loading or fails on a slow/offline network, so signup and
// badges never block on the network. New institutions are added in the
// DB (admin dashboard / SQL editor), NOT here — keep these 5 entries in
// sync with the institutions seed only as the fallback snapshot.

export interface University {
  id: string;
  name: string;
  /** Short badge label, e.g. 'ABU' (shown on listing cards and order rows). */
  shortName: string;
  campuses: string[];
  /** Offered in the signup / profile pickers. Mirrors institutions.is_active. */
  isActive: boolean;
}

export const NIGERIAN_UNIVERSITIES: University[] = [
  {
    id: 'abu',
    name: 'Ahmadu Bello University',
    shortName: 'ABU',
    isActive: true,
    campuses: [
      'Samaru Campus (Main)', 
      'Kongo Campus', 
      'Shika Campus'
    ]
  },
  {
    id: 'uniben',
    name: 'University of Benin',
    shortName: 'UNIBEN',
    isActive: false,
    campuses: [
      'Ugbowo Campus (Main)', 
      'Ekenwan Campus'
    ]
  },
  {
    id: 'unilag',
    name: 'University of Lagos',
    shortName: 'UNILAG',
    isActive: false,
    campuses: [
      'Akoka Campus (Main)', 
      'Yaba Campus', 
      'Idi-Araba Campus (CMUL)'
    ]
  },
  {
    id: 'unn',
    name: 'University of Nigeria, Nsukka',
    shortName: 'UNN',
    isActive: false,
    campuses: [
      'Nsukka Campus (Main)', 
      'Enugu Campus (UNEC)', 
      'Ituku-Ozalla Campus (UNTH)', 
      'Aba Campus'
    ]
  },
  {
    id: 'buk',
    name: 'Bayero University Kano',
    shortName: 'BUK',
    isActive: false,
    campuses: [
      'New Campus (Main)', 
      'Old Campus', 
      'Aminu Kano Teaching Hospital (AKTH)'
    ]
  }
];

/**
 * Normalizes any stored university id to the lowercase slug used as the
 * key everywhere (institution_settings.university_id, users.university_id).
 * Products store it UPPERCASED, users store it lowercase — both normalize
 * to the same slug here.
 */
export function normalizeUniversityId(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function getUniversityById(id: string | null | undefined): University | undefined {
  const slug = normalizeUniversityId(id);
  if (!slug) return undefined;
  return NIGERIAN_UNIVERSITIES.find((u) => u.id === slug);
}

/**
 * Short badge label for a stored university id ('ABU'). Unknown or empty
 * ids fall back to the raw value (uppercased by the caller's CSS), so a
 * badge never goes blank for a listing whose institution isn't in the list.
 */
export function getUniversityShortName(id: string | null | undefined): string {
  const uni = getUniversityById(id);
  if (uni) return uni.shortName;
  return String(id ?? '').trim();
}

/** Full institution name for a stored university id ('Ahmadu Bello University'). */
export function getUniversityName(id: string | null | undefined): string {
  const uni = getUniversityById(id);
  if (uni) return uni.name;
  return String(id ?? '').trim();
}
