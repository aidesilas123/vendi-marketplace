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
  ready: Promise<boolean>;
  failed: boolean;
  setup?: (ch: any) => void;
  options?: any;
}

const channels = new Map<string, ChannelEntry>();
// Slow networks need longer to join: a 2G/3G handshake can take 5-10s,
// and a 4s timeout marked the channel dead before it ever had a chance.
const SUBSCRIBE_TIMEOUT_MS = 10000;

function subscribeWithTimeout(ch: any): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    try {
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') finish(true);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') finish(false);
      });
    } catch {
      finish(false);
      return;
    }
    setTimeout(() => finish(false), SUBSCRIBE_TIMEOUT_MS);
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
    // Already joined: ready resolves true (subscribed), matching
    // ChannelEntry.ready: Promise<boolean>. Promise.resolve() would be
    // Promise<void> (a type error) and falsy, so broadcastTo would think
    // the channel wasn't ready and rebuild it for no reason.
    channels.set(topic, { ch, ready: Promise.resolve(true), failed: false });
    return ch;
  }
  try {
    setup?.(ch);
  } catch (err) {
    console.warn('[realtime] setup failed for', topic, err);
  }
  const entry: ChannelEntry = { ch, ready: subscribeWithTimeout(ch), failed: false, setup, options: channelOptions };
  entry.ready.then((ok) => { entry.failed = !ok; }).catch(() => { entry.failed = true; });
  channels.set(topic, entry);
  return ch;
}

/** Drop a dead channel and rebuild it from its stored setup (slow-network recovery). */
export function recreateChannel(topic: string): any | null {
  const entry = channels.get(topic);
  if (!entry) return null;
  dropChannel(topic);
  return ensureChannel(topic, entry.setup, entry.options);
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

/** Broadcast on a topic over a real subscription (never the REST fallback).
 * Retries on a slow/flaky network (2 retries, backoff) and rebuilds a dead
 * channel before retrying, so a single blip doesn't lose the broadcast.
 * Returns true when the send was accepted, false when it never went out. */
export async function broadcastTo(topic: string, event: string, payload: any): Promise<boolean> {
  const delays = [500, 1500];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      if (!channels.has(topic)) ensureChannel(topic);
      let entry = channels.get(topic)!;
      const ok = await entry.ready;
      if (!ok || entry.failed) {
        const rebuilt = recreateChannel(topic);
        if (!rebuilt) return false;
        entry = channels.get(topic)!;
        if (!(await entry.ready)) {
          if (attempt === delays.length) return false;
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
      }
      const res: any = await entry.ch.send({ type: 'broadcast', event, payload });
      if (res === 'ok') return true;
      console.warn('[realtime] broadcastTo returned', res, 'for', topic, event);
    } catch (err) {
      console.warn('[realtime] broadcastTo failed:', topic, event, err);
    }
    if (attempt === delays.length) return false;
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
  return false;
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

/* ── Typing/recording activity — single owner is the realtime registry ──
 * One stable channel per user (`inbox_activity_${userId}`), created once
 * via ensureChannel and never removed by page cleanups. This is the
 * /messages mechanism: it works on phone and web because the channel is
 * created once per login (not per room), lives as long as the app, and
 * the sender uses broadcastTo (subscribe-then-send + retry) on the same
 * topic. The old /chats path listened on the per-room channel instead:
 * that channel is torn down and rebuilt on every room entry, so on a
 * slow phone network the subscribe handshake was still in flight (or
 * the channel had errored) when the partner typed, and the 2.5s
 * watchdog cleared the indicator after a single lost broadcast.
 * Both /messages (per-conversation map) and /chats (current room) read
 * from this one channel via subscribeActivity. */

export type ActivityValue = 'typing' | 'recording' | null;
export type ActivityListener = (
  txRef: string,
  userId: string | null,
  activity: ActivityValue
) => void;

const activityListeners = new Set<ActivityListener>();
const activityWiredTopics = new Set<string>();
let activityOwner: string | null = null;

export function ensureActivityChannel(userId: string): void {
  if (!userId) return;
  if (activityOwner === userId) return;
  if (activityOwner && activityOwner !== userId) {
    dropChannel(`inbox_activity_${activityOwner}`);
    activityWiredTopics.delete(`inbox_activity_${activityOwner}`);
  }
  activityOwner = userId;
  const topic = `inbox_activity_${userId}`;
  // ensureChannel subscribes the topic (once); the broadcast handler is
  // attached here, not in setup, so it also lands when the channel was
  // already joined by someone else — broadcast .on() is exempt from the
  // "cannot add callbacks after subscribe()" throw.
  const ch = ensureChannel(topic);
  if (!activityWiredTopics.has(topic)) {
    activityWiredTopics.add(topic);
    ch.on('broadcast', { event: 'user_activity' }, (payload: any) => {
      const { txRef, userId: senderId, activity } = payload?.payload || {};
      if (!txRef) return;
      activityListeners.forEach((cb) => {
        try {
          cb(txRef, senderId ?? null, activity ?? null);
        } catch {}
      });
    });
  }
}

export function subscribeActivity(cb: ActivityListener): () => void {
  activityListeners.add(cb);
  return () => {
    activityListeners.delete(cb);
  };
}
