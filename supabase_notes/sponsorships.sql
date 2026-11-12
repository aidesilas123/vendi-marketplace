-- Sponsorships: pay per listing to boost it for 7 days. Run once.
-- sponsored_until is the timestamp the boost expires. Null = never sponsored.
alter table public.products
  add column if not exists sponsored_until timestamptz;
create index if not exists products_sponsored_until_idx
  on public.products (sponsored_until)
  where sponsored_until is not null;
