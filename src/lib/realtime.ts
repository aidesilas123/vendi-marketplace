// src/lib/realtime.ts
//
// Single-owner Supabase Realtime plumbing.
//
// Two rules this file enforces (both were being violated):
//  1. ONE owner per topic. `supabase.channel(topic)` returns the SAME object for the
//     same topic everywhere, and calling `.on()` after `.subscribe()` throws
//     ("cannot add presence callbacks after subscribe()"). `ensureChannel` creates,
//     wires and subscribes a topic exactly once; everyone else reuses it.
//  2. Never `.send()` on a channel that was never `.subscribe()`d. Unsubscribed sends
//     fall back to a deprecated REST endpoint (console spam + extra latency).
//     `broadcastTo` always sends over a real subscription.

import { supabase } from '@/lib/supabase';

interface ChannelEntry {
  ch: any;
  ready: Promise<void>;
}

const channels = new Map<string, ChannelEntry>();
const SUBSCRIBE_TIMEOUT_MS = 4000;

function subscribeWithTimeout(ch: any): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    try {
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') finish();
      });
    } catch {
      finish();
      return;
    }
    setTimeout(finish, SUBSCRIBE_TIMEOUT_MS);
  });
}

/**
 * Get the single shared channel for `topic`, creating + subscribing it on first use.
 * `setup` runs ONCE, before subscribe — register `.on()` handlers there.
 * `channelOptions` (e.g. presence key) only apply on creation.
 * If something outside this helper already owns+joined the topic, it is reused
 * untouched (no double setup, no double subscribe).
 */
export function ensureChannel(topic: string, setup?: (ch: any) => void, channelOptions?: any): any {
  const existing = channels.get(topic);
  if (existing) return existing.ch;
  const ch = channelOptions ? supabase.channel(topic, channelOptions) : supabase.channel(topic);
  const state = (ch as any)?.state;
  if (state === 'joined' || state === 'joining') {
    channels.set(topic, { ch, ready: Promise.resolve() });
    return ch;
  }
  try {
    setup?.(ch);
  } catch (err) {
    console.warn('[realtime] setup failed for', topic, err);
  }
  const entry: ChannelEntry = { ch, ready: subscribeWithTimeout(ch) };
  channels.set(topic, entry);
  return ch;
}

/** Tear down a helper-owned channel (removes it from Supabase AND the local cache). */
export function dropChannel(topic: string) {
  const entry = channels.get(topic);
  if (!entry) return;
  channels.delete(topic);
  try {
    void supabase.removeChannel(entry.ch);
  } catch {}
}

/** Broadcast on a topic over a real subscription (never the REST fallback). */
export async function broadcastTo(topic: string, event: string, payload: any): Promise<void> {
  try {
    if (!channels.has(topic)) ensureChannel(topic);
    const entry = channels.get(topic)!;
    await entry.ready;
    const res: any = await entry.ch.send({ type: 'broadcast', event, payload });
    if (res !== 'ok') console.warn('[realtime] broadcastTo returned', res, 'for', topic, event);
  } catch (err) {
    console.warn('[realtime] broadcastTo failed:', topic, event, err);
  }
}

/* ── Global presence — single owner is AppShell ─────────────────────────── */

const PRESENCE_TOPIC = 'global_presence';

export interface PresenceInfo {
  isOnline: boolean;
  lastSeen: string | null;
}

const onlineIds = new Map<string, string>(); // userId -> online_at
const lastSeenAt = new Map<string, string>(); // userId -> ISO timestamp
const presenceListeners = new Set<() => void>();
let presenceOwner: string | null = null;

function emitPresence() {
  presenceListeners.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
}

function setupPresenceHandlers(ch: any) {
  ch.on('presence', { event: 'sync' }, () => {
    try {
      const state = ch.presenceState() || {};
      const seen = new Set(Object.keys(state));
      onlineIds.forEach((_v, id) => {
        if (!seen.has(id)) {
          if (!lastSeenAt.has(id)) lastSeenAt.set(id, new Date().toISOString());
          onlineIds.delete(id);
        }
      });
      seen.forEach((id) => {
        const presences = (state as any)[id] || [];
        const onlineAt = presences[0]?.online_at || new Date().toISOString();
        if (!onlineIds.has(id)) lastSeenAt.delete(id);
        onlineIds.set(id, onlineAt);
      });
      emitPresence();
    } catch {}
  });
  ch.on('presence', { event: 'join' }, ({ key, newPresences }: any) => {
    if (!key) return;
    lastSeenAt.delete(key);
    onlineIds.set(key, newPresences?.[0]?.online_at || new Date().toISOString());
    emitPresence();
  });
  ch.on('presence', { event: 'leave' }, ({ key, leftPresences }: any) => {
    if (!key) return;
    onlineIds.delete(key);
    lastSeenAt.set(key, leftPresences?.[0]?.online_at || new Date().toISOString());
    emitPresence();
  });
}

/**
 * Start (or keep) global presence tracking for `userId`.
 * Idempotent — safe to call from AppShell AND chat rooms; first call wins.
 */
export function ensurePresence(userId: string) {
  if (!userId) return;
  if (presenceOwner === userId && channels.has(PRESENCE_TOPIC)) return;
  if (presenceOwner && presenceOwner !== userId) dropPresence();
  presenceOwner = userId;
  const ch = ensureChannel(PRESENCE_TOPIC, setupPresenceHandlers, {
    config: { presence: { key: userId } },
  });
  channels
    .get(PRESENCE_TOPIC)!
    .ready.then(() => {
      try {
        void ch.track({ user_id: userId, online_at: new Date().toISOString() });
      } catch {}
    })
    .catch(() => {});
}

export function dropPresence() {
  presenceOwner = null;
  dropChannel(PRESENCE_TOPIC);
  onlineIds.clear();
  emitPresence();
}

export function getPresence(userId: string | null | undefined): PresenceInfo {
  if (!userId) return { isOnline: false, lastSeen: null };
  return { isOnline: onlineIds.has(userId), lastSeen: lastSeenAt.get(userId) ?? null };
}

export function subscribePresence(cb: () => void): () => void {
  presenceListeners.add(cb);
  return () => {
    presenceListeners.delete(cb);
  };
}
