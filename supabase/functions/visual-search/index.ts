import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// supabase/functions/visual-search/index.ts
//
// Photo search: fingerprints the uploaded photo with Jina
// (jina-embeddings-v5-omni-small, 1024 dims) and returns the closest
// public listings, ranked by visual similarity.
//
// SEC-12: a valid user JWT is required (a bare anon key no longer works).
// Jina is billed per call, so an unauthenticated endpoint was a free
// quota-burn for anyone with the public publishable key. Logged-out users
// get a 401 — the feed camera must be gated on login client-side.
// Per-user rate limit (30/hour) via the check_rate_limit RPC, fail-closed.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JINA_URL = 'https://api.jina.ai/v1/embeddings';
const JINA_MODEL = 'jina-embeddings-v5-omni-small';
const DIMS = 1024;
const DEFAULT_MATCHES = 12;
const RATE_LIMIT_PER_HOUR = 30;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

/** Embeds the query photo. The photo is the "query" side of retrieval. */
async function embedQuery(image: string): Promise<number[]> {
  const apiKey = Deno.env.get('JINA_API_KEY');
  if (!apiKey) throw new Error('JINA_API_KEY is not set');
  const res = await fetch(JINA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: JINA_MODEL,
      task: 'retrieval.query',
      normalized: true,
      input: [{ image }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jina embed failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== DIMS) {
    throw new Error('Jina returned no embedding');
  }
  return embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // SEC-12: a real user JWT is required — the public anon key is not
    // authentication, and Jina is billed per call.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: 'Unauthorized access' }, 401);

    // Atomic rate-limit check (check_rate_limit RPC): counts AND records
    // the call in one transaction, serialized per (user, fn). Fail-CLOSED
    // on a DB error — a broken rate-limit table must not silently allow
    // unlimited paid Jina calls.
    let allowed: boolean;
    try {
      const { data, error: rlError } = await supabase.rpc('check_rate_limit', {
        p_user_id: user.id,
        p_fn: 'visual-search',
        p_limit: RATE_LIMIT_PER_HOUR,
        p_window_minutes: 60,
      });
      if (rlError) throw rlError;
      allowed = data === true;
    } catch (e) {
      console.error('[visual-search] rate-limit check failed:', e);
      return json({ error: 'Photo search is unavailable right now. Please try again.' }, 503);
    }
    if (!allowed) {
      return json({ error: 'Too many photo searches. Please try again later.' }, 429);
    }

    const body = await req.json();
    // Raw base64 (no data: prefix) from the app, or a public image URL.
    const image = String(body.image_base64 ?? body.image_url ?? '').trim();
    if (!image) throw new Error('image_base64 or image_url is required');

    const queryEmbedding = await embedQuery(image);

    const { data: matches, error: matchError } = await supabase.rpc(
      'match_similar_products',
      { query_embedding: queryEmbedding, match_count: DEFAULT_MATCHES }
    );
    if (matchError) throw new Error(matchError.message);
    if (!matches || matches.length === 0) {
      return json({ success: true, products: [] });
    }

    const ids = (matches as any[]).map((m) => m.matched_product_id);
    const rank = new Map<string, number>(ids.map((id: string, i: number) => [id, i]));

    // Full product rows in the same shape the feed renders (seller + views).
    const { data: rows, error: rowsError } = await supabase
      .from('products')
      .select('*, seller:users(username, is_verified, is_admin, average_rating, avatar_url), product_views(count)')
      .in('id', ids);
    if (rowsError) throw new Error(rowsError.message);

    const products = (rows ?? [])
      .map((p: any) => ({
        ...p,
        views_count: p.product_views?.[0]?.count ?? 0,
      }))
      .sort((a: any, b: any) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));

    return json({ success: true, products });
  } catch (error: any) {
    console.error('visual-search error:', error);
    return json({ error: error.message }, 400);
  }
});
