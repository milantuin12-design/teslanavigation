ALTER TABLE public.superchargers
ADD COLUMN IF NOT EXISTS charger_configs jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.superchargers.charger_configs IS 'Structured charger groups, e.g. [{"version":"V3","count":16,"speedKw":250}].';