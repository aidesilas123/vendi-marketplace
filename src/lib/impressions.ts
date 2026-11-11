// src/lib/impressions.ts

// Scroll-pass (impression) counting for product cards.
//
// A view is recorded when a card stays at least half visible for a short
// dwell — long enough to filter out fast flings, short enough to catch a
// genuine pause. Impressions are batched into a single insert per flush
// (never one request per card), guarded per product per browser session.
// Anonymous views count too (the user's call, 2026-11-11): a logged-out
// viewer is recorded with a NULL viewer_id, exactly as before the H6
// change — anonymous views encourage sellers and make a new
// marketplace look alive.
//
// Impressions live in the same product_views table as opens, distinguished
// by the `kind` column ('impression' vs 'open' — see product-views-kind.sql).
// The feed/product counts (product_views(count)) therefore become
// impressions + opens, which is the new meaning of "views". No query changes
// were needed for that; the later ranking algorithm can split by kind.

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { supabase } from '@/lib/supabase';

// Half the card must be visible...
const IMPRESSION_THRESHOLD = 0.5;
// ...and stay visible this long (ms) before it counts. A fast fling passes a
// card in well under this; a genuine pause clears it.
const IMPRESSION_DWELL_MS = 500;
// Batch window: records are held this long so one insert covers many cards.
const FLUSH_DELAY_MS = 2000;
// Flush immediately once this many records are queued.
const FLUSH_MAX_SIZE = 20;

const queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let listenersAttached = false;

function sessionKey(productId: string) {
  return `impression_${productId}`;
}

function alreadyCounted(productId: string): boolean {
  try {
    return sessionStorage.getItem(sessionKey(productId)) === 'true';
  } catch {
    return false;
  }
}

function markCounted(productId: string) {
  try {
    sessionStorage.setItem(sessionKey(productId), 'true');
  } catch {
    // Storage unavailable: the card observer disconnects after firing, so at
    // worst this product is counted once more on a later mount.
  }
}

async function flush() {
  flushTimer = null;
  if (flushing || queued.size === 0) return;
  flushing = true;
  const ids = [...queued];
  queued.clear();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    // Anonymous impressions count too (the user's call, 2026-11-11): a
    // logged-out viewer is recorded with a NULL viewer_id, exactly as
    // before the H6 change. Logged-in views dedupe per (product,
    // viewer, day) in the database; anonymous NULL rows are distinct,
    // so they are never blocked by that dedupe.
    const { error } = await supabase.from('product_views').insert(
      ids.map((product_id) => ({ product_id, viewer_id: user?.id ?? null, kind: 'impression' })),
    );
    if (error) throw error;
    ids.forEach(markCounted);
  } catch (e) {
    // A missed batch is dropped, not retried in a loop. It is NOT marked
    // counted, so a later card mount in this session tries again — which is
    // also what makes impressions start working as soon as the `kind`
    // column exists, if the SQL hasn't been run yet.
    console.warn('[impressions] failed to record batch:', e);
  } finally {
    flushing = false;
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  if (queued.size >= FLUSH_MAX_SIZE) {
    void flush();
    return;
  }
  flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

function attachFlushListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  // Don't lose a queued batch when the user leaves mid-scroll.
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

/** Queue one impression for a product (no-op if already counted this session). */
export function recordImpression(productId: string) {
  if (!productId || alreadyCounted(productId)) return;
  attachFlushListeners();
  queued.add(productId);
  scheduleFlush();
}

/**
 * Observe an element and record an impression once it stays at least half
 * visible for the dwell time. Disconnects after firing (one impression per
 * card mount) and cleans up on unmount. Pass the card's root element ref.
 */
export function useImpressionTracking(
  ref: RefObject<HTMLElement | null>,
  productId: string | undefined,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !productId || alreadyCounted(productId)) return;
    if (typeof IntersectionObserver === 'undefined') return;
    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    const clearDwell = () => {
      if (dwellTimer) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_THRESHOLD) {
          if (!dwellTimer) {
            dwellTimer = setTimeout(() => {
              recordImpression(productId);
              observer.disconnect();
            }, IMPRESSION_DWELL_MS);
          }
        } else {
          clearDwell();
        }
      },
      { threshold: [0, IMPRESSION_THRESHOLD] },
    );
    observer.observe(el);
    return () => {
      clearDwell();
      observer.disconnect();
    };
  }, [ref, productId]);
}
