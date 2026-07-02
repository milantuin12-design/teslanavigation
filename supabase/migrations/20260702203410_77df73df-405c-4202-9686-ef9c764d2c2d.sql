
-- Extend superchargers with new fields
ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS max_speed_kw integer,
  ADD COLUMN IF NOT EXISTS versions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS opening_time time,
  ADD COLUMN IF NOT EXISTS closing_time time,
  ADD COLUMN IF NOT EXISTS trailer_friendly boolean NOT NULL DEFAULT false;

-- App role enum + user_roles table
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles select own" ON public.profiles;
CREATE POLICY "Profiles select own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
DROP POLICY IF EXISTS "Profiles update own" ON public.profiles;
CREATE POLICY "Profiles update own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Trigger: auto-create profile + grant admin to purelark3842@outlook.com on verified email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  IF NEW.email_confirmed_at IS NOT NULL AND lower(NEW.email) = 'purelark3842@outlook.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_new_user();

-- Admin write policies on superchargers
GRANT INSERT, UPDATE, DELETE ON public.superchargers TO authenticated;
DROP POLICY IF EXISTS "Admins insert superchargers" ON public.superchargers;
CREATE POLICY "Admins insert superchargers" ON public.superchargers FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins update superchargers" ON public.superchargers;
CREATE POLICY "Admins update superchargers" ON public.superchargers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins delete superchargers" ON public.superchargers;
CREATE POLICY "Admins delete superchargers" ON public.superchargers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Saved routes
CREATE TABLE IF NOT EXISTS public.saved_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_address text,
  start_lat double precision NOT NULL,
  start_lng double precision NOT NULL,
  end_address text,
  end_lat double precision NOT NULL,
  end_lng double precision NOT NULL,
  model_name text NOT NULL,
  battery_percent integer NOT NULL,
  trailer_mode boolean NOT NULL DEFAULT false,
  trailer_reduction integer NOT NULL DEFAULT 0,
  weather_mode text NOT NULL DEFAULT 'summer',
  time_mode text NOT NULL DEFAULT 'day',
  route_type text NOT NULL DEFAULT 'fastest',
  charger_ids uuid[] NOT NULL DEFAULT '{}',
  total_distance_km double precision,
  total_time_min integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_routes TO authenticated;
GRANT ALL ON public.saved_routes TO service_role;
ALTER TABLE public.saved_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own routes" ON public.saved_routes;
CREATE POLICY "Users manage own routes" ON public.saved_routes FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS saved_routes_updated_at ON public.saved_routes;
CREATE TRIGGER saved_routes_updated_at BEFORE UPDATE ON public.saved_routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
