CREATE TABLE IF NOT EXISTS public.superchargers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  total_stalls integer,
  stall_types text,
  occupied_stalls integer DEFAULT 0,
  country text NOT NULL,
  last_updated timestamptz DEFAULT now()
);

GRANT SELECT ON public.superchargers TO anon, authenticated;
GRANT ALL ON public.superchargers TO service_role;

ALTER TABLE public.superchargers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read superchargers"
  ON public.superchargers FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role can update superchargers"
  ON public.superchargers FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can insert superchargers"
  ON public.superchargers FOR INSERT
  TO service_role
  WITH CHECK (true);