-- One-time migration: user service 0.2.0 — nullable username, profile fields, invite cleanup index.
-- Run against dev/staging with appropriate permissions.
--
-- Geolocation: stored as TEXT (EWKT, e.g. SRID=4326;POINT(lon lat)) so the app works without PostGIS.
-- Optional native type (requires CREATE EXTENSION postgis and superuser or equivalent):
--
--   CREATE EXTENSION IF NOT EXISTS postgis;
--   ALTER TABLE yamf.user
--     ALTER COLUMN geolocation TYPE geography(POINT, 4326)
--     USING CASE
--       WHEN geolocation IS NULL OR btrim(geolocation) = '' THEN NULL
--       ELSE geography(ST_GeomFromEWKT(geolocation))
--     END;

ALTER TABLE yamf.user
  ALTER COLUMN username DROP NOT NULL;

ALTER TABLE yamf.user
  ADD COLUMN IF NOT EXISTS display_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS bio TEXT NULL,
  ADD COLUMN IF NOT EXISTS location TEXT NULL,
  ADD COLUMN IF NOT EXISTS geolocation TEXT NULL,
  ADD COLUMN IF NOT EXISTS avatar_path TEXT NULL,
  ADD COLUMN IF NOT EXISTS invited_by INTEGER NULL REFERENCES yamf.user(user_id) ON DELETE SET NULL;

-- If geolocation already exists as another type, skip or adjust manually before running.

CREATE INDEX IF NOT EXISTS idx_user_expired_invite_cleanup
  ON yamf.user (token_expires)
  WHERE is_registered = FALSE
    AND token_hash IS NOT NULL
    AND token_expires IS NOT NULL;
