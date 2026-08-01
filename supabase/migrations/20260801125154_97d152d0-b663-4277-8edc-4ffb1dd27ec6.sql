
DROP POLICY IF EXISTS "Anyone can create reports" ON public.charger_reports;

CREATE POLICY "Guests can create reports" ON public.charger_reports
  FOR INSERT TO anon
  WITH CHECK (
    user_id IS NULL
    AND status = 'new'
    AND admin_note IS NULL
    AND length(btrim(message)) BETWEEN 3 AND 2000
  );

CREATE POLICY "Users can create own reports" ON public.charger_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND status = 'new'
    AND admin_note IS NULL
    AND length(btrim(message)) BETWEEN 3 AND 2000
  );
