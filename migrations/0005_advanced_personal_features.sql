-- Additional personal navigation data. Additive only; existing accounts and charger records are untouched.
ALTER TABLE user_vehicles ADD COLUMN battery_health_percent REAL;
ALTER TABLE user_vehicles ADD COLUMN speed_consumption_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE user_vehicles ADD COLUMN charging_curve_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE user_vehicles ADD COLUMN roof_or_rack_extra_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_vehicles ADD COLUMN winter_tires_extra_percent INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_charger_labels (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  charger_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK(length(label) <= 80),
  color TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, charger_id)
);
CREATE TABLE IF NOT EXISTS user_recent_chargers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  charger_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, charger_id)
);
CREATE INDEX IF NOT EXISTS user_recent_chargers_user_idx ON user_recent_chargers(user_id, viewed_at DESC);
CREATE TABLE IF NOT EXISTS user_hidden_chargers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  charger_id TEXT NOT NULL,
  hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, charger_id)
);
CREATE TABLE IF NOT EXISTS user_route_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_route_profiles_user_idx ON user_route_profiles(user_id);
CREATE TABLE IF NOT EXISTS user_charging_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  charger_id TEXT,
  charger_name TEXT,
  started_at TEXT,
  ended_at TEXT,
  energy_kwh REAL NOT NULL DEFAULT 0,
  cost_amount REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  start_percent INTEGER,
  end_percent INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS user_charging_sessions_user_idx ON user_charging_sessions(user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS user_notification_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  charger_id TEXT,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  delivery_status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  UNIQUE(user_id, dedupe_key, channel)
);
CREATE INDEX IF NOT EXISTS user_notification_events_user_idx ON user_notification_events(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS user_pinned_waypoints (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES saved_routes(id) ON DELETE CASCADE,
  charger_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, route_id, charger_id)
);
