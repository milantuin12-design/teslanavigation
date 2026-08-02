-- 1. Owners
CREATE TABLE public.charger_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  logo_url text,
  description text,
  website text,
  contact text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.charger_owners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charger_owners TO authenticated;
GRANT ALL ON public.charger_owners TO service_role;
ALTER TABLE public.charger_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read owners" ON public.charger_owners FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage owners" ON public.charger_owners FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER charger_owners_updated_at BEFORE UPDATE ON public.charger_owners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Supercharger extras
ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.charger_owners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS low_speed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS reopen_at timestamptz,
  ADD COLUMN IF NOT EXISTS planned_upgrade jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP POLICY IF EXISTS "Anyone can read superchargers" ON public.superchargers;
CREATE POLICY "Anyone can read published superchargers" ON public.superchargers
  FOR SELECT TO anon, authenticated
  USING (published = true OR public.has_role(auth.uid(),'admin'));

-- 3. Site updates (news)
CREATE TABLE public.site_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  image_url text,
  importance text NOT NULL DEFAULT 'normal',
  published_at timestamptz NOT NULL DEFAULT now(),
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_updates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_updates TO authenticated;
GRANT ALL ON public.site_updates TO service_role;
ALTER TABLE public.site_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads visible updates" ON public.site_updates FOR SELECT TO anon, authenticated
  USING (visible = true OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage updates" ON public.site_updates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER site_updates_updated_at BEFORE UPDATE ON public.site_updates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Reports: photos + location
ALTER TABLE public.charger_reports
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

-- 5. Admin audit log
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  target_count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit log" ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins write audit log" ON public.admin_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') AND user_id = auth.uid());

-- 6. Auto-reopen function for temporarily closed chargers
CREATE OR REPLACE FUNCTION public.auto_reopen_chargers()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.superchargers
  SET status = 'operational', reopen_at = NULL, closure = '{}'::jsonb
  WHERE status = 'temp_closed' AND reopen_at IS NOT NULL AND reopen_at <= now();
$$;
GRANT EXECUTE ON FUNCTION public.auto_reopen_chargers() TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS superchargers_owner_idx ON public.superchargers(owner_id);
CREATE INDEX IF NOT EXISTS superchargers_published_idx ON public.superchargers(published);