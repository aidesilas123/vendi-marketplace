-- supabase_notes/rls-policies.sql
--
-- Row-Level Security for ALL Vendi tables (pre-launch audit finding C1).
-- RUN in the Supabase SQL editor. Re-runnable: every statement is
-- idempotent (DROP POLICY IF EXISTS before CREATE POLICY, IF NOT EXISTS
-- where Postgres allows it, CREATE OR REPLACE for the function/view).
--
-- What this file assumes:
--   * The tables already exist in the live database (they were created by
--     earlier SQL notes / the app). This file only enables RLS and adds
--     policies; it does not create tables (except the public_profiles view).
--   * The service role BYPASSES RLS. All edge functions use the service-role
--     key, so server-side money flows, admin reads and edge-function writes
--     are unaffected by these policies. Only the anon / authenticated
--     (client) roles are restricted here.
--   * If a table's RLS is off, the table is wide open to the anon key no
--     matter what policies exist. Enabling RLS on every table below is the
--     point of this file — verify in the dashboard afterwards that RLS shows
--     as enabled on each table.
--
-- What this file deliberately does NOT do:
--   * Column-level protection for users is done with GRANTs, not RLS:
--     the users SELECT / INSERT / UPDATE grants below list exactly the
--     columns each operation may touch. The prevent_privilege_escalation
--     trigger stays as a backstop for is_admin / is_verified /
--     average_rating / total_reviews (they are not in any client grant).
--   * It cannot compare a row's OLD status with its NEW status inside one
--     policy (USING sees the old row, WITH CHECK sees the new row). The
--     products UPDATE policy therefore constrains the old row (USING) and
--     the new row (WITH CHECK) separately — see the comment on that policy
--     for the one residual gap.
--
-- RUN ORDER — read this before running the file:
--   The users SELECT policy in this file allows any authenticated user to
--   read any row (public columns only — whatsapp is excluded by the
--   column-level grants, not by the policy). The feed, product, saved,
--   transactions, messages and chats pages all read other sellers through
--   PostgREST embedded joins (seller:users(...)), and a join cannot point
--   at a view, so an own-row-only policy would return null seller data
--   everywhere. Run this file, then ship the client build that drops
--   whatsapp from its users selects (order page, transactions page) and
--   reads counterparty numbers through get_counterparty_contact() instead.
--   Between the two, those two pages show 'Number unavailable' rather
--   than a number — that is the fix taking effect before the client
--   catches up, not a regression. Do not "fix" it by granting whatsapp.

-- ======================================================================
-- users
--   SELECT: any row is readable (see the policy) — the feed, product,
--   saved, transactions, messages and chats pages all read other sellers
--   through PostgREST embedded joins (seller:users(...)), and a join
--   cannot point at a view, so an own-row-only policy would return null
--   seller data everywhere. The phone number stays protected by the
--   COLUMN-LEVEL grants below, not by the policy: whatsapp is in NO grant
--   list, so no client role can read it through the table at all (and a
--   select('*') on users fails, because it needs every column).
--   Anon is included in the policy and the SELECT grant on purpose: the
--   logged-out feed renders seller names/avatars, and the pre-login
--   username-availability check on signup runs as anon. Both see only
--   the public columns in the grant list.
--   Counterparty numbers come ONLY from get_counterparty_contact() below;
--   your own number ONLY from get_own_profile().
--   INSERT: id = auth.uid() only, and only the columns the app writes at
--   signup / complete-profile (see the grant list).
--   UPDATE: own row only, and only the columns the app writes
--   (username, full_name, bio, avatar_url, campus, university_id,
--   whatsapp). is_admin / is_verified / average_rating / total_reviews
--   are NOT granted for update; the trigger below stays as backstop.
--   DELETE: no client deletes.
--   NOTE on the REVOKE: the live database may already carry table-level
--   grants on users from before this file existed. A column-level grant
--   does NOT narrow a table-level grant — a role holding UPDATE on the
--   whole table can still update every column — so the REVOKE ALL below
--   is what makes the column lists real. The service role (edge
--   functions) is untouched by this revoke and bypasses RLS.
-- ======================================================================
alter table public.users enable row level security;

-- Any row is readable; the column grants are what keep whatsapp private.
drop policy if exists "users_select_own" on public.users;
drop policy if exists "users_select_any" on public.users;
create policy "users_select_any" on public.users
  for select using (true);

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own" on public.users
  for insert with check (id = auth.uid());

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Column-level grants: the actual protection. REVOKE ALL first so no
-- older table-level grant survives underneath the column lists.
revoke all on public.users from anon, authenticated;
-- SELECT: public profile columns only. whatsapp (and email, if the column
-- exists) are deliberately absent — no client role can read them.
grant select (id, username, full_name, bio, avatar_url, is_verified, is_admin, average_rating, total_reviews, campus, university_id, created_at)
  on public.users to anon, authenticated;
