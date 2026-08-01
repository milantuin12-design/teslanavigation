
ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'operational',
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS construction jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS works jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS closure jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.validate_charger_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('operational','construction','works','works_closed','temp_closed','long_closed') THEN
    RAISE EXCEPTION 'Invalid supercharger status: %', NEW.status;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_charger_status_trg ON public.superchargers;
CREATE TRIGGER validate_charger_status_trg
BEFORE INSERT OR UPDATE ON public.superchargers
FOR EACH ROW EXECUTE FUNCTION public.validate_charger_status();

CREATE TABLE IF NOT EXISTS public.charger_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charger_id uuid REFERENCES public.superchargers(id) ON DELETE SET NULL,
  charger_name text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_email text,
  category text NOT NULL DEFAULT 'other',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.charger_reports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charger_reports TO authenticated;
GRANT ALL ON public.charger_reports TO service_role;

ALTER TABLE public.charger_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create reports" ON public.charger_reports
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Users read own reports" ON public.charger_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update reports" ON public.charger_reports
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete reports" ON public.charger_reports
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS charger_reports_updated_at ON public.charger_reports;
CREATE TRIGGER charger_reports_updated_at
BEFORE UPDATE ON public.charger_reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS route_count integer NOT NULL DEFAULT 0;

CREATE POLICY "Admins read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete profiles" ON public.profiles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.superchargers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.charger_reports;
