CREATE TABLE IF NOT EXISTS vehicle_year_specs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  vehicle_model_id TEXT NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK(year BETWEEN 1990 AND 2100),
  battery_kwh REAL,
  usable_kwh REAL,
  range_km INTEGER,
  summer_range_km INTEGER,
  winter_range_km INTEGER,
  max_charge_kw INTEGER,
  connectors TEXT NOT NULL DEFAULT '["Type 2","CCS"]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vehicle_model_id, year)
);
CREATE INDEX IF NOT EXISTS vehicle_year_specs_model_year_idx
  ON vehicle_year_specs(vehicle_model_id, year);

-- Preserve existing specifications only for the exact year they were recorded against.
INSERT OR IGNORE INTO vehicle_year_specs
  (vehicle_model_id, year, battery_kwh, usable_kwh, range_km, summer_range_km,
   winter_range_km, max_charge_kw, connectors)
SELECT id, year_from, battery_kwh, usable_kwh, range_km, summer_range_km,
       winter_range_km, max_charge_kw, COALESCE(connectors, '["Type 2","CCS"]')
FROM vehicle_models
WHERE year_from IS NOT NULL
  AND (battery_kwh IS NOT NULL OR usable_kwh IS NOT NULL OR range_km IS NOT NULL
       OR summer_range_km IS NOT NULL OR winter_range_km IS NOT NULL
       OR max_charge_kw IS NOT NULL);
