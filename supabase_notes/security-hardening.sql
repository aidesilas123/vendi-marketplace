-- supabase_notes/security-hardening.sql
--
-- Security-hardening tables + uniqueness constraints (pre-launch audit,
-- 2026-11-10). RUN in the Supabase SQL editor. Re-runnable: every
-- statement uses IF NOT EXISTS / CREATE OR REPLACE where Postgres allows
-- it, so running the file twice is safe.
--
-- NOTE on re-runs: CREATE UNIQUE INDEX IF NOT EXISTS is skipped when the
-- index already exists — but if the index does NOT exist yet and the table
-- already holds DUPLICATE rows, that statement FAILS and the rest of the
-- file still runs (the SQL editor runs statements one by one). A failure
-- here means: clean the duplicate rows first (the queries in the comment
-- on each index find them), then re-run this file. Do not delete the
-- index statement to make the file "pass" — the uniqueness is the fix.
--
-- The three new tables are service-role ONLY: RLS is enabled and NO
-- policies are created, so no client role can read or write them. Edge
-- functions use the service-role key and bypass RLS. Do not add a client
-- policy to any of them.

-- ======================================================================
-- edge_rate_limits — per-user rate-limit ledger for edge functions.
-- Contract (money-functions agent): one row per call, then count rows
-- for (user_id, fn) inside the window before allowing the call.
--   resolve-account : 10/day
--   nexus-gatekeeper: 100/hour
--   visual-search   : 30/hour
--   embed-listing   : 60/hour
--   upload-media    : 20/hour
-- Old rows are never deleted by the functions; prune them with a
-- scheduled cleanup (e.g. delete where created_at < now() - interval
-- '7 days') if the table grows.
-- ======================================================================
create table if not exists public.edge_rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  fn text not null,
  created_at timestamptz not null default now()
);

create index if not exists edge_rate_limits_user_fn_created_idx
  on public.edge_rate_limits (user_id, fn, created_at);

alter table public.edge_rate_limits enable row level security;
-- No policies: service-role only (fail-closed).

-- ======================================================================
-- wallet_accounts — EVERY Monnify virtual account number for a wallet.
-- Contract (money-functions agent): create-wallet writes ALL account
-- numbers Monnify returns for a reference here (Monnify can return
-- several bank accounts for one reference; today only accounts[0] is
-- stored, so money sent to a second account is stranded — audit M15).
-- Funding is matched against this table, not against the single
-- wallets.virtual_account_number. account_number is unique: one bank
-- account number belongs to exactly one wallet.
-- ======================================================================
create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets (id) on delete cascade,
  account_number text not null unique,
  bank_name text,
  created_at timestamptz not null default now()
);

alter table public.wallet_accounts enable row level security;
-- No policies: service-role only (fail-closed).

-- ======================================================================
-- pin_attempts — PIN lockout state (audit H10).
-- Contract (money-functions agent): manage-pin increments attempts on
-- each failed verify; at 5 failures set locked_until = now() + 15 minutes
-- and refuse verifies until it passes; reset attempts to 0 on a
-- successful verify (and on a successful PIN set). One row per user.
-- ======================================================================
create table if not exists public.pin_attempts (
  user_id uuid primary key,
  attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.pin_attempts enable row level security;
-- No policies: service-role only (fail-closed).

-- ======================================================================
-- Columns the code writes but no repo SQL creates (error sweep,
-- 2026-11-11).
--   The tables themselves were created in the dashboard, not in SQL
--   notes, so a column the app / edge code depends on can be missing
--   live with nothing in the repo to prove it either way. Each
--   statement below is a no-op when the column already exists, and
--   creates it (with the default the code relies on) when it does not.
--   Types match what the code writes: updated_at is always a
--   timestamp; the messages columns are the text / boolean values the
--   room sends. If a column already exists with a different type, the
--   IF NOT EXISTS skips it — the live type wins, nothing is changed.
-- ======================================================================
-- updated_at: the money / dispute / fee functions stamp it on every
-- status or balance move (reconcile claims, cancel-dispute resume,
-- resolve-dispute, charge-verification-fee, settle_wallet). The
-- reconcile functions even read row.updated_at with a created_at
-- fallback, which is the tell that its existence was never certain.
alter table public.transactions add column if not exists updated_at timestamptz not null default now();
alter table public.disputes add column if not exists updated_at timestamptz not null default now();
alter table public.verifications add column if not exists updated_at timestamptz not null default now();
alter table public.wallets add column if not exists updated_at timestamptz not null default now();
alter table public.notification_preferences add column if not exists updated_at timestamptz not null default now();
-- messages: the room writes these on edit / delete / media / reply
-- sends (is_edited, is_deleted, media_url, reply_to_*). The H4
-- trigger in rls-policies.sql also reads is_deleted.
alter table public.messages add column if not exists is_edited boolean not null default false;
alter table public.messages add column if not exists is_deleted boolean not null default false;
alter table public.messages add column if not exists media_url text;
alter table public.messages add column if not exists reply_to_id text;
alter table public.messages add column if not exists reply_to_type text;
alter table public.messages add column if not exists reply_to_content text;
alter table public.messages add column if not exists reply_to_sender_label text;
alter table public.messages add column if not exists reply_to_media_url text;

-- ======================================================================
-- Deploy blockers for the money-functions fixes (audit 2026-11-10).
-- Both must be in place before the reconcile / resolve-dispute functions
-- are deployed, or those functions fail loudly at the claim step.
-- ======================================================================

-- 1) transactions.status must accept 'processing'.
--    The reconcile functions claim a row pending -> processing before any
--    money moves, and wait on / reclaim 'processing' rows. If
--    transactions.status is an enum without that value, every paid
--    reconcile errors at the claim and NO paid reconcile can complete.
--    If the column is plain text, no change is needed.
--    The enum type name is NOT in the repo (the tables were created in
--    the dashboard, not in SQL notes), so this block discovers it and
--    tells you the exact statement to run. It CANNOT run the ALTER
--    itself: ALTER TYPE ... ADD VALUE cannot run inside a transaction
--    block, and a DO block is one. So: run this file, read the NOTICE it
--    raises, and if it names an enum, run the printed ALTER TYPE as its
--    OWN statement in the SQL editor (one statement, autocommit) before
--    deploying the reconcile functions. If it says the column is text,
--    there is nothing to run.
do $$
declare
  v_schema text;
  v_type text;
  v_is_enum boolean;
  v_qualified text;
  v_has boolean;
