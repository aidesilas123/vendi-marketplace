// src/lib/localCache.ts
//
// Phase 2 local cache (WhatsApp-style, device-first).
//
// Inbox + chat history + partner profiles + the failed-message outbox live
// in IndexedDB on the device, so a room/inbox opens instantly from disk —
// even offline, even after the app was closed — and the network only syncs
// fresh data in the background. No new dependency: raw IndexedDB behind a
// small promise wrapper.
//
// Every function here never throws: on any IndexedDB error (unavailable,
// blocked, full, slow) it returns null/false and the caller falls back to
// the network, so a cache failure can never break the app. Reads/writes
// are capped (200 messages per room, 10 failed outbox entries per room)
// so the cache can't grow without bound.

const DB_NAME = 'vendi-cache';
const DB_VERSION = 1;
const CACHE_CAP_MESSAGES = 200;
const CACHE_CAP_OUTBOX = 10;
// A local read should be ~10ms; if it ever hangs, fall back to the network
// instead of blocking the room on a stuck disk.
const IDB_TIMEOUT_MS = 5000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'ref' });
        if (!db.objectStoreNames.contains('partners')) db.createObjectStore('partners', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'userId' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    } catch (err) {
      reject(err);
    }
  });
  // A failed open must not poison later calls (e.g. transient block).
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error('IndexedDB timeout')), IDB_TIMEOUT_MS)
    ),
  ]);
}

function idbGet(store: string, key: string): Promise<any> {
  return withTimeout(
    openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          try {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error || new Error('get failed'));
          } catch (err) {
            reject(err);
          }
        })
    )
  );
}

function idbPut(store: string, value: any): Promise<void> {
  return withTimeout(
    openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          try {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(value);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error || new Error('put failed'));
          } catch (err) {
            reject(err);
          }
        })
    )
  );
}

function idbDelete(store: string, key: string): Promise<void> {
  return withTimeout(
    openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          try {
            const tx = db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error || new Error('delete failed'));
          } catch (err) {
            reject(err);
          }
        })
    )
  );
}

function idbGetAll(store: string): Promise<any[]> {
  return withTimeout(
    openDB().then(
      (db) =>
        new Promise<any[]>((resolve, reject) => {
          try {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => resolve((req.result ?? []) as any[]);
            req.onerror = () => reject(req.error || new Error('getAll failed'));
          } catch (err) {
            reject(err);
          }
        })
    )
  );
}

/* ── Messages (per conversation, per user) ─────────────────────────────
 * Keyed by {userId, ref}: a bare `ref` key would hand one account's
 * cached history to the next account on a shared device (M4). Rows
 * written before this change live under the bare ref and are never
 * read again once a userId is passed. */

function messageKey(userId: string | null | undefined, ref: string): string {
  return userId ? `${userId}:${ref}` : ref;
}

export async function getCachedMessages(ref: string, userId?: string | null): Promise<any[] | null> {
  try {
    if (!ref) return null;
    const row = await idbGet('messages', messageKey(userId, ref));
    const list = row?.list;
    return Array.isArray(list) && list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

export async function putCachedMessages(ref: string, list: any[], userId?: string | null): Promise<void> {
  try {
    if (!ref || !Array.isArray(list) || list.length === 0) return;
    // Keep only the latest messages (oldest first, as stored by the room).
    const capped = list.slice(-CACHE_CAP_MESSAGES);
    await idbPut('messages', { ref: messageKey(userId, ref), list: capped, updatedAt: Date.now() });
  } catch {
    // Cache write failure is silent — the network is the fallback.
  }
}

/** Delete the whole local cache database (sign-out). Never throws. */
export async function clearAllCache(): Promise<void> {
  try {
    dbPromise = null;
    if (typeof indexedDB === 'undefined') return;
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch {
    // ignore — sign-out must never fail on a cache clear
  }
}

/* ── Partner profiles ───────────────────────────────────────────────── */

export async function getCachedPartner(id: string): Promise<any | null> {
  try {
    if (!id) return null;
    const row = await idbGet('partners', id);
    return row?.data ?? null;
  } catch {
    return null;
  }
}

export async function putCachedPartner(id: string, data: any): Promise<void> {
  try {
    if (!id || !data) return;
    await idbPut('partners', { id, data, updatedAt: Date.now() });
  } catch {}
}

/* ── Inbox (per user) ───────────────────────────────────────────────── */

export async function getCachedInbox(userId: string): Promise<any[] | null> {
  try {
    if (!userId) return null;
    const row = await idbGet('inbox', userId);
    const list = row?.list;
    return Array.isArray(list) && list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

export async function putCachedInbox(userId: string, list: any[]): Promise<void> {
  try {
    if (!userId || !Array.isArray(list)) return;
    await idbPut('inbox', { userId, list, updatedAt: Date.now() });
  } catch {}
}

export async function markCachedInboxAsRead(userId: string, txRef: string): Promise<void> {
  try {
    if (!userId || !txRef) return;
    const list = await getCachedInbox(userId);
    if (!list) return;
    let changed = false;
    for (const item of list) {
      if (item.transaction_ref === txRef) {
        if (item.unreadCount > 0) {
          item.unreadCount = 0;
          changed = true;
        }
        if (item.latestMessage && item.latestMessage.status !== 'read') {
          item.latestMessage.status = 'read';
          changed = true;
        }
      }
    }
    if (changed) {
      await putCachedInbox(userId, list);
    }
  } catch {}
}

export async function updateCachedInboxLatestMessage(userId: string, txRef: string, latestMsg: any): Promise<void> {
  try {
    if (!userId || !txRef || !latestMsg) return;
    const list = await getCachedInbox(userId);
    if (!list) return;
    const item = list.find((i: any) => i.transaction_ref === txRef);
    if (item) {
      item.latestMessage = latestMsg;
      if (latestMsg.receiver_id === userId && latestMsg.status !== 'read') {
        item.unreadCount = (item.unreadCount || 0) + 1;
      }
      await putCachedInbox(userId, list);
    }
  } catch {}
}

/* ── Outbox (failed messages, for Retry after a restart) ──────────────
 * Only failed messages are persisted: a sending message either lands on
 * the server (and shows up as a real message on reopen) or fails (and is
 * then saved here as failed). _localBlob (voice) is stored as a Blob —
 * IndexedDB holds Blobs natively — and _localDataUri (photo/video) as a
 * string, so a retry can re-upload after a restart.
 */

export async function getOutbox(txRef: string): Promise<any[]> {
  try {
    if (!txRef) return [];
    const all = await idbGetAll('outbox');
    return all
      .filter((row) => row?.txRef === txRef && row?.msg)
      .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
      .map((row) => row.msg);
  } catch {
    return [];
  }
}

export async function putOutbox(txRef: string, msg: any): Promise<void> {
  try {
    if (!txRef || !msg?.id) return;
    await idbPut('outbox', { id: msg.id, txRef, msg, updatedAt: Date.now() });
    // Cap per room so a run of failures can't bloat storage: drop the oldest.
    const rows = await getOutbox(txRef);
    if (rows.length > CACHE_CAP_OUTBOX) {
      const excess = rows.slice(0, rows.length - CACHE_CAP_OUTBOX);
      for (const old of excess) {
        try { await idbDelete('outbox', old.id); } catch {}
      }
    }
  } catch {}
}

export async function deleteOutbox(id: string): Promise<void> {
  try {
    if (!id) return;
    await idbDelete('outbox', id);
  } catch {}
}
