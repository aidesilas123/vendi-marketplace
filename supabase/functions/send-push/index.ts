// Supabase Edge Function: send-push
// Deploy: Dashboard -> Edge Functions -> New Function -> name `send-push` -> paste -> Deploy.
// Secret needed: FIREBASE_SERVICE_ACCOUNT = full contents of the Firebase service-account JSON.
//
// POST { user_id, type?, title, body?, route?, data? }
//   type  -> bucket for the in-app center: chat | question | order | wallet | review | verification | dispute
//   route -> deep link the app opens on tap, e.g. "/order?ref=abc", "/questions"
// Writes the in-app notification row, then sends via FCM HTTP v1 to every
// token in user_push_tokens, then deletes dead tokens.
//
// AUTH (C4): this function used to accept any user_id/title/body/route from
// anyone on the internet — a ready-made phishing channel in Vendi's name.
// Now: a call is allowed EITHER with the service-role key (internal
// server-to-server callers: the monnify-webhook) OR with a valid user JWT
// that is authorised for the exact push being sent — the caller must be a
// party to the chat/order, the reviewer/asker (never the recipient), or the
// wallet owner themself. verification / dispute / announcement pushes are
// service-role only. Unknown types are rejected. Title/body are capped.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TITLE_MAX = 100;
const BODY_MAX = 300;

const b64url = (bytes: Uint8Array | string) => {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// OAuth2 access token from the service-account JSON (no external deps).
async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('OAuth failed: ' + JSON.stringify(json));
  return json.access_token;
}

/** The transaction ref from a route like "/chats?ref=ESC-...&seller=...". */
function refFromRoute(route: string): string | null {
  try {
    return new URL(route, 'https://vendi.local').searchParams.get('ref');
  } catch {
    return null;
  }
}

