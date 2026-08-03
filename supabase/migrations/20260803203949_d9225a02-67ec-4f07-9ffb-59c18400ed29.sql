CREATE OR REPLACE FUNCTION public.auto_reopen_chargers()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.superchargers
  SET status = 'operational',
      is_available = true,
      reopen_at = NULL,
      closure = '{}'::jsonb
  WHERE status = 'temp_closed'
    AND reopen_at IS NOT NULL
    AND reopen_at <= now();
$function$;