-- Verification one-time fee. Run once.
-- Records that the verification fee was paid, so a rejected applicant can
-- retry without paying again (the fee is one-time per user, not per attempt).
alter table public.verifications
  add column if not exists fee_paid boolean not null default false;
alter table public.verifications
  add column if not exists fee_reference text;
