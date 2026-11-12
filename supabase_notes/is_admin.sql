-- supabase_notes/is_admin.sql
-- Run in the Supabase SQL editor (one-time setup for the admin "Message user" button).
-- Draft prepared 2026-11-08; NOT yet run. Aide to run it himself.

-- 1. Flag on users. No is_admin column exists in the repo yet (checked 2026-11-08,
-- clone at fb04671: zero matches for is_admin).
alter table public.users
  add column if not exists is_admin boolean not null default false;

-- 2. Activate it for Aide's account only.
-- FILL IN: replace '<AIDE_AUTH_USER_ID>' with Aide's auth user UUID from
-- Supabase Dashboard -> Authentication -> Users (the id of his account).
-- Do NOT guess it; the wrong id would flag the wrong account.
update public.users
  set is_admin = true
  where id = '<AIDE_AUTH_USER_ID>';

-- 3. Verify (should return exactly one row, Aide's):
-- select id, username, full_name, is_admin from public.users where is_admin = true;

-- CHECK BEFORE SHIPPING (dashboard-side, not verifiable from the repo clone):
-- a) users UPDATE must not be open to any authenticated user, or anyone could
--    set their own is_admin = true. Confirm in Supabase -> Table Editor -> users
--    -> RLS policies that UPDATE is restricted (admin/service role only).
-- b) messages RLS: the "Message user" button plans to open /chats with a synthetic
--    ref (e.g. admin-<adminId>-<userId>) because admin chats have no transaction.
--    If the messages INSERT/SELECT policies require the sender to be a participant
--    of a real transactions row for that reference, the synthetic ref will fail
--    and the admin chat needs a different mechanism instead. Check the messages
--    policies in the dashboard before building on the synthetic ref.
