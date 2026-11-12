-- supabase_notes/smart-search.sql
--
-- Smart (intelligent) text search: Postgres full-text + trigram typo tolerance,
-- plus search suggestions. RUN in the Supabase SQL editor. Re-runnable.
-- No backfill needed: search_vector is a generated column, so it is computed
-- for existing listings automatically and stays in sync on every insert/update.
-- Listings are scoped to the searcher's campus (campus_filter).

create extension if not exists pg_trgm;

-- A searchable text vector: title matters most, then description / category /
-- condition / specifications, then location. Generated, so it backfills
-- automatically and never goes stale.
alter table public.products drop column if exists search_vector;
alter table public.products
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(condition, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(specifications, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(base_price::text, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(specific_location, '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(university_id, '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(campus, '')), 'C')
  ) stored;

drop index if exists products_search_vector_idx;
create index products_search_vector_idx
  on public.products using gin (search_vector);

-- Trigram indexes for typo-tolerant (fuzzy) matching on title/description.
create index if not exists products_title_trgm_idx
  on public.products using gin (title gin_trgm_ops);
create index if not exists products_description_trgm_idx
  on public.products using gin (description gin_trgm_ops);

-- Ranked search: full-text relevance + trigram similarity (typo tolerance).
-- Returns product ids in rank order (best match first). Security definer so
-- it reads past RLS. Same listing set as the feed: ACTIVE, plus SOLD within
-- the last 24 hours. Scoped to the searcher's campus when campus_filter is set.
create or replace function public.search_products(
  query_text text,
  category_name text default 'All',
  match_limit int default 50,
  campus_filter text default null,
  university_filter text default null,
  max_price numeric default null,
  min_price numeric default null,
  location_term text default null
)
returns table (product_id uuid, score float)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    -- M1 (audit 2026-11-10): campus / university are derived server-side
    -- from auth.uid() + the users row. The caller-supplied campus_filter /
    -- university_filter are only a fallback for anonymous callers or a
    -- viewer with no campus set. match_limit is clamped to 50.
    select
      coalesce(
        (select nullif(upper(btrim(u.campus)), '') from public.users u where u.id = auth.uid()),
        campus_filter
      ) as campus,
      coalesce(
        (select nullif(upper(btrim(u.university_id)), '') from public.users u where u.id = auth.uid()),
        university_filter
      ) as university,
      least(greatest(coalesce(match_limit, 50), 1), 50) as lim
  ),
  q as (
    select websearch_to_tsquery('english'::regconfig, query_text) as tsq
  )
  select p.id as product_id,
         (
           ts_rank(p.search_vector, q.tsq) * 2
           + greatest(
               similarity(p.title, query_text),
               similarity(coalesce(p.description, ''), query_text)
             )
         ) as score
  from public.products p, q cross join params prm
  where (
      p.status = 'ACTIVE'
      or (p.status = 'SOLD' and p.updated_at > now() - interval '24 hours')
    )
    and (prm.campus is null or p.campus = prm.campus)
    and (prm.university is null or p.university_id = prm.university)
    and (category_name = 'All' or p.category = category_name)
    and (max_price is null or p.base_price <= max_price)
    and (min_price is null or p.base_price >= min_price)
    and (
      location_term is null
      or upper(p.campus) like '%' || upper(location_term) || '%'
      or upper(coalesce(p.specific_location, '')) like '%' || upper(location_term) || '%'
    )
    and (
      -- No item to match (the query was only a price/location): everything
      -- that passes the filters above matches.
      (nullif(trim(query_text), '') is null)
      or p.search_vector @@ q.tsq
      or p.title % query_text
      or coalesce(p.description, '') % query_text
      -- Partial word (typing "iph" should find "iphone"): the trigram
      -- similarity above is too strict for a 3-letter prefix, so a
      -- substring match on title/description backs it up. The trigram
      -- GIN indexes cover this.
      or p.title ilike '%' || query_text || '%'
      or coalesce(p.description, '') ilike '%' || query_text || '%'
      or (query_text ~ '^[0-9,]+$' and p.base_price = nullif(regexp_replace(query_text, '[^0-9]', '', 'g'), '')::numeric)
    )
  order by score desc, p.created_at desc
  limit (select lim from params);
$$;

-- Search suggestions: distinct values from listing fields that match what the
-- user typed, scoped to the searcher's campus. Titles first, then condition,
-- specifications, location and campus. The app adds matching categories
-- client-side (fixed list) and the user's recent searches.
create or replace function public.search_suggestions(
  query_text text,
  campus_filter text default null,
  match_limit int default 8,
  university_filter text default null
)
returns table (suggestion text, kind text, price numeric)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    -- M1 (audit 2026-11-10): same server-side campus derivation as
    -- search_products above; caller filters are the anonymous fallback.
    -- match_limit is clamped to 50.
    select
      coalesce(
        (select nullif(upper(btrim(u.campus)), '') from public.users u where u.id = auth.uid()),
        campus_filter
      ) as campus,
      coalesce(
        (select nullif(upper(btrim(u.university_id)), '') from public.users u where u.id = auth.uid()),
        university_filter
      ) as university,
      least(greatest(coalesce(match_limit, 8), 1), 50) as lim
  )
  select suggestion, kind, price from (
    (select distinct p.title as suggestion, 'title'::text as kind, p.base_price as price
     from public.products p cross join params prm
     where p.status = 'ACTIVE'
       and (prm.campus is null or p.campus = prm.campus)
       and (prm.university is null or p.university_id = prm.university)
       and (
         p.title ilike '%' || query_text || '%'
         or coalesce(p.description, '') ilike '%' || query_text || '%'
         or coalesce(p.specifications, '') ilike '%' || query_text || '%'
       )
     limit 4)
    union all
    (select distinct p.condition as suggestion, 'condition'::text as kind, null::numeric as price
     from public.products p cross join params prm
     where p.status = 'ACTIVE'
       and (prm.campus is null or p.campus = prm.campus)
       and (prm.university is null or p.university_id = prm.university)
       and p.condition ilike '%' || query_text || '%'
     limit 2)
    union all
    (select distinct p.specifications as suggestion, 'specification'::text as kind, null::numeric as price
     from public.products p cross join params prm
     where p.status = 'ACTIVE'
       and (prm.campus is null or p.campus = prm.campus)
       and (prm.university is null or p.university_id = prm.university)
       and p.specifications is not null and p.specifications <> ''
       and p.specifications ilike '%' || query_text || '%'
     limit 2)
    union all
    (select distinct p.specific_location as suggestion, 'location'::text as kind, null::numeric as price
     from public.products p cross join params prm
     where p.status = 'ACTIVE'
       and (prm.campus is null or p.campus = prm.campus)
       and (prm.university is null or p.university_id = prm.university)
       and p.specific_location is not null and p.specific_location <> ''
       and p.specific_location ilike '%' || query_text || '%'
     limit 2)
    union all
    (select distinct p.campus as suggestion, 'campus'::text as kind, null::numeric as price
     from public.products p cross join params prm
     where p.status = 'ACTIVE'
       and (prm.campus is null or p.campus = prm.campus)
       and (prm.university is null or p.university_id = prm.university)
       and p.campus ilike '%' || query_text || '%'
     limit 2)
  ) s
  where s.suggestion is not null and s.suggestion <> ''
  limit (select lim from params);
$$;
