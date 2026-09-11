-- 1. Free-text owner on a charger
ALTER TABLE public.superchargers ADD COLUMN IF NOT EXISTS owner_name text;

-- 2. Supercharger change log
CREATE TABLE IF NOT EXISTS public.charger_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charger_id uuid,
  charger_name text NOT NULL DEFAULT '',
  action text NOT NULL DEFAULT 'update',
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charger_changes_created_at_idx ON public.charger_changes (created_at DESC);
GRANT SELECT ON public.charger_changes TO anon;
GRANT SELECT, INSERT ON public.charger_changes TO authenticated;
GRANT ALL ON public.charger_changes TO service_role;
ALTER TABLE public.charger_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads charger changes" ON public.charger_changes;
CREATE POLICY "Anyone reads charger changes" ON public.charger_changes
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_charger_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  diff jsonb := '{}'::jsonb;
  k text;
  oldj jsonb;
  newj jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.charger_changes (charger_id, charger_name, action, changed_fields, changed_by)
    VALUES (NEW.id, NEW.name, 'create', '{}'::jsonb, auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.charger_changes (charger_id, charger_name, action, changed_fields, changed_by)
    VALUES (OLD.id, OLD.name, 'delete', '{}'::jsonb, auth.uid());
    RETURN OLD;
  END IF;

  oldj := to_jsonb(OLD);
  newj := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(newj) LOOP
    IF k IN ('updated_at', 'last_updated') THEN CONTINUE; END IF;
    IF (oldj -> k) IS DISTINCT FROM (newj -> k) THEN
      diff := diff || jsonb_build_object(k, jsonb_build_object('from', oldj -> k, 'to', newj -> k));
    END IF;
  END LOOP;

  IF diff <> '{}'::jsonb THEN
    INSERT INTO public.charger_changes (charger_id, charger_name, action, changed_fields, changed_by)
    VALUES (NEW.id, NEW.name, 'update', diff, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_charger_change_trg ON public.superchargers;
CREATE TRIGGER log_charger_change_trg
AFTER INSERT OR UPDATE OR DELETE ON public.superchargers
FOR EACH ROW EXECUTE FUNCTION public.log_charger_change();

-- 3. Chat on reports
CREATE TABLE IF NOT EXISTS public.report_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.charger_reports(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_admin boolean NOT NULL DEFAULT false,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_messages_report_idx ON public.report_messages (report_id, created_at);
GRANT SELECT, INSERT ON public.report_messages TO authenticated;
GRANT ALL ON public.report_messages TO service_role;
ALTER TABLE public.report_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read own report messages" ON public.report_messages;
CREATE POLICY "Read own report messages" ON public.report_messages
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.charger_reports r WHERE r.id = report_id AND r.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Write own report messages" ON public.report_messages;
CREATE POLICY "Write own report messages" ON public.report_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.charger_reports r WHERE r.id = report_id AND r.user_id = auth.uid())
    )
  );

-- 4. Languages + translations
CREATE TABLE IF NOT EXISTS public.languages (
  code text PRIMARY KEY,
  name text NOT NULL,
  native_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  rtl boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.languages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.languages TO authenticated;
GRANT ALL ON public.languages TO service_role;
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads languages" ON public.languages;
CREATE POLICY "Anyone reads languages" ON public.languages FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage languages" ON public.languages;
CREATE POLICY "Admins manage languages" ON public.languages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS languages_updated_at ON public.languages;
CREATE TRIGGER languages_updated_at BEFORE UPDATE ON public.languages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lang_code text NOT NULL REFERENCES public.languages(code) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lang_code, key)
);
GRANT SELECT ON public.translations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translations TO authenticated;
GRANT ALL ON public.translations TO service_role;
ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads translations" ON public.translations;
CREATE POLICY "Anyone reads translations" ON public.translations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage translations" ON public.translations;
CREATE POLICY "Admins manage translations" ON public.translations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS translations_updated_at ON public.translations;
CREATE TRIGGER translations_updated_at BEFORE UPDATE ON public.translations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.languages (code, name, native_name, enabled, is_default, rtl, sort_order) VALUES
  ('nl','Nederlands','Nederlands',true,true,false,1),
  ('en','Engels','English',true,false,false,2),
  ('de','Duits','Deutsch',true,false,false,3),
  ('fr','Frans','Français',true,false,false,4),
  ('es','Spaans','Español',true,false,false,5),
  ('it','Italiaans','Italiano',true,false,false,6),
  ('sv','Zweeds','Svenska',true,false,false,7),
  ('no','Noors','Norsk',true,false,false,8),
  ('fi','Fins','Suomi',true,false,false,9),
  ('da','Deens','Dansk',true,false,false,10),
  ('pl','Pools','Polski',true,false,false,11),
  ('pt','Portugees','Português',true,false,false,12),
  ('el','Grieks','Ελληνικά',true,false,false,13),
  ('ga','Iers','Gaeilge',true,false,false,14),
  ('is','IJslands','Íslenska',true,false,false,15),
  ('lt','Litouws','Lietuvių',true,false,false,16),
  ('lv','Lets','Latviešu',true,false,false,17),
  ('et','Ests','Eesti',true,false,false,18),
  ('sl','Sloveens','Slovenščina',true,false,false,19),
  ('sk','Slowaaks','Slovenčina',true,false,false,20),
  ('ro','Roemeens','Română',true,false,false,21),
  ('hu','Hongaars','Magyar',true,false,false,22),
  ('hr','Kroatisch','Hrvatski',true,false,false,23),
  ('sr','Servisch','Српски',true,false,false,24),
  ('tr','Turks','Türkçe',true,false,false,25),
  ('lb','Luxemburgs','Lëtzebuergesch',true,false,false,26),
  ('ar','Arabisch','العربية',true,false,true,27),
  ('ca','Catalaans','Català',true,false,false,28)
ON CONFLICT (code) DO NOTHING;

-- 5. Shareable saved routes
ALTER TABLE public.saved_routes ADD COLUMN IF NOT EXISTS share_token text;
ALTER TABLE public.saved_routes ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.saved_routes ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS saved_routes_share_token_idx ON public.saved_routes (share_token) WHERE share_token IS NOT NULL;
GRANT SELECT ON public.saved_routes TO anon;
DROP POLICY IF EXISTS "Anyone reads shared routes" ON public.saved_routes;
CREATE POLICY "Anyone reads shared routes" ON public.saved_routes
  FOR SELECT TO anon, authenticated USING (shared = true AND share_token IS NOT NULL);