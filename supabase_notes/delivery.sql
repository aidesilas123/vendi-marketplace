-- supabase_notes/delivery.sql
--
-- "Offer delivery" on listings. RUN in the Supabase SQL editor.
-- delivery_available: the seller offers delivery (no fee — agreed in chat).
-- delivery_area: where they deliver, only when delivery is on:
--   'within_campus'   = Within campus only
--   'on_off_campus'   = On or off campus
--   'worldwide'       = Worldwide

alter table public.products
  add column if not exists delivery_available boolean not null default false;

alter table public.products
  add column if not exists delivery_area text;
