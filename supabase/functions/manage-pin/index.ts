// supabase/functions/manage-pin/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PIN policy (pre-launch audit H10, hardened in review rounds 2 and 4):
//  - 4-digit numeric PIN, enforced on set.
//  - Setting a new PIN requires the current PIN when one already exists,
//    and the update is conditional on the old pin_hash (a concurrent PIN
//    change is detected and rejected instead of silently overwritten).
//  - 5 failed verifies -> 15-minute lockout, persisted in pin_attempts.
//    Failed attempts are counted by the record_pin_attempt RPC (one atomic
//    statement), so concurrent guesses can never lose a count.
//  - Hash: PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP), with a random
//    128-bit salt generated per PIN and stored alongside the hash in a
//    modular format (pbkdf2-sha256$<iterations>$<salt>$<hash>), so future
//    algorithm/iteration upgrades can be detected and migrated. The old
//    single SHA-256(pin + user.id) and the round-2 PBKDF2 (100,000
//    iterations, salt = user id, bare hex) are kept ONLY as migration paths:
//    an existing PIN that still matches an old format is accepted once and
//    immediately re-hashed to the new format. New PINs never use them;
//    remove the old paths once migration is done.
//  - PIN_PEPPER is REQUIRED. If it is unset, the function fails closed
//    (no PIN can be set or verified) instead of silently falling back to
//    the weak hash. Keep the secret set in Supabase (Edge Functions ->
//    Secrets) and never change it: changing it invalidates every PIN.
//  - Every pin_attempts read/write checks its error and fails closed:
//    if the lockout state cannot be read or recorded, the PIN is rejected
//    rather than verified without a lockout.

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const PBKDF2_ITERATIONS = 600000;
const MIN_PBKDF2_ITERATIONS = 10000; // a stored modular count below this is rejected outright (returns 'no') — it is NOT verified and migrated. Weaker hashes are handled through a deliberate migration, not by accepting them in the parser. (The legacy bare-hex paths below — single SHA-256 and round-2 PBKDF2 at 100,000 iterations — are the only migration paths, and both are above this floor.)
const MAX_PBKDF2_ITERATIONS = 1000000; // cap on a stored iteration count: a corrupted or tampered value above this is rejected, so a huge count can never cause excessive computation (DoS).
const SALT_BYTES = 16; // 128-bit random salt per PIN
const SALT_HEX_LEN = SALT_BYTES * 2; // 32 hex chars
const HASH_HEX_LEN = 64; // 256-bit PBKDF2 output, 64 hex chars
const PIN_RE = /^\d{4}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/** Legacy scheme (pre-audit): one SHA-256(pin + user.id). Migration only. */
async function legacyHashPin(pin: string, userId: string): Promise<string> {
  return sha256Hex(pin + userId);
}

/** PBKDF2-HMAC-SHA256 with an explicit salt and iteration count. */
async function pbkdf2Hex(
  pin: string,
  userId: string,
  pepper: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin + userId + pepper),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** New PIN hash: a fresh random salt per PIN, stored in a modular format. */
async function hashPinNew(pin: string, userId: string, pepper: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2Hex(pin, userId, pepper, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
}

/** Round-2 PBKDF2: 100,000 iterations, salt = user id, bare hex. Migration only. */
async function hashPinOldPbkdf2(pin: string, userId: string, pepper: string): Promise<string> {
  return pbkdf2Hex(pin, userId, pepper, new TextEncoder().encode(userId), 100000);
}

// Fails closed: a missing pepper is a configuration error, not a reason to
// silently verify PINs against the weak legacy hash.
function getPepper(): string {
  const pepper = Deno.env.get('PIN_PEPPER');
  if (!pepper) {
    console.error('[manage-pin] SECURITY: PIN_PEPPER is not set. Refusing to verify or set any PIN.');
    throw new Error('PIN verification is not configured. Set PIN_PEPPER and try again.');
  }
  return pepper;
}

type Supa = ReturnType<typeof createClient>;

async function getAttemptRow(supabase: Supa, userId: string) {
  const { data, error } = await supabase
    .from('pin_attempts')
    .select('attempts, locked_until')
    .eq('user_id', userId)
    .maybeSingle();
  // Fail closed: if the lockout state cannot be read, do not verify the PIN.
  if (error) throw new Error('Could not check PIN lockout. Try again.');
  return data as { attempts: number; locked_until: string | null } | null;
}

/** Returns the lock expiry ISO string while the user is locked, else null. */
async function lockedUntil(supabase: Supa, userId: string): Promise<string | null> {
  const row = await getAttemptRow(supabase, userId);
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return row.locked_until;
  }
  return null;
}

// Records one failed attempt atomically (record_pin_attempt RPC). Throws on
// any database error, so a failed write can never silently skip the lockout.
async function recordFailedAttempt(supabase: Supa, userId: string) {
  const { data, error } = await supabase.rpc('record_pin_attempt', { p_user_id: userId });
  if (error || !data) {
    throw new Error('Could not record PIN attempt. Try again.');
  }
  const { attempts, locked_until: locked } = data as { attempts: number; locked_until: string | null };
  if (locked) console.error(`[manage-pin] PIN locked for user ${userId} after ${attempts} failed attempts`);
  return { attempts, locked };
}