-- INSERT: exactly the columns complete-profile writes (id + the row),
-- plus full_name, which the signup auth trigger writes from
-- user_metadata. The trigger runs as its owner, but full_name is public
-- anyway, so granting it costs nothing and keeps signup working if the
-- trigger ever runs as the caller. No other column is insertable.
grant insert (id, username, full_name, whatsapp, university_id, campus, avatar_url)
  on public.users to authenticated;
-- UPDATE: exactly the columns profile/edit, complete-profile and the
-- avatar backfill write. is_admin / is_verified / average_rating /
-- total_reviews are NOT here; the trigger below is the backstop.
grant update (username, full_name, bio, avatar_url, campus, university_id, whatsapp)
  on public.users to authenticated;

-- Trigger: privilege escalation is impossible from the client even if a
-- future policy is ever loosened. Only the service role (edge functions /
-- admin tooling, JWT role = 'service_role') or a direct database session
-- with no JWT at all (the admin in the SQL editor / psql) may change
-- is_admin, is_verified, average_rating or total_reviews. Every other
-- caller gets an exception and the UPDATE is rolled back.
create or replace function public.prevent_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role calls (edge functions) and direct database access (no
  -- JWT: the admin working in the SQL editor) are allowed through.
  if (auth.jwt() ->> 'role') = 'service_role' or auth.jwt() is null then
    return new;
  end if;
  if old.is_admin is distinct from new.is_admin
     or old.is_verified is distinct from new.is_verified
     or old.average_rating is distinct from new.average_rating
     or old.total_reviews is distinct from new.total_reviews then
    raise exception 'users: is_admin / is_verified / average_rating / total_reviews can only be changed by the service role';
  end if;
  return new;
end;
$$;

drop trigger if exists users_prevent_privilege_escalation on public.users;
create trigger users_prevent_privilege_escalation
  before update on public.users
  for each row execute function public.prevent_privilege_escalation();

-- SECURITY DEFINER helpers — the ONLY client paths to a whatsapp number.
-- Both run as the function owner, so the column grants above do not apply
-- inside them; the functions themselves are the access control.
--   get_own_profile(): the caller's own full row. The edit-profile form
--   needs the owner's own whatsapp, which no client role can SELECT.
--   get_counterparty_contact(p_ref): the OTHER party's whatsapp for a
--   transaction the caller is a party to, else NULL. The order page shows
--   only the other party's number, never both, and never either number
--   to a stranger.
create or replace function public.get_own_profile()
returns setof public.users
language sql
security definer
stable
set search_path = public
as $$
  select * from public.users where id = auth.uid();
$$;
grant execute on function public.get_own_profile() to authenticated;

