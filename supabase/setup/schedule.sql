-- Run once on the live project (SQL Editor) to start the nightly automations. Not a migration: it needs the pg_cron and
-- pg_net extensions and this project's address, which the throw-away test database doesn't have.
-- Every night at 01:17 UTC (03:17 Cairo) it calls the "scheduler" server function, which runs date-based automations
-- for every published workspace and writes the run log. The key is read from the database at run time, so it never
-- appears in the job itself.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule('bonyan-automations') where exists (select 1 from cron.job where jobname = 'bonyan-automations');
select cron.schedule(
  'bonyan-automations',
  '17 1 * * *',
  $job$
    select net.http_post(
      url := 'https://npnhoywlxidojqoijqdu.supabase.co/functions/v1/scheduler',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-scheduler-key', (select key from private.scheduler_key)),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
  $job$
);
