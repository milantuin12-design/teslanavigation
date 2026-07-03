ALTER TABLE public.superchargers
ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.superchargers.is_available IS 'Manual admin availability flag. False means unavailable regardless of opening hours.';