create or replace function public.get_counterparty_contact(p_ref text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case
    when t.user_id = auth.uid() then
      (select u.whatsapp from public.users u where u.id = t.seller_id)
    when t.seller_id = auth.uid() then
      (select u.whatsapp from public.users u where u.id = t.user_id)
    else null
  end
  from public.transactions t
  where t.reference = p_ref;
$$;
grant execute on function public.get_counterparty_contact(text) to authenticated;

-- Public profiles view — the contract for other-user lookups that do NOT
-- go through an embedded join (profile page, product page seller card,
-- chat partner header). The embedded joins read the users table directly
-- under the policy above; this view is kept for the direct lookups.
--   * security_invoker = false: the view runs as its OWNER (the role that
--     runs this file in the SQL editor), so the users SELECT policy above
--     does NOT apply inside the view. The view itself is the access
--     control: it exposes ONLY these columns — no whatsapp, no email.
--   * bio / university_id / campus / created_at are public, non-sensitive
--     profile fields (the profile page shows them for other sellers).
--   * Explicit GRANT so anon + authenticated can read it.
drop view if exists public.public_profiles;
create view public.public_profiles with (security_invoker = false) as
  select id, username, full_name, avatar_url, is_verified, is_admin,
         average_rating, total_reviews, bio, university_id, campus, created_at
  from public.users;
grant select on public.public_profiles to anon, authenticated;

-- ======================================================================
-- products
--   SELECT: public for ACTIVE / APPROVED (+ SOLD < 24h, so a just-sold
--   listing still renders while the buyer checks out); the seller sees
--   their own rows of any status.
--   INSERT: seller_id = auth.uid(), status whitelisted. SOLD and APPROVED
--   are NOT insertable by a client: SOLD is set only by the escrow
--   functions (service role) and APPROVED only by the 30-day aging SQL.
--   DRAFT / REJECTED / ACTIVE are in the whitelist because
--   submitProductAction (src/features/seller/actions.ts) writes them
--   through the SAME browser client: DRAFT on draft save (:122), REJECTED
--   when the AI rejects (:148-149), ACTIVE when the AI approves (:152-154).
--   RLS cannot tell that call apart from a raw insert, so the AI gate
--   lives in the action; this policy is the backstop against SOLD /
--   APPROVED fabrication.
--   UPDATE: own rows only. USING restricts the OLD status to the editable
--   set (ACTIVE / APPROVED / PENDING_REVIEW / DRAFT) — a SOLD or REJECTED
--   listing can never be edited back to life (audit H3). WITH CHECK
--   restricts the NEW status to that set plus SOLD and REJECTED.
--   REJECTED is allowed as a new status because the AI-reject-on-edit path
--   writes it; it is one-way, since USING blocks any edit FROM rejected.
--   Residual gap (RLS cannot compare old vs new in one policy): a
--   PENDING_REVIEW / DRAFT row could be flipped straight to SOLD. The
--   client only offers mark-sold on ACTIVE listings, and the money
--   functions re-check ownership and status server-side.
--   DELETE: own rows only.
-- ======================================================================
alter table public.products enable row level security;

drop policy if exists "products_select_public_or_own" on public.products;
create policy "products_select_public_or_own" on public.products
  for select using (
    status = 'ACTIVE'
    or status = 'APPROVED'
    or (status = 'SOLD' and updated_at > now() - interval '24 hours')
    or seller_id = auth.uid()
  );

drop policy if exists "products_insert_seller" on public.products;
create policy "products_insert_seller" on public.products
  for insert with check (
    seller_id = auth.uid()
    and status in ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED')
  );

drop policy if exists "products_update_seller" on public.products;
create policy "products_update_seller" on public.products
  for update
  using (
    seller_id = auth.uid()
    and status in ('ACTIVE', 'APPROVED', 'PENDING_REVIEW', 'DRAFT')
  )
  with check (
    seller_id = auth.uid()
    and status in ('ACTIVE', 'APPROVED', 'PENDING_REVIEW', 'DRAFT', 'SOLD', 'REJECTED')
  );

drop policy if exists "products_delete_seller" on public.products;
create policy "products_delete_seller" on public.products
  for delete using (seller_id = auth.uid());

-- ======================================================================
-- product_views
--   INSERT: viewer_id must be the caller, OR NULL for a logged-out
--   viewer (the user's call, 2026-11-11 — anonymous views stay,
--   exactly as before the H6 fix: they encourage sellers and make a
--   new marketplace look alive instead of dry). A client-supplied
--   viewer_id for someone else is rejected. The product page and the
--   impression tracker record anonymous views with a NULL viewer_id.
--   SELECT: own rows only. Counts are served by the SECURITY DEFINER RPCs
--   (feed_products / product_engagement), never by a client read.
--   UPDATE / DELETE: none.
--   NOTE: the per-day dedupe is a unique index in security-hardening.sql;
--   it is partial (viewer_id IS NOT NULL), so anonymous NULL rows are
--   distinct from each other and are never blocked by it.
-- ======================================================================
alter table public.product_views enable row level security;

drop policy if exists "product_views_insert_own_or_anon" on public.product_views;
drop policy if exists "product_views_insert_own" on public.product_views;
create policy "product_views_insert_own_or_anon" on public.product_views
  for insert with check (
    (viewer_id = auth.uid() or viewer_id is null)
    and exists (select 1 from public.products p where p.id = product_id)
  );

drop policy if exists "product_views_select_own" on public.product_views;
create policy "product_views_select_own" on public.product_views
  for select using (viewer_id = auth.uid());

-- ======================================================================
-- product_image_embeddings — FAIL-CLOSED.
--   RLS is enabled and ZERO policies are created on purpose. No client
--   role (anon or authenticated) can read, insert, update or delete a row.
--   Only the service role — i.e. the embed-listing / visual-search edge
--   functions — can touch this table. If a policy is ever added here in
--   the dashboard, embeddings (the raw vectors behind visual search)
--   become readable: do not add one.
-- ======================================================================
alter table public.product_image_embeddings enable row level security;

-- ======================================================================
-- transactions
--   SELECT: buyer (user_id) or seller (seller_id) only.
--   INSERT / UPDATE / DELETE: NO client access at all. Every transaction
--   row is written by an edge function with the service role.
--   NOTE: the client also queries by wallet_id (transactions page); that
--   still works because each row carries user_id = the wallet owner.
-- ======================================================================
alter table public.transactions enable row level security;

drop policy if exists "transactions_select_party" on public.transactions;
create policy "transactions_select_party" on public.transactions
  for select using (user_id = auth.uid() or seller_id = auth.uid());

-- ======================================================================
-- wallets
--   SELECT: own row only. NO client writes of any kind — balances move
--   only through edge functions (service role).
-- ======================================================================
alter table public.wallets enable row level security;

drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own" on public.wallets
  for select using (user_id = auth.uid());

-- ======================================================================
-- admin_threads — real admin-to-user conversations (built 2026-11-11).
--   The "Message user" button used to open chats with a SYNTHETIC ref
--   (admin-<adminId>-<userId>) that has no transactions row, so the
--   messages INSERT policy below rejected those messages. A thread is
--   now a real row: one per (admin, user) pair, created on demand by
--   get_or_create_admin_thread() below. Messages in a thread carry
--   admin_thread_id (and a NULL transaction_ref); the messages INSERT
--   policy accepts them when the sender AND the receiver are the two
--   parties of the thread.
--   RLS: a party (admin or user) can SELECT their threads. NO client
--   INSERT / UPDATE / DELETE — threads are created only through the
--   SECURITY DEFINER function below (which checks is_admin), so a
--   non-admin can never mint a thread or impersonate an admin.
--   The table + function + messages column only take effect when this
--   file is run in the SQL editor. The messages INSERT policy below
--   references admin_threads, so this section must run BEFORE it —
--   which it does, sitting just above the messages section.
-- ======================================================================
create table if not exists public.admin_threads (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (admin_id, user_id)
);

alter table public.admin_threads enable row level security;

drop policy if exists "admin_threads_select_party" on public.admin_threads;
create policy "admin_threads_select_party" on public.admin_threads
  for select using (admin_id = auth.uid() or user_id = auth.uid());

-- Messages in a thread point at it; a thread message has NO
-- transaction_ref, so that column must accept NULL. This is a no-op if
-- it already does — but the thread insert fails outright if it is
-- NOT NULL, so say so explicitly.
alter table public.messages
  add column if not exists admin_thread_id uuid references public.admin_threads (id) on delete cascade;
alter table public.messages
  alter column transaction_ref drop not null;

-- get_or_create_admin_thread(p_user_id): the ONLY way a thread comes
-- into being. SECURITY DEFINER (bypasses RLS for the insert), but the
-- admin check inside is the lock: the caller must be an admin
-- (users.is_admin), the other party must be a real user, and the
-- thread is always (caller, p_user_id) — the caller cannot mint a
-- thread for two other people, or as someone else. Returns the thread
-- id, creating the row if missing (ON CONFLICT on the unique pair
-- makes concurrent creates safe).
create or replace function public.get_or_create_admin_thread(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
begin
  if v_admin is null then
    raise exception 'not authenticated';
  end if;
  if p_user_id is null or p_user_id = v_admin then
    raise exception 'invalid thread user';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'user not found';
  end if;
  if not exists (select 1 from public.users u where u.id = v_admin and u.is_admin) then
    raise exception 'only admins can open an admin thread';
  end if;
  insert into public.admin_threads (admin_id, user_id)
  values (v_admin, p_user_id)
  on conflict (admin_id, user_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.admin_threads
    where admin_id = v_admin and user_id = p_user_id;
  end if;
  return v_id;
end;
$$;
grant execute on function public.get_or_create_admin_thread(uuid) to authenticated;

-- ======================================================================
-- messages
--   SELECT: sender or receiver only.
--   INSERT: sender_id must be the caller, AND both the sender and the
--   receiver must be a party (buyer/seller) of the transaction named by
--   transaction_ref. A stranger who guesses a reference cannot read or
--   post in the deal (audit C6).
--   ADMIN THREADS: a message may also belong to an admin_threads row
--   (admin_thread_id, transaction_ref NULL) — see the admin_threads
--   section just above. The sender AND the receiver must be the two
--   parties of that thread. The old synthetic refs
--   (admin-<adminId>-<userId>) are gone: they had no transactions row,
--   so this policy rejected them, and no client code creates them
--   anymore. Do not "fix" a rejected admin message by loosening this
--   policy — the thread mechanism is the fix.
--   UPDATE: split by party. RLS cannot restrict WHICH columns an UPDATE
--   touches, so the split is by who may update at all: the sender may
--   update their own messages (content edits / is_deleted, as the client
--   does), the receiver may update messages sent to them (status flips to
--   delivered / read, as the client does). The 30-minute edit window is
--   enforced by the messages_edit_window trigger below (audit H4): it
--   blocks content/is_deleted changes on messages older than 30 minutes
--   and never touches status flips.
--   DELETE: none (client "delete" is an UPDATE setting is_deleted).
-- ======================================================================
alter table public.messages enable row level security;

drop policy if exists "messages_select_party" on public.messages;
create policy "messages_select_party" on public.messages
  for select using (sender_id = auth.uid() or receiver_id = auth.uid());

drop policy if exists "messages_insert_as_party" on public.messages;
create policy "messages_insert_as_party" on public.messages
  for insert with check (
    sender_id = auth.uid()
    -- A message belongs to exactly one conversation: a transaction
    -- (transaction_ref) or an admin thread (admin_thread_id).
    and (transaction_ref is not null) <> (admin_thread_id is not null)
    and (
      exists (
        select 1 from public.transactions t
        where t.reference = transaction_ref
          and (t.user_id = auth.uid() or t.seller_id = auth.uid())
          and (t.user_id = receiver_id or t.seller_id = receiver_id)
      )
      or exists (
        select 1 from public.admin_threads at
        where at.id = admin_thread_id
          and (at.admin_id = auth.uid() or at.user_id = auth.uid())
          and (at.admin_id = receiver_id or at.user_id = receiver_id)
      )
    )
  );

drop policy if exists "messages_update_sender" on public.messages;
create policy "messages_update_sender" on public.messages
  for update using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists "messages_update_receiver" on public.messages;
create policy "messages_update_receiver" on public.messages
  for update using (receiver_id = auth.uid())
  with check (receiver_id = auth.uid());

-- H4: server-side 30-minute edit window (audit H4). The app hides the
-- edit/delete menu after 30 minutes, but that is UI-only — a direct call
-- could rewrite a message hours later ("yes, I accept ₦5,000"). This
-- trigger is the server-side backstop. It blocks ONLY changes to the
-- message text (content) and deletes (is_deleted) once the message is
-- older than 30 minutes. Status flips (sent -> delivered -> read) never
-- touch those columns, so the delivery detector in AppShell, the inbox
-- sweep and the room's read receipts keep working at any age. A delete
-- clears content in the same update, so a late delete is blocked too —
-- matching the app's own menu, which hides delete after the same
-- 30 minutes. Edits/deletes inside the window are unaffected.
create or replace function public.prevent_late_message_edit()
returns trigger
language plpgsql
as $$
begin
  if (new.content is distinct from old.content
      or new.is_deleted is distinct from old.is_deleted)
     and old.created_at < now() - interval '30 minutes' then
    raise exception 'Message can only be edited or deleted within 30 minutes of sending';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_edit_window on public.messages;
create trigger messages_edit_window
  before update on public.messages
  for each row execute function public.prevent_late_message_edit();

-- ======================================================================
-- message_reactions
--   All operations: user_id = auth.uid(), and only on a message the
--   caller participates in (sender or receiver). One row per
--   (message_id, user_id) is enforced by the client's onConflict upsert;
--   the policy is the backstop.
-- ======================================================================
alter table public.message_reactions enable row level security;

drop policy if exists "message_reactions_select_participant" on public.message_reactions;
create policy "message_reactions_select_participant" on public.message_reactions
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  );

drop policy if exists "message_reactions_insert_participant" on public.message_reactions;
create policy "message_reactions_insert_participant" on public.message_reactions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  );

drop policy if exists "message_reactions_update_own" on public.message_reactions;
create policy "message_reactions_update_own" on public.message_reactions
  for update
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  )
  with check (user_id = auth.uid());

