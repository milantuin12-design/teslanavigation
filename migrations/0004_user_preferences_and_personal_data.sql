-- Account-owned TeslaNavigation data. Additive only: existing users and Supercharger rows remain untouched.
CREATE TABLE IF NOT EXISTS user_vehicles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_year INTEGER,
  image_url TEXT,
  battery_kwh REAL,
  summer_consumption_kwh100 REAL,
  winter_consumption_kwh100 REAL,
  max_charge_kw INTEGER,
  arrival_percent INTEGER NOT NULL DEFAULT 10,
  trailer_enabled INTEGER NOT NULL DEFAULT 0,
  trailer_consumption_increase_percent INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_vehicles_user_idx ON user_vehicles(user_id, is_default DESC, created_at);

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
  PRIMARY KEY (user_id, charger_id)
);

CREATE TABLE IF NOT EXISTS user_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_push_subscriptions_user_idx ON user_push_subscriptions(user_id);
