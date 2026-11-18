-- Metadata used to track bundled Supercharger and tariff dataset versions.
-- This table is required by ensureBundledD1Seed() before the admin list can load.
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
