-- supabase_notes/popular-searches.sql
--
-- Popular searches (what other people are searching for). RUN in the
-- Supabase SQL editor.
-- search_queries logs each search the app applies (fire-and-forget, best
-- effort). popular_searches returns the top queries of the last 7 days on
-- the searcher's campus, so the dropdown can show them next to your own
-- recent searches. Reads go through the RPC (security definer); the table
-- itself has no SELECT policy.

create table if not exists public.search_queries (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  campus text,
  university_id text,
  created_at timestamptz not null default now()
);

create index if not exists search_queries_created_idx on public.search_queries (created_at desc);

alter table public.search_queries enable row level security;

-- M18 (audit 2026-11-10): logging a search now requires a signed-in user.
-- Previously WITH CHECK (true): anyone, including the anon key, could flood
-- the table with spam / offensive queries / PII, which popular_searches
-- then surfaced to other users. The same policy is defined in
-- rls-policies.sql; both files define it identically, so running either
-- file keeps the same result. There is still NO SELECT policy on purpose.
drop policy if exists "Anyone can log a search" on public.search_queries;
drop policy if exists "Authenticated users can log a search" on public.search_queries;
create policy "Authenticated users can log a search" on public.search_queries
  for insert with check (auth.uid() is not null);

-- M18: length cap (200 chars). A search longer than this cannot be a real
-- query — it is spam or pasted PII. Added only if the constraint does not
-- exist yet, so the file stays re-runnable. NOTE: if the table already
-- holds rows longer than 200 chars, this ALTER FAILS — delete or trim
-- those rows first (select id, length(query) from search_queries where
-- length(query) > 200;), then re-run this file.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'search_queries_query_length'
      and conrelid = 'public.search_queries'::regclass
  ) then
    alter table public.search_queries
      add constraint search_queries_query_length
      check (char_length(query) <= 200);
  end if;
end $$;

create or replace function public.popular_searches(
  campus_filter text default null,
  university_filter text default null,
  match_limit int default 5
)
returns table (query text, searches bigint)
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(q.query)) as query, count(*) as searches
  from public.search_queries q
  where q.created_at >= now() - interval '7 days'
    and length(trim(q.query)) >= 2
    and (campus_filter is null or upper(q.campus) = upper(campus_filter))
    and (university_filter is null or upper(q.university_id) = upper(university_filter))
  group by lower(trim(q.query))
  order by searches desc, query asc
  limit least(greatest(coalesce(match_limit, 5), 1), 50);
$$;
