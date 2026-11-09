import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// supabase/functions/visual-search/index.ts
//
// Photo search: fingerprints the uploaded photo with Jina
// (jina-embeddings-v5-omni-small, 1024 dims) and returns the closest
// public listings, ranked by visual similarity. Search is public, so no
// user auth is required (same as browsing the feed).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JINA_URL = 'https://api.jina.ai/v1/embeddings';
const JINA_MODEL = 'jina-embeddings-v5-omni-small';
const DIMS = 1024;
const DEFAULT_MATCHES = 12;

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
