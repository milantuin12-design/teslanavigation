-- Personal TeslaNavigation data. Additive only: existing users and charger rows are untouched.
CREATE TABLE IF NOT EXISTS user_vehicles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Mijn Tesla',
  model_name TEXT NOT NULL DEFAULT '',
  model_year INTEGER,
  image_url TEXT,
  summer_consumption_kwh100 REAL,
  winter_consumption_kwh100 REAL,
  max_charge_kw INTEGER,
  arrival_percent INTEGER NOT NULL DEFAULT 10,
  trailer_enabled INTEGER NOT NULL DEFAULT 0,
  trailer_reduction_percent INTEGER NOT NULL DEFAULT 40,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (model_year IS NULL OR (model_year >= 1990 AND model_year <= 2100)),
  CHECK (summer_consumption_kwh100 IS NULL OR (summer_consumption_kwh100 >= 1 AND summer_consumption_kwh100 <= 100)),
  CHECK (winter_consumption_kwh100 IS NULL OR (winter_consumption_kwh100 >= 1 AND winter_consumption_kwh100 <= 100)),
  CHECK (max_charge_kw IS NULL OR (max_charge_kw >= 1 AND max_charge_kw <= 1000)),
  CHECK (arrival_percent >= 0 AND arrival_percent <= 100),
  CHECK (trailer_reduction_percent >= 0 AND trailer_reduction_percent <= 100)
);
CREATE INDEX IF NOT EXISTS user_vehicles_user_idx ON user_vehicles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_vehicles_one_default_idx ON user_vehicles(user_id) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS user_charger_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  charger_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, charger_id)
);
CREATE INDEX IF NOT EXISTS user_charger_favorites_charger_idx ON user_charger_favorites(charger_id);

CREATE TABLE IF NOT EXISTS user_charger_notes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  charger_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, charger_id),
  CHECK (length(note) <= 2000)
);
CREATE INDEX IF NOT EXISTS user_charger_notes_charger_idx ON user_charger_notes(charger_id);
