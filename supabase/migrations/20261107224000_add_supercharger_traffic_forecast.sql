alter table public.superchargers add column if not exists traffic_forecast jsonb;
comment on column public.superchargers.traffic_forecast is 'Handmatig beheerde verwachte drukte per Supercharger; geen live bezettingsdata.';
