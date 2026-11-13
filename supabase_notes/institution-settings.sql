-- supabase_notes/institution-settings.sql
--
-- Per-institution platform settings (multi-institution APK build).
--
-- WHY A NEW TABLE: the live platform_settings schema is not in the repo, so
-- altering it is unverifiable. This table is self-contained and leaves the
-- global platform_settings row (id = 1) untouched as the fallback.
--
-- HOW IT WORKS:
--   * One row per institution, keyed by university_id (lowercase slug, e.g.
--     'abu'). Products store university_id UPPERCASED, users store it
--     lowercase — every lookup normalizes to the lowercase slug.
--   * The app resolves fees as: institution row (when one exists) -> global
--     platform_settings id = 1 (fallback). An institution with no row, and
--     logged-out users with no institution, both get the global row, so
--     nothing breaks before an institution is configured.
--   * is_active is stored and exposed to the app, but NOT enforced by the
--     APK: no blocking or picker-filtering on it yet. Switching an
--     institution on/off and enforcing it is an admin-dashboard decision.
--   * Only the service role may write (admin dashboard / SQL editor) — the
--     client is read-only, exactly like platform_settings.
--
-- SEED: copies the live global fee % / promo flag into every row, so
-- activating an institution later starts from today's global values. ABU is
-- seeded active; the other four are seeded inactive.
--
-- RUN ORDER: run this file in the SQL editor any time (re-runnable). Run it
-- BEFORE the APK build that reads institution_settings, otherwise the app
-- silently falls back to the global row (safe, but the per-institution
-- values won't apply).

-- ======================================================================
-- Table
-- ======================================================================
create table if not exists public.institution_settings (
  university_id text primary key,
  platform_fee_percentage numeric not null default 0,
  is_launch_promo_active boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- ======================================================================
-- Row Level Security + grants (mirrors platform_settings)
--   SELECT: read-only for anon and authenticated (the client reads the fee
--   row for the listing's / seller's institution). NO client INSERT /
--   UPDATE / DELETE — settings change only via the service role
--   (admin dashboard / SQL editor).
-- ======================================================================
alter table public.institution_settings enable row level security;

drop policy if exists "institution_settings_select_public" on public.institution_settings;
create policy "institution_settings_select_public" on public.institution_settings
  for select using (true);

-- Explicit grants (defense in depth, same pattern as the users table):
-- revoke everything first, then grant only SELECT to the client roles.
revoke all on public.institution_settings from anon, authenticated;
grant select on public.institution_settings to anon, authenticated;

-- ======================================================================
-- Seed: copy the live global row into each institution.
-- ABU active; the other four inactive (same values, ready to switch on).
-- Re-runnable: existing rows are left untouched.
-- ======================================================================
insert into public.institution_settings (university_id, platform_fee_percentage, is_launch_promo_active, is_active)
select 'abu', platform_fee_percentage, is_launch_promo_active, true
from public.platform_settings
where id = 1
on conflict (university_id) do nothing;

insert into public.institution_settings (university_id, platform_fee_percentage, is_launch_promo_active, is_active)
select u.id, p.platform_fee_percentage, p.is_launch_promo_active, false
from (values ('uniben'), ('unilag'), ('unn'), ('buk')) as u(id)
cross join public.platform_settings p
where p.id = 1
on conflict (university_id) do nothing;

-- ======================================================================
-- Verify (run these after the inserts):
--   select * from public.institution_settings order by university_id;
--   -- Expect 5 rows: abu active, uniben/unilag/unn/buk inactive, all with
--   -- the global fee % / promo flag copied.
--   -- Anon read check (SQL editor runs as postgres, so verify from the app
--   -- or with the anon key): select * from public.institution_settings;
--   -- must return rows; insert/update/delete as anon must fail.
-- ======================================================================
