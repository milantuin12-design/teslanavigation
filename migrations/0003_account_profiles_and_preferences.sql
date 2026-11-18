-- Per-user profile and preferences for TeslaNavigation.
-- Existing account credentials and roles are not modified.
ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT 'unspecified'
  CHECK (gender IN ('male','female','other','unspecified'));
ALTER TABLE users ADD COLUMN preferences_json TEXT NOT NULL DEFAULT '{}';
