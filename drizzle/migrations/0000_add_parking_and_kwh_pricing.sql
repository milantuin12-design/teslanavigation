ALTER TABLE public.superchargers
  ADD COLUMN IF NOT EXISTS parking_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS parking_free_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parking_per_minutes integer,
  ADD COLUMN IF NOT EXISTS parking_per_euro numeric,
  ADD COLUMN IF NOT EXISTS price_per_kwh numeric,
  ADD COLUMN IF NOT EXISTS price_per_kwh_peak numeric,
  ADD COLUMN IF NOT EXISTS peak_hours text;
COMMENT ON COLUMN public.superchargers.parking_fee_amount IS 'Vast parkeerbedrag in euro (optioneel).';
COMMENT ON COLUMN public.superchargers.parking_free_minutes IS 'Aantal gratis parkeerminuten voordat kosten ingaan (bijv. 90).';
COMMENT ON COLUMN public.superchargers.parking_per_minutes IS 'Tijdsblok in minuten voor parkeerkosten (bijv. 10 of 15).';
COMMENT ON COLUMN public.superchargers.parking_per_euro IS 'Kosten in euro per tijdsblok.';
COMMENT ON COLUMN public.superchargers.price_per_kwh IS 'Laadtarief per kWh in euro.';
COMMENT ON COLUMN public.superchargers.price_per_kwh_peak IS 'Piek-tarief per kWh in euro (optioneel).';
COMMENT ON COLUMN public.superchargers.peak_hours IS 'Tijdsblokken voor piektarief, vrije tekst (bijv. "ma-vr 07:00-19:00").';