drop policy if exists "message_reactions_delete_own" on public.message_reactions;
create policy "message_reactions_delete_own" on public.message_reactions
  for delete using (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  );

-- ======================================================================
-- notifications
--   SELECT / UPDATE: own rows only (mark-read). NO client INSERT — bell
--   rows are written by edge functions (service role) only — and NO
--   client DELETE.
-- ======================================================================
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ======================================================================
-- notification_preferences — all operations: user_id = auth.uid() only.
-- ======================================================================
alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_select_own" on public.notification_preferences;
create policy "notification_preferences_select_own" on public.notification_preferences
  for select using (user_id = auth.uid());

drop policy if exists "notification_preferences_insert_own" on public.notification_preferences;
create policy "notification_preferences_insert_own" on public.notification_preferences
  for insert with check (user_id = auth.uid());

drop policy if exists "notification_preferences_update_own" on public.notification_preferences;
create policy "notification_preferences_update_own" on public.notification_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notification_preferences_delete_own" on public.notification_preferences;
create policy "notification_preferences_delete_own" on public.notification_preferences
  for delete using (user_id = auth.uid());

-- ======================================================================
-- user_push_tokens — all operations: user_id = auth.uid() only.
-- (Uniqueness of (user_id, token) is a unique index in
-- security-hardening.sql.)
-- ======================================================================
alter table public.user_push_tokens enable row level security;

