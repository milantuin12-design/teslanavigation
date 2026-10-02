ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS stall_states jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS permanently_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS voting jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.validate_charger_status()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('operational','construction','works','works_closed','temp_closed','long_closed','voting','plan','permit','expanding','permanent_closed') THEN
    RAISE EXCEPTION 'Invalid supercharger status: %', NEW.status;
  END IF;
  IF NEW.data_source NOT IN ('manual','automatic') THEN
    RAISE EXCEPTION 'Invalid data source: %', NEW.data_source;
  END IF;
  IF NEW.status = 'permanent_closed' AND NEW.permanently_closed_at IS NULL THEN
    NEW.permanently_closed_at = now();
  ELSIF NEW.status <> 'permanent_closed' THEN
    NEW.permanently_closed_at = NULL;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END; $function$;