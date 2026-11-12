-- supabase_notes/algorithm.sql
--
-- Feed ranking (option 1: weighted score). RUN in the Supabase SQL editor.
-- The feed calls this RPC with the product ids on the current page and
-- scores each listing in the app from the returned counts:
--   opens      = product-page opens (kind 'open') — strongest signal
--   impressions = card views (kind 'impression')
--   saves      = saved_items rows
--   questions  = product_reviews rows with no parent (top-level questions)
-- If the RPC is missing (SQL not run yet) the feed falls back to date order.
--
-- M17 (audit 2026-11-10): engagement is only returned for public listings.
-- The inner join + status filter below means DRAFT / PENDING_REVIEW /
-- REJECTED / SOLD listings return NO row at all (not zero counts), so an
-- anonymous caller cannot enumerate views/saves/questions for listings
-- that should be invisible.

create or replace function public.product_engagement(p_product_ids uuid[])
returns table (product_id uuid, opens bigint, impressions bigint, saves bigint, questions bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce((select count(*) from public.product_views v where v.product_id = p.id and v.kind = 'open'), 0) as opens,
    coalesce((select count(*) from public.product_views v where v.product_id = p.id and v.kind = 'impression'), 0) as impressions,
    coalesce((select count(*) from public.saved_items s where s.product_id = p.id), 0) as saves,
    coalesce((select count(*) from public.product_reviews r where r.product_id = p.id and r.parent_id is null), 0) as questions
  from unnest(p_product_ids) as p(id)
  join public.products pr on pr.id = p.id
  where pr.status in ('ACTIVE', 'APPROVED');
$$;
