-- supabase_notes/visual-search.sql
--
-- Visual search (image embeddings + pgvector). RUN FIRST, before deploying
-- embed-listing / visual-search.
--
-- Model: jina-embeddings-v5-omni-small (1024 dims, L2-normalized, free tier).
-- One embedding per product (first image only for v1). No backfill: the
-- current listings are test data, so only new listings get embedded.

create extension if not exists vector;

create table if not exists public.product_image_embeddings (
  product_id uuid primary key references public.products(id) on delete cascade,
  image_url text not null,
  embedding vector(1024) not null,
  created_at timestamptz not null default now()
);

-- Only the service-role edge functions touch this table; the app never
-- reads it directly.
alter table public.product_image_embeddings enable row level security;

create index if not exists product_image_embeddings_embedding_idx
  on public.product_image_embeddings
  using hnsw (embedding vector_cosine_ops);

-- Nearest public listings to a query embedding, by cosine similarity.
-- Security definer so it can read past RLS; only ACTIVE/APPROVED listings
-- ever surface (never SOLD, draft or rejected).
-- M1 (audit 2026-11-10): match_count is clamped server-side to at most 12,
-- so a direct caller cannot dump the catalogue with a huge match_count.
create or replace function public.match_similar_products(
  query_embedding vector(1024),
  match_count int default 12
)
returns table (matched_product_id uuid, similarity float)
language sql
stable
security definer
set search_path = public
as $$
  select e.product_id as matched_product_id,
         1 - (e.embedding <=> query_embedding) as similarity
  from public.product_image_embeddings e
  join public.products p on p.id = e.product_id
  where p.status in ('ACTIVE', 'APPROVED')
  order by e.embedding <=> query_embedding
  limit least(greatest(coalesce(match_count, 12), 1), 12);
$$;
