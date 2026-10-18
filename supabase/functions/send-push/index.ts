// Supabase Edge Function: send-push
// Deploy: Dashboard -> Edge Functions -> New Function -> name `send-push` -> paste -> Deploy.
// Secret needed: FIREBASE_SERVICE_ACCOUNT = full contents of the Firebase service-account JSON.
//
// POST { user_id, type?, title, body?, route?, data? }
//   type  -> bucket for the in-app center: chat | question | order | wallet | review | verification | dispute
//   route -> deep link the app opens on tap, e.g. "/order?ref=abc", "/questions"
// Writes the in-app notification row, then sends via FCM HTTP v1 to every
// token in user_push_tokens, then deletes dead tokens.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { user_id, type, title, body, route, data } = await req.json();
    if (!user_id || !title) return Response.json({ error: 'user_id and title required' }, { status: 400 });

    const sa = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || 'null');
    if (!sa?.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT secret missing');

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

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
      title,
      body: body ?? '',
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
          message: { token, notification: { title, body: body ?? '' }, data: stringData },
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
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