drop policy if exists "user_push_tokens_select_own" on public.user_push_tokens;
create policy "user_push_tokens_select_own" on public.user_push_tokens
  for select using (user_id = auth.uid());

drop policy if exists "user_push_tokens_insert_own" on public.user_push_tokens;
create policy "user_push_tokens_insert_own" on public.user_push_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists "user_push_tokens_update_own" on public.user_push_tokens;
create policy "user_push_tokens_update_own" on public.user_push_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "user_push_tokens_delete_own" on public.user_push_tokens;
create policy "user_push_tokens_delete_own" on public.user_push_tokens
  for delete using (user_id = auth.uid());

-- ======================================================================
-- verifications
--   SELECT: own rows only (+ admin reads go through the service role,
--   which bypasses RLS — RLS cannot cheaply see is_admin on the users
--   row, so there is no in-policy admin exception).
--   INSERT / UPDATE / DELETE: NO client access at all. Applications are
--   filed by an edge function with the service role AFTER the fee is
--   confirmed (audit H9); approval / rejection is a privileged action.
--   NOTE: the client currently inserts verifications rows directly
--   (verification page). That insert WILL FAIL once this file is run —
--   that is the fix, and the client-side insert is being removed in
--   parallel. Do not re-add a client INSERT policy to work around it.
-- ======================================================================
alter table public.verifications enable row level security;

