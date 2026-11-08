ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS price_currency text NOT NULL DEFAULT 'EUR';

COMMENT ON COLUMN public.superchargers.price_currency IS
  'ISO 4217 currency used for this Supercharger pricing. Values are converted to EUR for display and route cost calculations.';
