-- supabase_notes/reconcile-sweep-schedule.sql
--
-- Scheduled sweep for stuck withdrawals: calls the reconcile-withdrawals
-- edge function every 15 minutes with the CRON_SECRET, so pending
-- withdrawals older than 5 minutes get checked against Monnify and settled
-- (paid -> successful, failed/never sent -> refunded, unclear -> stays
-- pending for a human). The function caps at 20 rows per run, oldest first.
--
-- HOW TO RUN (SQL editor only):
--   1. Set CRON_SECRET in Dashboard -> Edge Functions -> Secrets (if not done).
--   2. Replace <CRON_SECRET> below with the real value.
--   3. Run this whole file once in the SQL editor. Re-runnable (it removes
--      any previous version of the job first, so it never duplicates).
--   4. Check the job exists: the last query lists it. Then watch the
--      reconcile-withdrawals function logs on the next run.
--   5. To stop it: select cron.unschedule('reconcile-withdrawals-sweep');
--   6. To change the interval, edit '*/15 * * * *' and re-run.
--
-- NEVER commit the filled-in version (it contains the secret). This file
-- with the <CRON_SECRET> placeholder is safe to commit.
--
-- Requires the pg_cron and pg_net extensions. Enable them first in
-- Dashboard -> Database -> Extensions if the CREATE EXTENSION lines below
-- are not allowed for your role.
-- NOTE: reconcile-withdrawals has verify_jwt = false in config.toml, so the
-- gateway passes the Bearer <CRON_SECRET> header through to the function,
-- which checks it itself. Do NOT turn verify_jwt on for this function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of this job so re-runs don't duplicate it.
-- Guarded: cron.unschedule('name') ERRORS when the job doesn't exist yet,
-- so unschedule by id only where a matching job actually exists (a no-op
-- on the first run, removes the old job on re-runs).
select cron.unschedule(jobid) from cron.job where jobname = 'reconcile-withdrawals-sweep';

select cron.schedule(
  'reconcile-withdrawals-sweep',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://cmwhefqflopywessgcwh.supabase.co/functions/v1/reconcile-withdrawals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Confirm the job was created.
select jobname, schedule, active from cron.job where jobname = 'reconcile-withdrawals-sweep';
