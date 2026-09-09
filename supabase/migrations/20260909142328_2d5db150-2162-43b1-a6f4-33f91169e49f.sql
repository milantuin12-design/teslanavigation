CREATE TABLE public.vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL DEFAULT 'Tesla',
  model text NOT NULL,
  trim text,
  battery_kwh numeric,
  usable_kwh numeric,
  range_km integer,
  consumption_kwh100 numeric,
  year_from integer,
  year_to integer,
  max_charge_kw integer,
  connectors text[] NOT NULL DEFAULT '{Type 2,CCS}'::text[],
  image_url text,
  notes text,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vehicle_models TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_models TO authenticated;
GRANT ALL ON public.vehicle_models TO service_role;

ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone reads published vehicle models"
  ON public.vehicle_models FOR SELECT
  TO anon, authenticated
  USING (published = true OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage vehicle models"
  ON public.vehicle_models FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER vehicle_models_set_updated_at
  BEFORE UPDATE ON public.vehicle_models
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon;

INSERT INTO public.vehicle_models (brand, model, trim, battery_kwh, usable_kwh, range_km, consumption_kwh100, year_from, max_charge_kw, connectors) VALUES
 ('Tesla','Model 3','RWD',60,57.5,385,15.0,2021,170,'{Type 2,CCS}'),
 ('Tesla','Model 3','Long Range RWD',79,75,580,13.0,2023,250,'{Type 2,CCS}'),
 ('Tesla','Model 3','Long Range AWD',79,75,495,15.2,2021,250,'{Type 2,CCS}'),
 ('Tesla','Model 3','Performance',79,75,410,18.3,2021,250,'{Type 2,CCS}'),
 ('Tesla','Model Y','RWD',60,57.5,340,17.0,2022,170,'{Type 2,CCS}'),
 ('Tesla','Model Y','Long Range RWD',79,75,490,15.3,2023,250,'{Type 2,CCS}'),
 ('Tesla','Model Y','Long Range AWD',79,75,440,17.0,2021,250,'{Type 2,CCS}'),
 ('Tesla','Model Y','Performance',79,75,410,18.3,2022,250,'{Type 2,CCS}'),
 ('Tesla','Model S','Long Range',100,95,540,17.6,2021,250,'{Type 2,CCS}'),
 ('Tesla','Model S','Plaid',100,95,485,19.6,2021,250,'{Type 2,CCS}'),
 ('Tesla','Model X','Long Range',100,95,480,19.8,2021,250,'{Type 2,CCS}'),
 ('Tesla','Model X','Plaid',100,95,430,22.1,2021,250,'{Type 2,CCS}');