begin
  select c.udt_schema, c.udt_name, (c.data_type = 'USER-DEFINED')
    into v_schema, v_type, v_is_enum
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'transactions'
    and c.column_name = 'status';

  if v_type is null then
    raise notice 'transactions.status not found — check the transactions table exists before deploying the reconcile functions.';
    return;
  end if;

  if not v_is_enum then
    raise notice 'transactions.status is % (plain text) — ''processing'' needs no schema change.', v_type;
    return;
  end if;

  v_qualified := case when v_schema = 'public' then quote_ident(v_type)
    else quote_ident(v_schema) || '.' || quote_ident(v_type) end;

  select exists (
    select 1
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = v_schema and t.typname = v_type and e.enumlabel = 'processing'
  ) into v_has;

  if v_has then
    raise notice 'transactions.status enum % already accepts ''processing'' — nothing to do.', v_qualified;
  else
    raise notice 'transactions.status is enum % and lacks ''processing''. Run this as its OWN statement in the SQL editor (ALTER TYPE ... ADD VALUE cannot run inside a transaction block): ALTER TYPE % ADD VALUE IF NOT EXISTS ''processing'';', v_qualified, v_qualified;
  end if;
end $$;

-- 1b) disputes.status must accept 'withdrawn'.
--    cancel-dispute marks a cancelled dispute 'withdrawn' (see the header
--    of supabase/functions/cancel-dispute/index.ts). If the
--    dispute_status enum lacks that value, the cancel update errors and
--    no dispute can ever be cancelled. Same constraint as above: ALTER
--    TYPE ... ADD VALUE cannot run inside a transaction block, so this
--    block only prints the statement — run it as its OWN statement in
--    the SQL editor if it names an enum. If the column is plain text,
--    there is nothing to run.
do $$
declare
  v_schema text;
  v_type text;
  v_is_enum boolean;
  v_qualified text;
  v_has boolean;
begin
  select c.udt_schema, c.udt_name, (c.data_type = 'USER-DEFINED')
    into v_schema, v_type, v_is_enum
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'disputes'
    and c.column_name = 'status';

  if v_type is null then
    raise notice 'disputes.status not found — check the disputes table exists before deploying cancel-dispute.';
    return;
  end if;

  if not v_is_enum then
    raise notice 'disputes.status is % (plain text) — ''withdrawn'' needs no schema change.', v_type;
    return;
  end if;

  v_qualified := case when v_schema = 'public' then quote_ident(v_type)
    else quote_ident(v_schema) || '.' || quote_ident(v_type) end;

  select exists (
    select 1
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = v_schema and t.typname = v_type and e.enumlabel = 'withdrawn'
  ) into v_has;

  if v_has then
    raise notice 'disputes.status enum % already accepts ''withdrawn'' — nothing to do.', v_qualified;
  else
    raise notice 'disputes.status is enum % and lacks ''withdrawn''. Run this as its OWN statement in the SQL editor (ALTER TYPE ... ADD VALUE cannot run inside a transaction block): ALTER TYPE % ADD VALUE IF NOT EXISTS ''withdrawn'';', v_qualified, v_qualified;
  end if;
end $$;

