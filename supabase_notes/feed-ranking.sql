-- Feed ranking, paging, and admin/sponsored distribution — server-side.
-- Replaces the client-side rankProductsByScore + boostAdminListings for the
-- non-search feed. Ranking, paging, and search all use the same order.
--
-- NEW MARKETPLACE RANKING (Option 2 + 3 combined, 2026-11-09):
-- The app is new, so a harsh engagement-based ranking would make new users
-- invisible (they have no opens, saves, or ratings yet). Everyone is
-- prioritized roughly equally, with only a very small boost for sponsors,
-- ratings, and verification. Engagement is NOT counted in the score yet —
-- it comes back later once there is real engagement data to rank on.
--
-- Tiers (Option 2): unseen first, seen after. The feed is two blocks —
-- everything the viewer has NOT seen (an impression/open in product_views),
-- then everything they have. Once you have seen a sponsored or high-scored
-- item it drops to the second block, so nothing stays pinned to the top.
--
-- Light score (within a tier — freshness is the main order):
--   freshness = max(0, 50 - ageDays * 2)          (new starts +50, fades ~25d)
--   verified seller = +3
--   seller average_rating >= 4.0 = +3
--   sponsored (sponsored_until still in the future) = +3
--   engagement (opens/saves/questions) = 0 for now, new marketplace.
--   per-refresh shuffle = a deterministic 0-3 seeded by (product, viewer,
--   p_seed), so the order varies on each refresh but is stable while paging.
--
-- Seller round-robin (2026-11-10): freshness scores by day, so a seller's
-- posts made at the same time tie and would sit adjacently. Inside each
-- tier block, each seller's best item comes first, then everyone's
-- second-best, and so on — no two adjacent items share a seller.
--
-- Own listings excluded (2026-11-10): the viewer never sees their own
-- listings in the feed — the feed is for finding other people's stuff, and
-- sellers manage theirs from the seller dashboard and their profile. This
-- applies to every block, admin included. Search still finds your own
-- listings (search is a lookup, not discovery).
--
-- Sponsored slots (Option 3): sponsored does NOT get a big score boost.
-- Instead, unseen sponsored listings sit at fixed positions inside the
-- unseen block — first at position 5, then one every 20 (5, 25, 45, ...).
-- Always visible early, never number one, never piled at the top.
--
-- Admin distribution: no admin at the top. First admin at position 8, then
-- one every 30 (positions 8, 38, 68, ...). Admin order rotates daily. If
-- there are more admin posts than pages, the extras simply never appear in
-- the fetched range — they are NOT appended at the bottom.
--
-- p_seed: the client passes a fresh random seed on each explicit refresh
-- (pull-to-refresh). All pages of that refresh use the same seed, so paging
-- stays consistent; a new refresh gets a new seed, so the order changes.
-- Default 0 keeps old callers working (fixed shuffle).
--
-- Returns product ids in final display order for one page. The app fetches
-- the full rows by id (same pattern as search_products) and keeps RPC order.
create or replace function public.feed_products(
  p_viewer_id uuid default null,
  p_campus text default null,
  p_university text default null,
  p_category text default 'All',
  p_limit int default 30,
  p_offset int default 0,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_delivery_only boolean default false,
  p_seed int default 0
)
returns table (product_id uuid, score float, trending boolean)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    -- M1 (audit 2026-11-10): the viewer, campus and university are derived
    -- server-side from auth.uid() + the users row. The caller-supplied
    -- p_viewer_id / p_campus / p_university are kept for signature
    -- compatibility but are NOT trusted: they are used only as a fallback
    -- when the caller is anonymous (auth.uid() IS NULL) or the viewer's
    -- users row has no campus / university set. p_limit is clamped to 50.
    select
      coalesce(auth.uid(), p_viewer_id) as viewer_id,
      coalesce(
        (select nullif(upper(btrim(u.campus)), '') from public.users u where u.id = auth.uid()),
        p_campus
      ) as campus,
      coalesce(
        (select nullif(upper(btrim(u.university_id)), '') from public.users u where u.id = auth.uid()),
        p_university
      ) as university,
      least(greatest(coalesce(p_limit, 30), 1), 50) as lim,
      greatest(coalesce(p_offset, 0), 0) as off
  ),
  eng as (
    select
      p.id as pid,
      count(*) filter (where pv.kind = 'open') as opens,
      count(*) filter (where pv.kind = 'impression') as impressions
    from public.products p
    cross join params prm
    left join public.product_views pv on pv.product_id = p.id
    where (p.status = 'ACTIVE' or (p.status = 'SOLD' and p.updated_at > now() - interval '24 hours'))
      and (prm.campus is null or p.campus = prm.campus)
      and (prm.university is null or p.university_id = prm.university)
      and (p_category = 'All' or p.category = p_category)
      and (p_min_price is null or p.base_price >= p_min_price)
      and (p_max_price is null or p.base_price <= p_max_price)
      and (not p_delivery_only or p.delivery_available = true)
    group by p.id
  ),
  saves as (
    select product_id, count(*) as n
    from public.saved_items
    group by product_id
  ),
  questions as (
    select product_id, count(*) as n
    from public.product_reviews
    where parent_id is null
    group by product_id
  ),
  seen as (
    select pv.product_id
    from public.product_views pv
    cross join params prm
    where prm.viewer_id is not null and pv.viewer_id = prm.viewer_id
    group by pv.product_id
  ),
  scored as (
    select
      p.id as pid,
      p.seller_id as seller_id,
      coalesce(u.is_admin, false) as is_admin,
      (p.sponsored_until is not null and p.sponsored_until > now()) as is_sponsored,
      (sn.product_id is not null) as is_seen,
      (
        greatest(0, 50 - floor(extract(epoch from (now() - p.created_at)) / 86400) * 2)
        + (case when coalesce(u.is_verified, false) then 3 else 0 end)
        + (case when coalesce(u.average_rating, 0) >= 4 then 3 else 0 end)
        + (case when p.sponsored_until is not null and p.sponsored_until > now() then 3 else 0 end)
        + (abs(hashtext(p.id::text || coalesce(prm.viewer_id::text, '') || p_seed::text)) % 1000) / 1000.0 * 3
      ) as score,
      -- Trending still reads real engagement (opens/saves/questions), even
      -- though engagement no longer feeds the ranking score.
      (coalesce(e.opens, 0) * 10 + coalesce(s.n, 0) * 15 + coalesce(q.n, 0) * 5 >= 30) as trending,
      -- Daily admin order (same for all viewers on a given day).
      abs(hashtext(p.id::text || current_date::text)) as admin_ord
    from public.products p
    cross join params prm
    join public.users u on u.id = p.seller_id
    left join eng e on e.pid = p.id
    left join saves s on s.product_id = p.id
    left join questions q on q.product_id = p.id
    left join seen sn on sn.product_id = p.id
    where (p.status = 'ACTIVE' or (p.status = 'SOLD' and p.updated_at > now() - interval '24 hours'))
      and (prm.campus is null or p.campus = prm.campus)
      and (prm.university is null or p.university_id = prm.university)
      and (p_category = 'All' or p.category = p_category)
      and (p_min_price is null or p.base_price >= p_min_price)
      and (p_max_price is null or p.base_price <= p_max_price)
      and (not p_delivery_only or p.delivery_available = true)
      and (prm.viewer_id is null or p.seller_id <> prm.viewer_id)
  ),
  unseen_regular as (
    -- Seller round-robin (see header): each seller's best first, then
    -- everyone's second-best, so same-seller posts never pack together.
    select pid, score, trending,
      row_number() over (order by seller_seq, score desc, pid) as r
    from (
      select pid, score, trending, seller_id,
        row_number() over (partition by seller_id order by score desc, pid) as seller_seq
      from scored where not is_admin and not is_sponsored and not is_seen
    ) rr
  ),
  unseen_sponsored as (
    select pid, score, trending,
      row_number() over (order by score desc, pid) as s
    from scored where not is_admin and is_sponsored and not is_seen
  ),
  seen_ranked as (
    -- Same seller round-robin as unseen_regular, for the seen block.
    select pid, score, trending,
      row_number() over (order by seller_seq, score desc, pid) as r2
    from (
      select pid, score, trending, seller_id,
        row_number() over (partition by seller_id order by score desc, pid) as seller_seq
      from scored where not is_admin and is_seen
    ) rr
  ),
  admin as (
    select pid, score, trending,
      row_number() over (order by admin_ord, pid) as a
    from scored where is_admin
  ),
  unseen_count as (
    select count(*)::int as n from scored where not is_admin and not is_seen
  ),
  unseen_merged as (
    -- Unseen regular: final position shifts right by the sponsored items
    -- inserted before it. Sponsored sit at positions 5, 25, 45, ... (first
    -- at 5, then one per 20) inside the unseen block.
    select pid, score, trending,
      r + (case when r <= 4 then 0 else 1 + floor((r - 5) / 19) end) as pos1
    from unseen_regular
    union all
    select pid, score, trending,
      least(5 + 20 * (s - 1), (select n from unseen_count)) as pos1
    from unseen_sponsored
  ),
  combined as (
    select pid, score, trending, pos1 from unseen_merged
    union all
    -- Seen block starts after the whole unseen block.
    select pid, score, trending, (select n from unseen_count) + r2 as pos1
    from seen_ranked
  ),
  positioned as (
    -- Non-admin: final position shifts right by the admins inserted before it.
    -- Admins sit at positions 8, 38, 68, ... (first at 8, then one per 30).
    select pid, score, trending,
      pos1 + (case when pos1 <= 7 then 0 else 1 + floor((pos1 - 8) / 29) end) as final_pos
    from combined
    union all
    select pid, score, trending,
      8 + 30 * (a - 1) as final_pos
    from admin
  )
  select pid as product_id, score, trending
  from positioned
  order by final_pos, pid
  limit (select lim from params) offset (select off from params);
$$;