drop policy if exists "verifications_select_own" on public.verifications;
create policy "verifications_select_own" on public.verifications
  for select using (user_id = auth.uid());

-- ======================================================================
-- disputes
--   SELECT: buyer or seller only. NO client INSERT / UPDATE / DELETE —
--   disputes are raised and cancelled through edge functions
--   (service role), which check ownership and state server-side.
-- ======================================================================
alter table public.disputes enable row level security;

drop policy if exists "disputes_select_party" on public.disputes;
create policy "disputes_select_party" on public.disputes
  for select using (buyer_id = auth.uid() or seller_id = auth.uid());

-- ======================================================================
-- product_reviews (questions / answers on a listing)
--   SELECT: public — questions are listing content, shown to anyone on
--   the product page and the seller Q&A page.
--   INSERT: user_id = auth.uid(), and the product must be ACTIVE or
--   APPROVED (no questions on drafts / rejected / sold listings).
--   UPDATE / DELETE: own rows only.
-- ======================================================================
alter table public.product_reviews enable row level security;

drop policy if exists "product_reviews_select_public" on public.product_reviews;
create policy "product_reviews_select_public" on public.product_reviews
  for select using (true);

drop policy if exists "product_reviews_insert_own_live_product" on public.product_reviews;
create policy "product_reviews_insert_own_live_product" on public.product_reviews
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.products p
      where p.id = product_id and p.status in ('ACTIVE', 'APPROVED')
    )
  );

drop policy if exists "product_reviews_update_own" on public.product_reviews;
create policy "product_reviews_update_own" on public.product_reviews
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "product_reviews_delete_own" on public.product_reviews;
create policy "product_reviews_delete_own" on public.product_reviews
  for delete using (user_id = auth.uid());

-- ======================================================================
-- seller_reviews
--   SELECT: public — reviews are shown on seller profiles.
--   INSERT: buyer_id = auth.uid(), the seller must exist, and a buyer
--   cannot review themselves. One review per (buyer, seller) pair is a
--   unique index in security-hardening.sql.
--   UPDATE / DELETE: own rows only (the buyer who wrote it).
-- ======================================================================
alter table public.seller_reviews enable row level security;

drop policy if exists "seller_reviews_select_public" on public.seller_reviews;
create policy "seller_reviews_select_public" on public.seller_reviews
  for select using (true);

drop policy if exists "seller_reviews_insert_own" on public.seller_reviews;
create policy "seller_reviews_insert_own" on public.seller_reviews
  for insert with check (
    buyer_id = auth.uid()
    and buyer_id <> seller_id
    and exists (select 1 from public.users u where u.id = seller_id)
  );

