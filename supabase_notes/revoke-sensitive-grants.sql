-- supabase_notes/revoke-sensitive-grants.sql
--
-- Defense-in-depth lock on the six Edge-Function-only tables.
--
-- WHY: the RLS policies in rls-policies.sql already block client writes on
-- these tables (SELECT-only or own-rows policies, zero policies on
-- order_cancellations). But a policy only matters if the role lacks the
-- underlying GRANT — a role holding a table-level grant can still write
-- wherever a policy allows it, and the live database may carry old
-- table-level grants from before the policies existed. This file removes
-- those grants, so the client roles hold exactly what the app legitimately
-- does, and nothing more. Same revoke-all-then-grant-back pattern as the
-- users table in rls-policies.sql.
--
-- WHAT THE CLIENT LEGITIMATELY DOES (verified against the clone's src/):
--   verifications       SELECT only (profile + verification pages read status)
--   disputes            SELECT only (dispute/disputes/product pages read)
--   admin_threads       SELECT only (chats/messages read own threads)
--   notifications       SELECT + UPDATE is_read (mark-read in notification +
--                       notifications pages; UPDATE granted to authenticated
--                       only — mark-read needs a logged-in user)
--   platform_settings   SELECT only (fee fallback in institutionSettings.ts)
--   order_cancellations NOTHING (zero client references; only the
--                       cancel-escrow edge function writes, via service role)
-- No client INSERT remains anywhere in src/ for these tables (the old
-- verifications insert from the verification page is gone — filing now goes
-- through charge-verification-fee). If a checkout still has a client-side
-- verifications insert, it will fail after this runs — that is the fix.
--
-- WHAT THIS DOES NOT DO:
--   * It does NOT change any RLS policy. Policies stay as they are.
--   * It does NOT touch service_role — Edge Functions keep writing exactly
--     as before (service role bypasses RLS and is not in the revoke list).
--   * Re-running rls-policies.sql does NOT undo this — that file grants
--     nothing on these six tables (its grants are users, public_profiles
--     and function EXECUTEs only).
--
-- RUN: paste into the Supabase SQL editor and run as postgres. Idempotent —
-- safe to re-run. Then run the verification query at the bottom and check
-- every value against the Expected list in its comments. If any Expected
-- value differs, do not proceed to sandbox tests until it is explained.

-- ======================================================================
-- verifications — SELECT only
-- ======================================================================
revoke all on public.verifications from anon, authenticated;
grant select on public.verifications to anon, authenticated;

-- ======================================================================
-- disputes — SELECT only
-- ======================================================================
revoke all on public.disputes from anon, authenticated;
grant select on public.disputes to anon, authenticated;

-- ======================================================================
-- admin_threads — SELECT only
-- ======================================================================
revoke all on public.admin_threads from anon, authenticated;
grant select on public.admin_threads to anon, authenticated;

-- ======================================================================
-- notifications — SELECT + UPDATE (mark-read), UPDATE to authenticated only
-- ======================================================================
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to anon, authenticated;
grant update on public.notifications to authenticated;

-- ======================================================================
-- platform_settings — SELECT only
-- ======================================================================
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to anon, authenticated;

-- ======================================================================
-- order_cancellations — NOTHING (fail-closed; service role only)
-- ======================================================================
revoke all on public.order_cancellations from anon, authenticated;
-- No grant back on purpose. Do not add one.

-- ======================================================================
-- Verification — run this after the revokes above and check every value.
--   select ... (query below)
--
-- Expected:
--   verifications, disputes, admin_threads, platform_settings (both roles):
--     can_select = true, can_insert = false, can_update = false,
--     can_delete = false
--   notifications:
--     anon:          can_select = true,  can_update = false, can_insert = false, can_delete = false
--     authenticated: can_select = true,  can_update = true,  can_insert = false, can_delete = false
--   order_cancellations (both roles):
--     can_select = false, can_insert = false, can_update = false,
--     can_delete = false
-- ======================================================================
select
  t.table_name,
  r.role_name,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'SELECT') as can_select,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'INSERT') as can_insert,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'UPDATE') as can_update,
  has_table_privilege(r.role_name, 'public.' || t.table_name, 'DELETE') as can_delete
from (values
  ('verifications'),
  ('disputes'),
  ('admin_threads'),
  ('notifications'),
  ('platform_settings'),
  ('order_cancellations')
) as t(table_name)
cross join (values ('anon'), ('authenticated')) as r(role_name)
order by t.table_name, r.role_name;
