CREATE OR REPLACE FUNCTION public.validate_charger_status()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('operational','construction','works','works_closed','temp_closed','long_closed','voting','plan','permit','expanding','permanent_closed','unknown') THEN
    RAISE EXCEPTION 'Invalid supercharger status: %', NEW.status;
  END IF;
  IF NEW.data_source NOT IN ('manual','automatic') THEN
    RAISE EXCEPTION 'Invalid data source: %', NEW.data_source;
  END IF;
  IF NEW.status = 'permanent_closed' AND NEW.permanently_closed_at IS NULL THEN
    NEW.permanently_closed_at = now();
  ELSIF NEW.status <> 'permanent_closed' THEN
    NEW.permanently_closed_at = NULL;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.log_charger_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.charger_changes (charger_id, charger_name, action, changed_fields, changed_by)
    VALUES (NEW.id, NEW.name, 'create', jsonb_build_object('status', jsonb_build_object('from', null, 'to', NEW.status)), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.charger_changes (charger_id, charger_name, action, changed_fields, changed_by)
    VALUES (OLD.id, OLD.name, 'delete', '{}'::jsonb, auth.uid());
    RETURN OLD;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.charger_changes (charger_id, charger_name, action, changed_fields, changed_by)
    VALUES (NEW.id, NEW.name, 'update', jsonb_build_object('status', jsonb_build_object('from', OLD.status, 'to', NEW.status)), auth.uid());
  END IF;
  RETURN NEW;
END; $function$;

GRANT UPDATE, DELETE ON public.charger_changes TO authenticated;
CREATE POLICY "Admins update charger changes" ON public.charger_changes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete charger changes" ON public.charger_changes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));