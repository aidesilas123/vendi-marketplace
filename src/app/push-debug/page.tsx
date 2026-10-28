"use client";
// src/app/push-debug/page.tsx
//
// TEMPORARY DIAGNOSTIC PAGE — delete this file once the missing-token cause
// is found. Open it in the app at /push-debug (see the one-button snippet
// at the bottom of this file for the Settings sound picker).
//
// What it shows — never any token value:
//   - whether a user_push_tokens row exists for the signed-in user
//   - the four diagnostic error keys written by src/lib/push.ts
//   - for each bundled /sounds file: fetch status + audio decode status
//
// How to read it:
//   - upsert_error set      -> the Supabase write failed (its message names it)
//   - push_error set        -> FCM rejected registration on this device
//   - register_error set    -> PushNotifications.register() itself threw
//   - bailed set            -> handler ran but had no user/token value
//   - none set + no row     -> registration never ran, or this build
//                              predates the diagnostic push.ts
//   - sound file 404        -> the file never made it into the APK bundle
//   - sound loads but won't
//     decode                -> the .ogg itself is bad, re-encode it

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Preferences } from '@capacitor/preferences';
import { supabase } from '@/lib/supabase';
import { registerPushToken } from '@/lib/push';

const ERROR_KEYS = ['vendi_push_error', 'vendi_push_upsert_error', 'vendi_push_register_error', 'vendi_push_bailed'] as const;

const SOUND_FILES = [
  'banner_pop.ogg',
  'notification_decorative_01.ogg',
  'notification_decorative_02.ogg',
  'notification_simple_01.ogg',
  'notification_simple_02.ogg',
  'alert_high_intensity.ogg',
  'hero_decorative_celebration_02.ogg',
  'msg_sent_kpo.ogg',
  'message_received.ogg',
];

type SoundStatus = { fetch: string; decode: string };

async function testSound(file: string): Promise<SoundStatus> {
  const src = `/sounds/${file}`;
  let fetchStatus: string;
  try {
    const res = await fetch(src);
    fetchStatus = res.ok ? `HTTP ${res.status}` : `HTTP ${res.status} (missing?)`;
    if (!res.ok) return { fetch: fetchStatus, decode: 'skipped' };
  } catch {
    return { fetch: 'fetch failed', decode: 'skipped' };
  }
  const decode = await new Promise<string>((resolve) => {
    try {
      const audio = new Audio();
      const timer = setTimeout(() => resolve('timeout'), 5000);
      audio.addEventListener('canplaythrough', () => { clearTimeout(timer); resolve('OK'); }, { once: true });
      audio.addEventListener('error', () => { clearTimeout(timer); resolve('DECODE FAILED'); }, { once: true });
      audio.preload = 'auto';
      audio.src = src;
      audio.load();
    } catch {
      resolve('error');
    }
  });
  return { fetch: fetchStatus, decode };
}

export default function PushDebugPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [hasRow, setHasRow] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [sounds, setSounds] = useState<Record<string, SoundStatus>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
      if (user) {
        const { count } = await supabase.from('user_push_tokens').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        setHasRow((count ?? 0) > 0);
      } else {
        setHasRow(null);
      }
    } catch {
      setHasRow(null);
    }
    const next: Record<string, string | null> = {};
    for (const key of ERROR_KEYS) {
      try {
        const { value } = await Preferences.get({ key });
        next[key] = value;
      } catch {
        next[key] = null;
      }
    }
    setErrors(next);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const testAllSounds = useCallback(async () => {
    setBusy(true);
    const next: Record<string, SoundStatus> = {};
    for (const file of SOUND_FILES) {
      next[file] = await testSound(file);
      setSounds({ ...next });
    }
    setBusy(false);
  }, []);

  const reRegister = useCallback(async () => {
    setBusy(true);
    setNote('');
    try {
      await registerPushToken((route) => router.push(route));
      await new Promise((r) => setTimeout(r, 3000));
      await refresh();
      setNote('Re-register done — check the row + error keys above.');
    } catch {
      setNote('Re-register threw — see error keys above.');
    }
    setBusy(false);
  }, [refresh, router]);

  return (
    <div className="px-4 py-6 max-w-xl mx-auto text-gray-900 dark:text-white">
      <h1 className="text-lg font-bold">Push diagnostics (temporary)</h1>
      <p className="text-xs text-gray-500 mt-1">Delete this page once the cause is found. No token value is ever shown here.</p>

      <button onClick={() => router.back()} className="mt-4 text-sm font-bold text-orange-500">← Back</button>

      <h2 className="mt-6 font-bold text-sm">Token row</h2>
      <p className="text-sm mt-1">User: {userId ? `${userId.slice(0, 8)}…` : 'not signed in'}</p>
      <p className="text-sm">Row in user_push_tokens: {hasRow === null ? '?' : hasRow ? 'YES' : 'NO'}</p>
      <div className="flex gap-2 mt-2">
        <button onClick={() => void refresh()} className="px-3 py-2 text-sm font-bold bg-black/5 dark:bg-white/10 !rounded-full">Re-check</button>
        <button onClick={() => void reRegister()} disabled={busy} className="px-3 py-2 text-sm font-bold bg-orange-500 text-white !rounded-full disabled:opacity-50">Re-register token</button>
      </div>
      {note ? <p className="text-sm mt-2 text-gray-500">{note}</p> : null}

      <h2 className="mt-6 font-bold text-sm">Error keys (from src/lib/push.ts)</h2>
      {ERROR_KEYS.map((key) => (
        <p key={key} className="text-[13px] mt-1 break-all"><span className="font-bold">{key}:</span> {errors[key] ?? 'not set'}</p>
      ))}

      <h2 className="mt-6 font-bold text-sm">Bundled sound files</h2>
      <button onClick={() => void testAllSounds()} disabled={busy} className="mt-2 px-3 py-2 text-sm font-bold bg-black/5 dark:bg-white/10 !rounded-full disabled:opacity-50">Test all sounds</button>
      <div className="mt-2">
        {SOUND_FILES.map((file) => (
          <p key={file} className="text-[13px] mt-1 break-all"><span className="font-bold">{file}:</span> {sounds[file] ? `fetch ${sounds[file].fetch} · decode ${sounds[file].decode}` : 'not tested'}</p>
        ))}
      </div>

      <div className="mt-6 text-xs text-gray-500 leading-relaxed">
        <p>How to read it: upsert_error = Supabase write failed (its message names the cause). push_error = FCM rejected registration. register_error = register() threw. bailed = handler ran with no user/token. None set + no row = registration never ran, or this build predates the diagnostic push.ts. Sound 404 = file missing from the APK bundle (commit public/sounds and rebuild). Sound loads but decode fails = bad .ogg, re-encode it.</p>
      </div>
    </div>
  );
}

// One-button entry point — add inside the Settings sound picker modal,
// after the "Applies to new notifications" paragraph:
//   <button onClick={() => router.push('/push-debug')} className="w-full px-4 py-3 text-left text-sm font-bold text-orange-500">Push diagnostics (temporary)</button>