drop policy if exists "seller_reviews_update_own" on public.seller_reviews;
create policy "seller_reviews_update_own" on public.seller_reviews
  for update using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());

drop policy if exists "seller_reviews_delete_own" on public.seller_reviews;
create policy "seller_reviews_delete_own" on public.seller_reviews
  for delete using (buyer_id = auth.uid());

-- ======================================================================
-- search_queries (audit M18 — the policy change lives here AND in
-- popular-searches.sql; both files define the same policy, so running
-- either file keeps the same result).
--   INSERT: authenticated users only — auth.uid() must not be null.
--   (Previously WITH CHECK (true): anyone, including anon, could flood
--   the table with spam / PII queries.)
--   SELECT: NO policy on purpose — nobody reads the raw log from the
--   client; popular searches go through the SECURITY DEFINER
--   popular_searches RPC. The length cap lives in popular-searches.sql.
-- ======================================================================
alter table public.search_queries enable row level security;

drop policy if exists "Anyone can log a search" on public.search_queries;
drop policy if exists "Authenticated users can log a search" on public.search_queries;
create policy "Authenticated users can log a search" on public.search_queries
  for insert with check (auth.uid() is not null);

-- ======================================================================
-- saved_items — all operations: user_id = auth.uid() only.
-- ======================================================================
alter table public.saved_items enable row level security;

drop policy if exists "saved_items_select_own" on public.saved_items;
create policy "saved_items_select_own" on public.saved_items
  for select using (user_id = auth.uid());

drop policy if exists "saved_items_insert_own" on public.saved_items;
create policy "saved_items_insert_own" on public.saved_items
  for insert with check (user_id = auth.uid());

drop policy if exists "saved_items_update_own" on public.saved_items;
create policy "saved_items_update_own" on public.saved_items
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "saved_items_delete_own" on public.saved_items;
create policy "saved_items_delete_own" on public.saved_items
  for delete using (user_id = auth.uid());

-- ======================================================================
-- platform_settings
--   SELECT: read-only for anon and authenticated (the client reads the
--   fee row id = 1). NO client INSERT / UPDATE / DELETE — settings change
--   only via the service role (admin dashboard / SQL editor).
-- ======================================================================
alter table public.platform_settings enable row level security;

drop policy if exists "platform_settings_select_public" on public.platform_settings;
create policy "platform_settings_select_public" on public.platform_settings
  for select using (true);

-- ======================================================================
-- user_reports / chat_reports / products_report
--   INSERT: reporter_id = auth.uid(), status forced 'pending'.
--   SELECT / UPDATE / DELETE: none for clients — reports are read and
--   actioned by admins through the service role.
--   NOTE: products_report's client insert omits status, so the column is
--   added here if it does not exist yet (with a 'pending' default, so
--   older rows also satisfy the policy). user_reports / chat_reports
--   already carry a status column (their client inserts pass it).
-- ======================================================================
alter table public.user_reports enable row level security;
alter table public.chat_reports enable row level security;
alter table public.products_report enable row level security;

alter table public.products_report
  add column if not exists status text not null default 'pending';

drop policy if exists "user_reports_insert_own_pending" on public.user_reports;
create policy "user_reports_insert_own_pending" on public.user_reports
  for insert with check (reporter_id = auth.uid() and status = 'pending');

drop policy if exists "chat_reports_insert_own_pending" on public.chat_reports;
create policy "chat_reports_insert_own_pending" on public.chat_reports
  for insert with check (reporter_id = auth.uid() and status = 'pending');

drop policy if exists "products_report_insert_own_pending" on public.products_report;
create policy "products_report_insert_own_pending" on public.products_report
  for insert with check (reporter_id = auth.uid() and status = 'pending');

-- ======================================================================
-- order_cancellations — FAIL-CLOSED.
--   RLS is enabled and ZERO policies are created on purpose. No client
--   role can read, insert, update or delete a row. Only the service role
--   (cancel-escrow edge function) writes here; admin reads go through
--   the service role as well. Do not add a client policy.
-- ======================================================================
alter table public.order_cancellations enable row level security;

