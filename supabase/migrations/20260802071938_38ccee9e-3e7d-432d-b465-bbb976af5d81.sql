CREATE POLICY "charger media read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'charger-media');
CREATE POLICY "charger media upload" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'charger-media');
CREATE POLICY "charger media admin delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'charger-media' AND public.has_role(auth.uid(),'admin'));