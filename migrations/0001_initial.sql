-- Cloudflare D1 baseline schema for TeslaNavigation.
-- SQLite/D1 equivalent of the Supabase tables used by the app.
-- This creates an empty destination database; it does NOT import live Supabase rows.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TEXT,
  route_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, role)
);
CREATE INDEX IF NOT EXISTS user_roles_user_idx ON user_roles(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS charger_owners (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  description TEXT,
  website TEXT,
  contact TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS superchargers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  total_stalls INTEGER,
  stall_types TEXT,
  occupied_stalls INTEGER DEFAULT 0,
  country TEXT NOT NULL,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'operational',
  province TEXT,
  city TEXT,
  construction TEXT NOT NULL DEFAULT '{}',
  works TEXT NOT NULL DEFAULT '{}',
  closure TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  max_speed_kw INTEGER,
  versions TEXT NOT NULL DEFAULT '[]',
  opening_time TEXT,
  closing_time TEXT,
  trailer_friendly INTEGER NOT NULL DEFAULT 0,
  opening_hours TEXT NOT NULL DEFAULT '{}',
  is_available INTEGER NOT NULL DEFAULT 1,
  charger_configs TEXT NOT NULL DEFAULT '[]',
  parking_fee INTEGER NOT NULL DEFAULT 0,
  in_parking_garage INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES charger_owners(id) ON DELETE SET NULL,
  owner_name TEXT,
  low_speed INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  reopen_at TEXT,
  planned_upgrade TEXT NOT NULL DEFAULT '{}',
  stall_states TEXT NOT NULL DEFAULT '[]',
  permanently_closed_at TEXT,
  data_source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  source_updated_at TEXT,
  voting TEXT NOT NULL DEFAULT '{}',
  hidden INTEGER NOT NULL DEFAULT 0,
  photos TEXT NOT NULL DEFAULT '[]',
  price_currency TEXT NOT NULL DEFAULT 'EUR',
  price_per_kwh REAL,
  price_per_kwh_peak REAL,
  peak_hours TEXT,
  price_blocks TEXT,
  parking_fee_amount REAL,
  parking_free_minutes INTEGER,
  parking_per_minutes INTEGER,
  parking_per_euro REAL,
  parking_blocks TEXT NOT NULL DEFAULT '[]',
  traffic_forecast TEXT
);
CREATE INDEX IF NOT EXISTS superchargers_country_idx ON superchargers(country);
CREATE INDEX IF NOT EXISTS superchargers_published_idx ON superchargers(published);
CREATE INDEX IF NOT EXISTS superchargers_owner_idx ON superchargers(owner_id);
CREATE INDEX IF NOT EXISTS superchargers_status_idx ON superchargers(status);

CREATE TABLE IF NOT EXISTS charger_reports (
  id TEXT PRIMARY KEY,
  charger_id TEXT REFERENCES superchargers(id) ON DELETE SET NULL,
  charger_name TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  contact_email TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  admin_note TEXT,
  photos TEXT NOT NULL DEFAULT '[]',
  lat REAL,
  lng REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS report_messages (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES charger_reports(id) ON DELETE CASCADE,
  sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS report_messages_report_idx ON report_messages(report_id, created_at);
CREATE TABLE IF NOT EXISTS charger_changes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  charger_id TEXT,
  charger_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT 'update',
  changed_fields TEXT NOT NULL DEFAULT '{}',
  changed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS charger_changes_created_idx ON charger_changes(created_at DESC);
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT,
  action TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_updates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  importance TEXT NOT NULL DEFAULT 'normal',
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vehicle_models (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  brand TEXT NOT NULL DEFAULT 'Tesla',
  model TEXT NOT NULL,
  trim TEXT,
  battery_kwh REAL,
  usable_kwh REAL,
  range_km INTEGER,
  consumption_kwh100 REAL,
  year_from INTEGER,
  year_to INTEGER,
  max_charge_kw INTEGER,
  connectors TEXT NOT NULL DEFAULT '[\"Type 2\",\"CCS\"]',
  image_url TEXT,
  notes TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS saved_routes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_address TEXT,
  start_lat REAL NOT NULL,
  start_lng REAL NOT NULL,
  end_address TEXT,
  end_lat REAL NOT NULL,
  end_lng REAL NOT NULL,
  model_name TEXT NOT NULL,
  battery_percent INTEGER NOT NULL,
  trailer_mode INTEGER NOT NULL DEFAULT 0,
  trailer_reduction INTEGER NOT NULL DEFAULT 0,
  weather_mode TEXT NOT NULL DEFAULT 'summer',
  time_mode TEXT NOT NULL DEFAULT 'day',
  route_type TEXT NOT NULL DEFAULT 'fastest',
  charger_ids TEXT NOT NULL DEFAULT '[]',
  total_distance_km REAL,
  total_time_min INTEGER,
  share_token TEXT UNIQUE,
  shared INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS saved_routes_user_idx ON saved_routes(user_id);

CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  rtl INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  lang_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(lang_code, key)
);