async function clearAttempts(supabase: Supa, userId: string) {
  const { error } = await supabase.from('pin_attempts').delete().eq('user_id', userId);
  // Checked, not ignored. A failed clear is fail-safe (it can only make a
  // future lockout stricter, never looser), so it is logged loudly rather
  // than breaking a correct PIN entry.
  if (error) console.error('[manage-pin] could not clear PIN attempts:', error.message);
}

/** Constant-time string comparison (for PIN hashes). Ordinary === returns
 * false on the first differing character, leaking timing information about
 * the hash. This compares every byte and only then reports the result. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Checks a PIN against the stored hash. Returns 'ok' (current modular
 * format), 'legacy' (an old format — caller must re-hash), or 'no'.
 */
async function checkPin(
  pin: string,
  userId: string,
  storedHash: string,
  pepper: string,
): Promise<'ok' | 'legacy' | 'no'> {
  // Current format: pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>. The
  // stored iteration count and salt are used, so a future upgrade (higher
  // iterations, new algorithm) is detected here and migrated on success.
  // Salt and hash must be valid hex of the expected lengths — a malformed
  // stored value is rejected rather than trusted. The iteration count is
  // bounded BOTH ways: below the minimum it is rejected outright (a hash
  // with only a handful of iterations must not verify — weaker hashes are
  // handled through a deliberate migration, not by accepting them here),
  // and above the maximum it is rejected so it can never force an
  // excessive PBKDF2 computation.
  if (storedHash.startsWith('pbkdf2-sha256$')) {
    const parts = storedHash.split('$');
    if (parts.length === 4) {
      const iterations = Number(parts[1]);
      const saltHex = parts[2];
      const expected = parts[3];
      const isHex = (s: string, len: number) => s.length === len && /^[0-9a-f]+$/i.test(s);
      if (
        Number.isSafeInteger(iterations) &&
        iterations >= MIN_PBKDF2_ITERATIONS &&
        iterations <= MAX_PBKDF2_ITERATIONS &&
        isHex(saltHex, SALT_HEX_LEN) &&
        isHex(expected, HASH_HEX_LEN)
      ) {
        const salt = hexToBytes(saltHex);
        const computed = await pbkdf2Hex(pin, userId, pepper, salt, iterations);
        if (constantTimeEqual(computed, expected)) return 'ok';
      }
    }
    return 'no';
  }
  // Bare hex: the legacy single SHA-256, or the round-2 PBKDF2 (100,000
  // iterations, salt = user id). Either match means "migrate this PIN".
  if (constantTimeEqual(await legacyHashPin(pin, userId), storedHash)) return 'legacy';
  if (constantTimeEqual(await hashPinOldPbkdf2(pin, userId, pepper), storedHash)) return 'legacy';
  return 'no';
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Only POST is accepted.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Authenticate Request — auth failures are 401, not 400.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: 'Unauthorized access' }, 401);

    // 2. Parse Payload
    const { action, pin, currentPin } = await req.json();
    if (!action || !pin) throw new Error('Action and PIN are required');

    // PIN_PEPPER is required; getPepper throws (fail closed) when it is unset.
    const pepper = getPepper();

    // Serialize PIN verification per user. The atomic attempt counter alone
    // does not stop concurrent requests: several requests arriving together
    // all read the same unlocked state, all verify different PIN guesses,
    // and only afterwards record their failures — so more than five guesses
    // can slip through before the lockout takes effect. This lock is held
    // across the whole verification (lockout check + PIN check + attempt
    // recording), so only one request per user verifies a PIN at a time. A
    // second concurrent request gets a 429 and retries. The lock expires
    // after 2 minutes on its own, so a crashed function can never leave a
    // user locked out forever. A lock-acquisition database failure is a 503
    // (fail closed), not an open door.
    const verificationToken = crypto.randomUUID();
    const { data: lockAcquired, error: lockError } = await supabase.rpc('acquire_pin_verification_lock', {
      p_user_id: user.id,
      p_token: verificationToken,
    });
    if (lockError) {
      console.error('[manage-pin] PIN lock acquisition failed:', lockError);
      return json({ error: 'Unable to verify PIN. Try again shortly.' }, 503);
    }
    if (lockAcquired !== true) {
      return json({ error: 'Another PIN verification is in progress. Try again.' }, 429);
    }

    try {
    // 3. Handle SET or VERIFY
    if (action === 'set') {
      if (!PIN_RE.test(String(pin))) {
        return json({ error: 'PIN must be 4 digits' }, 400);
      }
      const { data: wallet, error: walletError } = await supabase
        .from('wallets')
        .select('pin_hash')
        .eq('user_id', user.id)
        .maybeSingle();
      if (walletError) throw walletError;
      if (!wallet) throw new Error('Wallet not found');

      // A PIN already exists: the current PIN must be proven first, so a
      // stolen session alone cannot silently replace the PIN.
      if (wallet.pin_hash) {
        if (!currentPin) {
          return json({ error: 'Enter your current PIN to change it' }, 400);
        }
        const lock = await lockedUntil(supabase, user.id);
        if (lock) {
          return json({ error: `Too many incorrect attempts. Try again after ${LOCK_MINUTES} minutes.` }, 429);
        }
        const current = await checkPin(String(currentPin), user.id, wallet.pin_hash, pepper);
        if (current === 'no') {
          const { locked } = await recordFailedAttempt(supabase, user.id);
          if (locked) {
            return json({ error: `Too many incorrect attempts. Try again after ${LOCK_MINUTES} minutes.` }, 429);
          }
          return json({ error: 'Current PIN is incorrect' }, 400);
        }
        await clearAttempts(supabase, user.id);
      }

      const hashedPin = await hashPinNew(String(pin), user.id, pepper);
      // Conditional update on the OLD pin_hash: if another PIN change landed
      // between our read and this write, zero rows match and we refuse
      // instead of silently overwriting the newer PIN. A first-time set is
      // conditional on pin_hash still being NULL, so two simultaneous
      // first-time creations cannot both win — only one succeeds.
      const updateQuery = supabase
        .from('wallets')
        .update({ pin_hash: hashedPin, pin_set: true })
        .eq('user_id', user.id);
      const { data: updated, error } = wallet.pin_hash
        ? await updateQuery.eq('pin_hash', wallet.pin_hash).select('id')
        : await updateQuery.is('pin_hash', null).select('id');
      if (error) throw error;
      if (!updated || updated.length === 0) {
        return json({ error: 'Your PIN was changed just now. Enter your current PIN and try again.' }, 409);
      }
      return json({ success: true });
    } else if (action === 'verify') {
      const { data: wallet, error } = await supabase
        .from('wallets')
        .select('pin_hash')
        .eq('user_id', user.id)
        .single();
      if (error || !wallet) throw new Error('Wallet not found');
      if (!wallet.pin_hash) {
        return json({ error: 'No PIN set. Create one first.' }, 400);
      }

      const lock = await lockedUntil(supabase, user.id);
      if (lock) {
        return json({ error: `Too many incorrect attempts. Try again after ${LOCK_MINUTES} minutes.` }, 429);
      }

      const result = await checkPin(String(pin), user.id, wallet.pin_hash, pepper);
      if (result === 'no') {
        const { locked } = await recordFailedAttempt(supabase, user.id);
        if (locked) {
          return json({ error: `Too many incorrect attempts. Try again after ${LOCK_MINUTES} minutes.` }, 429);
        }
        return json({ error: 'Incorrect PIN' }, 400);
      }

      // Old format matched: migrate this PIN to the new format now, so the
      // old hash stops working after one successful verify. Conditional on
      // the old hash, so a concurrent PIN change is not overwritten.
      if (result === 'legacy') {
        const upgraded = await hashPinNew(String(pin), user.id, pepper);
        const { data: migrated, error: upgradeError } = await supabase
          .from('wallets')
          .update({ pin_hash: upgraded })
          .eq('user_id', user.id)
          .eq('pin_hash', wallet.pin_hash)
          .select('id');
        if (upgradeError) console.error('[manage-pin] could not migrate legacy PIN hash:', upgradeError.message);
        else if (!migrated || migrated.length === 0) console.error('[manage-pin] PIN changed during legacy migration; kept the newer PIN');
      }
      await clearAttempts(supabase, user.id);
      return json({ success: true, isValid: true });
    } else {
      throw new Error('Invalid action');
    }
    } finally {
      // Always release the lock, even when the verification throws — a
      // leaked lock would block the user for up to 2 minutes (the expiry).
      const { error: releaseError } = await supabase.rpc('release_pin_verification_lock', {
        p_user_id: user.id,
        p_token: verificationToken,
      });
      if (releaseError) console.error('[manage-pin] PIN lock release failed:', releaseError);
    }
  } catch (error: any) {
    // Internal errors (configuration, database) are 500s, not 400s: a
    // client error is something the caller did wrong (bad PIN, bad input);
    // a missing PIN_PEPPER secret or a failed database read is the
    // server's problem, and returning 400 for it would hide the cause.
    // Internal errors return a GENERIC message — raw database errors must
    // never be exposed to clients (they leak schema and implementation
    // details). The real error is logged server-side above.
    const msg = String(error?.message ?? 'Unknown error');
    const isInternal =
      msg.includes('PIN_PEPPER') ||
      msg.includes('PIN verification is not configured') ||
      msg.includes('Could not check PIN lockout') ||
      msg.includes('Could not record PIN attempt') ||
      msg.includes('Wallet not found') ||
      error?.code !== undefined; // a Supabase/Postgrest error object
    if (isInternal) console.error('[manage-pin] internal error:', msg);
    return json(
      { error: isInternal ? 'Unable to process PIN request. Try again shortly.' : msg },
      isInternal ? 500 : 400,
    );
  }
});
