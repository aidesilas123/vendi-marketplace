-- supabase_notes/product-views-kind.sql
--
-- product_views.kind: 'open' vs 'impression'. RUN in the Supabase SQL editor.
--
-- The column is referenced by the app (src/lib/impressions.ts), by
-- feed-ranking.sql (the eng CTE splits opens / impressions) and by
-- algorithm.sql (product_engagement) — but NO SQL note in the repo ever
-- created it (impressions.ts points at this file by name, and it did not
-- exist). If the column is missing live, the feed ranking RPC and the
-- engagement RPC fail, and impression inserts fail. This file creates it.
--
--   * 'open'       = a product-page open. The product page inserts
--                    without a kind, so the DEFAULT 'open' is what makes
--                    those rows count as opens.
--   * 'impression' = a scroll-pass card view (impressions.ts).
--
-- Re-runnable: adds the column only if missing, backfills any NULL kind
-- rows to 'open', then enforces NOT NULL + the default.

alter table public.product_views
  add column if not exists kind text not null default 'open';

-- If the column already existed (nullable, or with NULL rows), bring it
-- to the same shape: no NULL kinds, default 'open' for future inserts.
update public.product_views set kind = 'open' where kind is null;

alter table public.product_views
  alter column kind set not null;
alter table public.product_views
  alter column kind set default 'open';
