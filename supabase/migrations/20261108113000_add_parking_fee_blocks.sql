-- Flexible, multi-currency parking fee steps (one-time and recurring intervals).
ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS parking_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.superchargers.parking_blocks IS
  'Ordered parking fee steps with afterMinutes, durationMinutes, amount, currency, label and repeat.';
