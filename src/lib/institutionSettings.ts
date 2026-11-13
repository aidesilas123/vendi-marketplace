// src/lib/institutionSettings.ts
//
// Per-institution platform settings, with the global platform_settings row
// (id = 1) as fallback.
//
// Resolution order:
//   1. institution_settings row for the (lowercase) university slug —
//      products store university_id UPPERCASED, users store it lowercase,
//      so the slug is normalized here.
//   2. Global platform_settings id = 1 — used when there is no institution
//      row (institution not configured yet) or no university at all
//      (logged-out user). This keeps every existing screen working before
//      an institution row exists.
//
// A failed institution lookup falls through to the global row (a missing
// table/row must degrade to the global fee, never to a crash). A failed
// GLOBAL lookup throws, so callers see a real error instead of a silently
// wrong fee; an absent global row returns null so money-critical callers
// can fail closed exactly like the old direct fetch did.
// The returned shape is what calcFees() expects (platform_fee_percentage +
// is_launch_promo_active); university_id is null when the global row was
// used. Edge functions mirror this resolver locally (they cannot import
// from src/) — keep the three copies in sync.

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeUniversityId } from '@/constants/universities';

export type InstitutionSettings = {
  /** Lowercase university slug, or null when the global row was used. */
  university_id: string | null;
  platform_fee_percentage: number | string | null;
  is_launch_promo_active: boolean | null;
};

export async function resolveInstitutionSettings(
  supabase: SupabaseClient,
  universityId: string | null | undefined
): Promise<InstitutionSettings | null> {
  const slug = normalizeUniversityId(universityId);

  if (slug) {
    const { data } = await supabase
      .from('institution_settings')
      .select('university_id, platform_fee_percentage, is_launch_promo_active')
      .eq('university_id', slug)
      .maybeSingle();
    if (data) {
      return {
        university_id: data.university_id,
        platform_fee_percentage: data.platform_fee_percentage ?? null,
        is_launch_promo_active: data.is_launch_promo_active ?? null,
      };
    }
    // No row (or a failed lookup, e.g. table not created yet): fall through
    // to the global row below instead of throwing.
  }

  const { data: globalSettings, error: globalError } = await supabase
    .from('platform_settings')
    .select('platform_fee_percentage, is_launch_promo_active')
    .eq('id', 1)
    .maybeSingle();
  // A failed GLOBAL lookup throws (callers see a real error); an absent
  // global row returns null so money-critical callers can fail closed
  // exactly like the old direct fetch did, while display callers degrade
  // to a 0 fee via calcFees(null).
  if (globalError) throw globalError;
  if (!globalSettings) return null;
  return {
    university_id: null,
    platform_fee_percentage: globalSettings.platform_fee_percentage ?? null,
    is_launch_promo_active: globalSettings.is_launch_promo_active ?? null,
  };
}
