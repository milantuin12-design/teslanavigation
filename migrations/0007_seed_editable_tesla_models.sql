-- Seed the legacy Tesla picker models into the editable D1 vehicle catalogue.
-- Existing catalogue entries and all user/admin data are left untouched.
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-3-rwd','Tesla','Model 3','RWD',60,NULL,385,NULL,NULL,2019,2026,170,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model 3' AND trim='RWD');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-3-lr-rwd','Tesla','Model 3','Long Range RWD',79,NULL,580,NULL,NULL,2024,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model 3' AND trim='Long Range RWD');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-3-lr-awd','Tesla','Model 3','Long Range AWD',79,NULL,495,NULL,NULL,2019,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model 3' AND trim='Long Range AWD');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-3-performance','Tesla','Model 3','Performance',79,NULL,410,NULL,NULL,2019,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model 3' AND trim='Performance');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-y-rwd','Tesla','Model Y','RWD',60,NULL,340,NULL,NULL,2022,2026,170,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model Y' AND trim='RWD');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-y-lr-rwd','Tesla','Model Y','Long Range RWD',79,NULL,490,NULL,NULL,2025,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model Y' AND trim='Long Range RWD');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-y-lr-awd','Tesla','Model Y','Long Range AWD',79,NULL,440,NULL,NULL,2020,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model Y' AND trim='Long Range AWD');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-y-performance','Tesla','Model Y','Performance',79,NULL,410,NULL,NULL,2022,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model Y' AND trim='Performance');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-s','Tesla','Model S',NULL,100,NULL,540,NULL,NULL,2012,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model S' AND (trim IS NULL OR trim=''));
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-s-plaid','Tesla','Model S','Plaid',100,NULL,485,NULL,NULL,2021,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model S' AND trim='Plaid');
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-x','Tesla','Model X',NULL,100,NULL,480,NULL,NULL,2015,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model X' AND (trim IS NULL OR trim=''));
INSERT INTO vehicle_models
(id,brand,model,trim,battery_kwh,usable_kwh,range_km,consumption_kwh100,winter_consumption_kwh100,year_from,year_to,max_charge_kw,connectors,published)
SELECT 'tesla-default-model-x-plaid','Tesla','Model X','Plaid',100,NULL,430,NULL,NULL,2022,2026,250,'["Type 2","CCS"]',1
WHERE NOT EXISTS (SELECT 1 FROM vehicle_models WHERE lower(brand)='tesla' AND model='Model X' AND trim='Plaid');