-- ======================================================================
-- ANON-KEY TESTS (run after this file, per table — both must fail)
-- ----------------------------------------------------------------------
-- For each table below, run the two checks (a) as the anon key and
-- (b) as a second, logged-in test user. Both must fail. If either
-- succeeds, that table is still open — re-check RLS is enabled and
-- that no extra policy was added in the dashboard.
--
--   users:
--     select username, avatar_url from users limit 5;     -- OK, public cols only
--     select whatsapp from users;                         -- ERROR (no column grant)
--     select * from users where id <> '<your-own-id>';    -- ERROR (select * needs every column)
--     select * from get_own_profile();                    -- OK, own full row incl. whatsapp
--     select get_counterparty_contact('<own-ref>');       -- OK, other party's number
--     select get_counterparty_contact('<stranger-ref>');  -- NULL (not a party)
--     update users set full_name = 'pwned' where id <> '<own>'; -- 0 rows (policy)
--     update users set is_admin = true where id = '<own>';      -- ERROR (no column grant + trigger)
--     update users set whatsapp = '080...' where id = '<own>';  -- OK (own row, granted column)
--   public_profiles:
--     select * from public_profiles limit 5;                    -- OK, public cols only
--   products:
--     select * from products where status = 'DRAFT';            -- 0 rows (unless own)
--     delete from products where seller_id <> '<own>';          -- 0 rows
--     update products set status = 'ACTIVE' where status = 'REJECTED'; -- 0 rows
--   product_views:
--     select * from product_views;                              -- own rows only
--     insert into product_views (product_id, viewer_id)
--       values ('<any-product>', '<someone-else>');             -- ERROR
--     insert into product_views (product_id, viewer_id)
--       values ('<any-product>', null);                        -- OK (anonymous views count)
--   product_image_embeddings:
--     select * from product_image_embeddings;                   -- ERROR / 0 rows
--   transactions:
--     select * from transactions
--       where user_id <> '<own>' and seller_id <> '<own>';      -- 0 rows
--     insert into transactions (reference) values ('x');        -- ERROR
--   wallets:
--     select * from wallets where user_id <> '<own>';           -- 0 rows
--     update wallets set balance = 999999 where user_id = '<own>'; -- ERROR (no policy)
--   messages:
--     select * from messages
--       where sender_id <> '<own>' and receiver_id <> '<own>';  -- 0 rows
--     insert into messages (transaction_ref, sender_id, receiver_id,
--       content, message_type, status)
--       values ('<victim-ref>', '<own>', '<victim>', 'hi', 'text', 'sent'); -- ERROR
--     -- admin threads: select * from admin_threads;               -- own threads only
--     --   (as a non-admin) select get_or_create_admin_thread('<user-id>'); -- ERROR (only admins)
--     insert into messages (admin_thread_id, sender_id, receiver_id,
--       content, message_type, status)
--       values ('<thread-id>', '<own>', '<other-party>', 'hi', 'text', 'sent'); -- OK only when you are a party to the thread
--   message_reactions:
--     delete from message_reactions where user_id <> '<own>';   -- 0 rows
--   notifications:
--     select * from notifications where user_id <> '<own>';     -- 0 rows
--     insert into notifications (user_id, title) values ('<own>', 'x'); -- ERROR
--   notification_preferences / user_push_tokens:
--     select * from user_push_tokens where user_id <> '<own>';  -- 0 rows
--     insert into user_push_tokens (user_id, token)
--       values ('<someone-else>', 'x');                         -- ERROR
--   verifications:
--     select * from verifications where user_id <> '<own>';     -- 0 rows
--     insert into verifications (user_id, status, fee_paid)
--       values ('<own>', 'pending', true);                      -- ERROR
--   disputes:
--     select * from disputes
--       where buyer_id <> '<own>' and seller_id <> '<own>';     -- 0 rows
--   product_reviews / seller_reviews:
--     insert into product_reviews (product_id, user_id, content)
--       values ('<draft-product>', '<own>', 'x');               -- ERROR (not live)
--     insert into seller_reviews (seller_id, buyer_id, rating)
--       values ('<seller>', '<someone-else>', 5);               -- ERROR
--   search_queries:
--     select * from search_queries;                             -- ERROR / 0 rows
--     -- (anon) insert into search_queries (query) values ('x');-- ERROR
--   saved_items:
--     select * from saved_items where user_id <> '<own>';       -- 0 rows
--   platform_settings:
--     select * from platform_settings;                          -- OK (read-only)
--     update platform_settings set id = 1 where id = 1;        -- ERROR (no policy)
--   user_reports / chat_reports / products_report:
--     select * from user_reports;                               -- ERROR / 0 rows
--     insert into user_reports (reporter_id, reported_user_id,
--       reason, status) values ('<someone-else>', '<own>', 'x', 'pending'); -- ERROR
--   order_cancellations:
--     select * from order_cancellations;                        -- ERROR / 0 rows
--     insert into order_cancellations (transaction_ref) values ('x'); -- ERROR
-- ======================================================================