class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { user_id, type, title, body, route, data } = await req.json();
    if (!user_id || !title) return Response.json({ error: 'user_id and title required' }, { status: 400 });

    const sa = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || 'null');
    if (!sa?.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT secret missing');

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // --- Authorisation -------------------------------------------------
    // Service-role key (exact equality) = an internal server caller.
    // Anything else must be a valid user JWT, authorised per type below.
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const isInternal = token !== '' && serviceRoleKey !== '' && token === serviceRoleKey;
    if (!isInternal) {
      if (!token) return Response.json({ error: 'Missing Authorization header' }, { status: 401 });
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) return Response.json({ error: 'Unauthorized access' }, { status: 401 });
      const callerId = user.id;
      const recipientId = String(user_id);
      const dataObj = (data ?? {}) as Record<string, unknown>;
      const routeStr = String(route ?? '');

      const requireTxParties = async (ref: string | null) => {
        if (!ref) throw new AuthzError('A transaction reference is required for this notification', 400);
        // Admin threads use a bare-UUID ref: the admin_threads row id
        // (created by get_or_create_admin_thread; the old synthetic
        // admin-<adminId>-<userId> refs are gone). A deal ref is never a
        // bare UUID (ESC-/MON-/VENDI-/REF-/REL- prefixed), so a UUID-shaped
        // ref can only be a thread — check it first, fall through to the
        // transaction lookup otherwise.
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
          const { data: thread } = await supabase
            .from('admin_threads')
            .select('admin_id, user_id')
            .eq('id', ref)
            .maybeSingle();
          if (thread) {
            if (callerId !== thread.admin_id && callerId !== thread.user_id) {
              throw new AuthzError('You are not part of this chat');
            }
            const other = callerId === thread.admin_id ? thread.user_id : thread.admin_id;
            if (recipientId !== other) throw new AuthzError('Recipient is not the other party to this chat');
            if (recipientId === callerId) throw new AuthzError('Cannot notify yourself');
            return;
          }
        }
        const { data: tx } = await supabase
          .from('transactions')
          .select('user_id, seller_id')
          .eq('reference', ref)
          .maybeSingle();
        if (!tx) throw new AuthzError('Transaction not found', 404);
        if (callerId !== tx.user_id && callerId !== tx.seller_id) {
          throw new AuthzError('You are not part of this transaction');
        }
        const other = callerId === tx.user_id ? tx.seller_id : tx.user_id;
        if (recipientId !== other) throw new AuthzError('Recipient is not the other party to this transaction');
      };

      const requireProductSellerRecipient = async (productId: string | null) => {
        if (!productId) throw new AuthzError('A product id is required for this notification', 400);
        const { data: product } = await supabase
          .from('products')
          .select('seller_id')
          .eq('id', productId)
          .maybeSingle();
        if (!product) throw new AuthzError('Listing not found', 404);
        if (recipientId !== product.seller_id) throw new AuthzError('Recipient is not the seller of this listing');
        if (callerId === recipientId) throw new AuthzError('Cannot notify yourself');
      };

      switch (type) {
        case 'chat': {
          const ref = String(dataObj.transaction_ref ?? dataObj.reference ?? refFromRoute(routeStr) ?? '');
          await requireTxParties(ref || null);
          if (!routeStr.startsWith(`/chats?ref=${ref}`)) {
            throw new AuthzError('Chat notifications must link to the same transaction');
          }
          break;
        }
        case 'question': {
          // 'question' is used in BOTH directions: a new question notifies
          // the seller, and a reply notifies the original asker. So:
          //  - recipient is the seller -> the caller is the asker (never self).
          //  - otherwise (a reply) -> both caller and recipient must be
          //    real participants in this listing's Q&A (the caller is the
          //    seller or has asked/answered there; the recipient has asked
          //    there). A stranger can never push to an arbitrary user.
          const productId = String(dataObj.product_id ?? '');
          if (!productId) throw new AuthzError('A product id is required for this notification', 400);
          const { data: product } = await supabase
            .from('products')
            .select('seller_id')
            .eq('id', productId)
            .maybeSingle();
          if (!product) throw new AuthzError('Listing not found', 404);
          if (callerId === recipientId) throw new AuthzError('Cannot notify yourself');
          if (recipientId === product.seller_id) break;
          const [{ data: callerRows }, { data: recipientRows }] = await Promise.all([
            supabase.from('product_reviews').select('id').eq('product_id', productId).eq('user_id', callerId).limit(1),
            supabase.from('product_reviews').select('id').eq('product_id', productId).eq('user_id', recipientId).limit(1),
          ]);
          const callerIsParticipant = callerId === product.seller_id || (callerRows && callerRows.length > 0);
          const recipientIsParticipant = recipientRows && recipientRows.length > 0;
          if (!callerIsParticipant || !recipientIsParticipant) {
            throw new AuthzError('Both parties must be part of this listing’s Q&A');
          }
          break;
        }
        case 'review': {
          await requireProductSellerRecipient(String(dataObj.product_id ?? ''));
          break;
        }
        case 'order': {
          const ref = String(dataObj.transaction_ref ?? dataObj.reference ?? refFromRoute(routeStr) ?? '');
          await requireTxParties(ref || null);
          break;
        }
        case 'wallet': {
          if (recipientId !== callerId) throw new AuthzError('Wallet notifications can only go to yourself');
          break;
        }
        case 'verification':
        case 'dispute':
        case 'announcement':
          // Server-side only — a user JWT can never send these.
          throw new AuthzError('This notification type is server-only', 403);
        default:
          throw new AuthzError('Unknown notification type', 400);
      }
    }

    // Caps: over-long titles/bodies are truncated, never rejected — a
    // notification must not break the feature that triggered it.
    const safeTitle = String(title).slice(0, TITLE_MAX);
    const safeBody = String(body ?? '').slice(0, BODY_MAX);

    const stringData: Record<string, string> = { route: route ?? '' };
    for (const [k, v] of Object.entries(data ?? {})) stringData[k] = String(v);

    // 0. Preferences: the bell row is always written (it's their history);
    //    the FCM push is skipped when the master switch or this type is off.
    //    Missing row = everything on.
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('master, chat, question, "order", wallet, review, verification, dispute, announcement')
      .eq('user_id', user_id)
      .maybeSingle();
    const pushAllowed =
      prefs?.master !== false && (type ? (prefs as any)?.[type] !== false : true);

    // 1. In-app notification row (bell center). Always written, even with no push tokens.
    await supabase.from('notifications').insert({
      user_id,
      type: type ?? 'general',
      title: safeTitle,
      body: safeBody,
      route: route ?? '',
      data: stringData,
    });

    if (!pushAllowed) return Response.json({ sent: 0, reason: 'disabled by preferences', stored: true });

    // 2. Push via FCM.
    const { data: tokens } = await supabase.from('user_push_tokens').select('token').eq('user_id', user_id);
    if (!tokens?.length) return Response.json({ sent: 0, reason: 'no tokens', stored: true });

    const accessToken = await getAccessToken(sa);
    let sent = 0;
    const dead: string[] = [];
    for (const { token } of tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { token, notification: { title: safeTitle, body: safeBody }, data: stringData },
        }),
      });
      if (res.ok) {
        sent++;
      } else {
        const err = await res.text();
        if (err.includes('UNREGISTERED') || err.includes('INVALID_ARGUMENT')) dead.push(token);
      }
    }
    if (dead.length) await supabase.from('user_push_tokens').delete().in('token', dead);
    return Response.json({ sent, cleaned: dead.length, stored: true });
  } catch (e: any) {
    if (e instanceof AuthzError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
