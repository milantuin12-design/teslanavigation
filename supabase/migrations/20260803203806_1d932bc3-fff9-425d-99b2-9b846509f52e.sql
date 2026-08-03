CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-reopen-superchargers') THEN
    PERFORM cron.unschedule('auto-reopen-superchargers');
  END IF;
END
$$;

SELECT cron.schedule(
  'auto-reopen-superchargers',
  '* * * * *',
  $$SELECT public.auto_reopen_chargers();$$
);