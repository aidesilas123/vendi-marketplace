import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MONNIFY_BASE = Deno.env.get('MONNIFY_BASE_URL') ?? 'https://sandbox.monnify.com';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // bank lists barely change; 6h per warm instance

let cache: { at: number; banks: { code: string; name: string }[] } | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Only signed-in Vendi users (protects your Monnify quota)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return json({ banks: cache.banks, cached: true });
    }

    const base64Auth = btoa(`${Deno.env.get('MONNIFY_API_KEY')!}:${Deno.env.get('MONNIFY_SECRET_KEY')!}`);
    const loginRes = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { Authorization: `Basic ${base64Auth}` },
    });
    if (!loginRes.ok) throw new Error('Failed to connect to banking provider');
    const accessToken = (await loginRes.json()).responseBody.accessToken;

    const banksRes = await fetch(`${MONNIFY_BASE}/api/v1/banks`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const banksData = await banksRes.json();
    if (!banksData.requestSuccessful) {
      throw new Error(banksData.responseMessage || 'Could not load banks');
    }

    const seen = new Set<string>();
    const banks = (banksData.responseBody as { name: string; code: string }[])
      .filter((b) => b?.name && b?.code && !seen.has(b.code) && seen.add(b.code))
      .map((b) => ({ code: String(b.code), name: String(b.name).trim() }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cache = { at: Date.now(), banks };
    return json({ banks });
  } catch (error: any) {
    console.error('List Banks Error:', error);
    return json({ error: error.message }, 400);
  }
});