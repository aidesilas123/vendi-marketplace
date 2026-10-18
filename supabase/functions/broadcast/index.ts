// Supabase Edge Function: broadcast
// Deploy: Dashboard -> Edge Functions -> New Function -> name `broadcast` -> paste -> Deploy.
// New secret: BROADCAST_SECRET = any password you make up (you'll pass it with each send).
// (FIREBASE_SERVICE_ACCOUNT is already set — secrets are shared across functions.)
//
// SEND from the dashboard: Edge Functions -> broadcast -> Invoke, body:
//   { "title": "Hello Vendi", "body": "New feature is live!", "route": "/", "secret": "<BROADCAST_SECRET>" }
//
// Writes a bell row for EVERY user, then pushes to every stored FCM token,
// then deletes dead tokens.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const b64url = (bytes: Uint8Array | string) => {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

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
    const { title, body, route, secret } = await req.json();
    if (!secret || secret !== Deno.env.get('BROADCAST_SECRET')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!title) return Response.json({ error: 'title required' }, { status: 400 });

    const sa = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || 'null');
    if (!sa?.project_id) throw new Error('FIREBASE_SERVICE_ACCOUNT secret missing');

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1. Bell rows for every user (even those who denied push permission).
    const { data: users } = await supabase.from('users').select('id');
    const userIds = (users ?? []).map((u: any) => u.id);
    if (userIds.length) {
      await supabase.from('notifications').insert(
        userIds.map((uid: string) => ({
          user_id: uid,
          type: 'announcement',
          title,
          body: body ?? '',
          route: route ?? '',
          data: {},
        }))
      );
    }

    // 1b. Preferences: skip users who turned off master or announcements
    //     (their bell row above is still written).
    const { data: prefRows } = await supabase
      .from('notification_preferences')
      .select('user_id, master, announcement');
    const blocked = new Set(
      (prefRows ?? [])
        .filter((p: any) => p.master === false || p.announcement === false)
        .map((p: any) => p.user_id)
    );

    // 2. Push to every stored token (50 concurrent at a time),
    //    skipping users who disabled announcements.
    const { data: tokens } = await supabase.from('user_push_tokens').select('token, user_id');
    const list = (tokens ?? []).filter((t: any) => !blocked.has(t.user_id));
    if (!list.length) return Response.json({ sent: 0, users: userIds.length, reason: 'no tokens' });

    const accessToken = await getAccessToken(sa);
    let sent = 0;
    const dead: string[] = [];
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const results = await Promise.all(
        chunk.map(async ({ token }: any) => {
          const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body: body ?? '' },
                data: { route: route ?? '' },
              },
            }),
          });
          if (res.ok) return { token, ok: true as const };
          const err = await res.text();
          return { token, ok: false as const, dead: err.includes('UNREGISTERED') || err.includes('INVALID_ARGUMENT') };
        })
      );
      for (const r of results) {
        if (r.ok) sent++;
        else if (r.dead) dead.push(r.token);
      }
    }
    if (dead.length) await supabase.from('user_push_tokens').delete().in('token', dead);
    return Response.json({ sent, users: userIds.length, cleaned: dead.length });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