-- 2) disputes needs resolved_by / resolved_at.
--    The admin-only resolve-dispute function marks a dispute resolved with
--    resolved_by (the admin's user id) and resolved_at, and aborts safely
--    without them — it cannot resolve anything until these columns exist.
--    No enum change is needed for disputes.status: 'resolved' is already
--    a value of the dispute_status enum.
alter table public.disputes
  add column if not exists resolved_by uuid;
alter table public.disputes
  add column if not exists resolved_at timestamptz;

-- ======================================================================
-- Unique indexes — the exactly-once guarantees the money code currently
-- rests on racy read-then-write checks for (audit H11, M7, L2 and the
-- "needs a live check" list). Each statement FAILS if duplicate rows
-- already exist: find them with the query in the comment, clean them,
-- then re-run this file.
-- ======================================================================

-- One verification application per user (audit H11 / M7: the
-- double-charge and double-fulfil races both depend on being able to
-- create a second verifications row for the same user).
-- Duplicates: select user_id, count(*) from verifications group by 1 having count(*) > 1;
create unique index if not exists verifications_user_id_unique
  on public.verifications (user_id);

-- Usernames are unique case-insensitively (audit L2: two users claiming
-- "Aide" and "aide" at once, or an availability-check error falling back
-- to 'available', must not create a duplicate).
-- Duplicates: select lower(username), count(*) from users group by 1 having count(*) > 1;
create unique index if not exists users_username_lower_unique
  on public.users (lower(username));

-- One transaction row per reference (audit: exactly-once logic for
-- escrow / checkout / fee rows rests on reference uniqueness).
-- Already enforced by the table's own transactions_reference_key
-- (UNIQUE constraint on reference) — no second index is created here
-- (2026-11-12 cleanup: the duplicate transactions_reference_unique
-- index was dropped).

-- One wallet per user (the app assumes a single wallet per user
-- everywhere: useWallet, the transactions page, funding match).
-- Already enforced by the table's own wallets_user_id_key
-- (UNIQUE constraint on user_id) — no second index is created here
-- (2026-11-12 cleanup: the duplicate wallets_user_id_unique index
-- was dropped).

-- One stored push token per (user, token) (the upsert in src/lib/push.ts
-- uses onConflict 'user_id,token', which needs this constraint to work).
-- Already enforced by the table's own user_push_tokens_user_id_token_key
-- (UNIQUE constraint on user_id, token) — no second index is created
-- here (2026-11-12 cleanup: the duplicate
-- user_push_tokens_user_token_unique index was dropped).

-- One seller review per (buyer, seller) pair.
-- Duplicates: select buyer_id, seller_id, count(*) from seller_reviews group by 1, 2 having count(*) > 1;
create unique index if not exists seller_reviews_buyer_seller_unique
  on public.seller_reviews (buyer_id, seller_id);

-- product_views dedupe (audit H6): at most one counted view per
-- (product, viewer, UTC calendar day). The partial index only covers
-- logged-in viewers (viewer_id IS NOT NULL).
--   * Why ((created_at AT TIME ZONE 'UTC')::date) and not
--     date_trunc('day', created_at): date_trunc on a timestamptz is
--     STABLE, not IMMUTABLE (it depends on the session timezone), and
--     Postgres refuses non-immutable expressions in an index. Casting
--     to a UTC date is immutable and dedupes the same calendar day.
--   * The index is partial (viewer_id IS NOT NULL) because anonymous
--     rows have a NULL viewer: NULLs are distinct from each other, so
--     the index never blocks an anonymous view — it only dedupes
--     logged-in views. (Audit H6 was reverted 2026-11-11 on the user's
--     call: anonymous views stay, exactly as before.)
-- Duplicates: select product_id, viewer_id, (created_at at time zone 'UTC')::date as d, count(*)
--   from product_views where viewer_id is not null group by 1, 2, 3 having count(*) > 1;
create unique index if not exists product_views_daily_unique
  on public.product_views (product_id, viewer_id, ((created_at at time zone 'UTC')::date))
  where viewer_id is not null;

-- One saved item per (user, product) (error sweep 2026-11-11): the save
-- toggle in src/app/product/page.tsx upserts onConflict
-- 'user_id,product_id', which needs this constraint to work — without
-- it the upsert errors and saving fails.
-- Already enforced by the table's own saved_items_user_id_product_id_key
-- (UNIQUE constraint on user_id, product_id) — no second index is
-- created here (2026-11-12 cleanup: the duplicate
-- saved_items_user_product_unique index was dropped).

-- One notification-preference row per user (error sweep 2026-11-11):
-- the settings page upserts onConflict 'user_id', which needs this
-- constraint — without it, toggling a notification preference errors.
-- Already enforced by the table's primary key on user_id — no second
-- index is created here (2026-11-12 cleanup: the duplicate
-- notification_preferences_user_id_unique index was dropped).

-- message_reactions — the table DDL itself lives nowhere else in the
-- repo (it was created from a note that is no longer in the tree), so
-- it is defined here to make the repo self-contained. id uuid PK,
-- message_id FK to messages (cascade delete), user_id with deliberately
-- no FK (a reaction must survive its author's row being gone), emoji,
-- created_at. One row per (message_id, user_id) — the unique constraint
-- in the DDL below, which the room's upsert (onConflict 'message_id,user_id')
-- needs. RLS policies live in rls-policies.sql, not here.
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.message_reactions enable row level security;

-- (2026-11-12 cleanup: the separate message_reactions_message_user_unique
-- index was dropped — it duplicated the unique constraint above.)
