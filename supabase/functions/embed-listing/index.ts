import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// supabase/functions/embed-listing/index.ts
//
// Fingerprints one listing photo with Jina (jina-embeddings-v5-omni-small,
// 1024 dims) and stores it in product_image_embeddings for visual search.
// Called fire-and-forget from submitProductAction after a listing is saved;
// a failure here must never block saving the listing (the app ignores it).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JINA_URL = 'https://api.jina.ai/v1/embeddings';
const JINA_MODEL = 'jina-embeddings-v5-omni-small';
const DIMS = 1024;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

/** Embeds one image by URL. The listing photo is a "passage" (the document side). */
async function embedImage(imageUrl: string): Promise<number[]> {
  const apiKey = Deno.env.get('JINA_API_KEY');
  if (!apiKey) throw new Error('JINA_API_KEY is not set');
  const res = await fetch(JINA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: JINA_MODEL,
      task: 'retrieval.passage',
      normalized: true,
      input: [{ image: imageUrl }],
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized access');

    const body = await req.json();
    const productId = String(body.product_id ?? '').trim();
    const imageUrl = String(body.image_url ?? '').trim();
    if (!productId || !imageUrl) throw new Error('product_id and image_url are required');

    // The caller must own the listing.
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, seller_id')
      .eq('id', productId)
      .maybeSingle();
    if (productError || !product) throw new Error('Listing not found');
    if (product.seller_id !== user.id) throw new Error('Not your listing');

    const embedding = await embedImage(imageUrl);

    const { error: upsertError } = await supabase
      .from('product_image_embeddings')
      .upsert(
        { product_id: productId, image_url: imageUrl, embedding },
        { onConflict: 'product_id' }
      );
    if (upsertError) throw new Error(upsertError.message);

    return json({ success: true });
  } catch (error: any) {
    console.error('embed-listing error:', error);
    return json({ error: error.message }, 400);
  }
});
