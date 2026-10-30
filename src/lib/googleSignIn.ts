// src/lib/googleSignIn.ts

// Native Google sign-in for the Capacitor app: the system account sheet
// (like other Android apps), no browser round-trip. Web keeps the browser
// OAuth flow (signInWithOAuth + /auth/callback) — this file is native-only.
import { supabase } from '@/lib/supabase';
import type { SocialLoginPlugin } from '@capgo/capacitor-social-login';

// Public OAuth client ID (it appears in every OAuth URL; the secret lives
// only in Supabase). Set NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env.local and
// in the CI workflow env — without it, native sign-in toasts a setup error.
const WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');

// Supabase checks the nonce to stop replayed ID tokens: Google gets the
// SHA-256 hex digest, Supabase gets the raw value (it hashes it itself).
async function createNoncePair() {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const rawNonce = toHex(random);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNonce));
  return { rawNonce, nonceDigest: toHex(new Uint8Array(digest)) };
}

let pluginPromise: Promise<SocialLoginPlugin> | null = null;

function getPlugin() {
  if (!WEB_CLIENT_ID) {
    throw new Error('Google sign-in is not configured yet.');
  }
  pluginPromise ??= import('@capgo/capacitor-social-login').then(async ({ SocialLogin }) => {
    // The WEB client ID, not the Android one. 'online' mode returns the
    // ID token Supabase needs. Lazy import: web builds never pull this in.
    await SocialLogin.initialize({ google: { webClientId: WEB_CLIENT_ID, mode: 'online' } });
    return SocialLogin;
  });
  return pluginPromise;
}

export type NativeGoogleResult = 'signed-in' | 'cancelled';

/**
 * Shows the native Google account sheet and signs the user into Supabase.
 * Returns 'cancelled' when the user dismisses the sheet (no error shown).
 * Throws a human-readable error for setup / account / network failures.
 * NOTE: no `scopes` option — passing one makes the Android plugin reject
 * unless MainActivity implements its social-login interface. The ID token
 * already carries email + profile.
 */
export async function signInWithGoogleNative(): Promise<NativeGoogleResult> {
  const { rawNonce, nonceDigest } = await createNoncePair();
  const plugin = await getPlugin();
  let res;
  try {
    res = await plugin.login({
      provider: 'google',
      options: { nonce: nonceDigest },
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? '');
    if (/cancel|canceled|dismissed/i.test(msg)) return 'cancelled';
    if (/28444|not set up correctly/i.test(msg)) {
      throw new Error('Google sign-in is not set up for this app yet (package name or signing key not registered in Google Cloud).');
    }
    if (/no credentials|no account/i.test(msg)) {
      throw new Error('No Google account found on this phone. Add one in Settings and try again.');
    }
    throw new Error(msg || 'Google sign-in failed. Please try again.');
  }
  if (res.result.responseType !== 'online' || !res.result.idToken) {
    throw new Error('Google did not return a sign-in token. Please try again.');
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: res.result.idToken,
    nonce: rawNonce,
  });
  if (error) throw error;
  return 'signed-in';
}
