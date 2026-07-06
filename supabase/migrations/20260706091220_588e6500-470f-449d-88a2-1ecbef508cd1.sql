
ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS parking_fee boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_parking_garage boolean NOT NULL DEFAULT false;

-- Normalize V4 speeds: 325 -> 250
UPDATE public.superchargers
SET max_speed_kw = 250
WHERE max_speed_kw = 325;

UPDATE public.superchargers
SET charger_configs = (
  SELECT jsonb_agg(
    CASE
      WHEN (elem->>'speedKw')::int = 325 THEN jsonb_set(elem, '{speedKw}', to_jsonb(250))
      ELSE elem
    END
  )
  FROM jsonb_array_elements(charger_configs::jsonb) elem
)
WHERE charger_configs IS NOT NULL
  AND jsonb_typeof(charger_configs::jsonb) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(charger_configs::jsonb) e
    WHERE (e->>'speedKw')::int = 325
  );
