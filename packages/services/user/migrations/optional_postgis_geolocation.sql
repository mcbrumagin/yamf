-- Optional PostGIS: cast yamf.user.geolocation from TEXT (EWKT) to geography.
--
-- By default the user service keeps geolocation as TEXT so Postgres without
-- PostGIS works. To use native geography (indexes, distance queries), either:
--   • Run this script after yamf.user exists, as a role that can CREATE EXTENSION
--     and ALTER the table (often superuser or yamf_admin), or
--   • Set postgisGeography in user-service config so the service runs the same
--     DDL on startup (see ensurePostgisUserGeographyColumn in service.js).
--
-- Server prerequisite: PostGIS binaries installed (e.g. postgresql-NN-postgis-3
-- or a PostGIS-enabled image). CREATE EXTENSION alone is not enough if files
-- are missing on the host.

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE yamf.user
  ALTER COLUMN geolocation TYPE geography(Point, 4326)
  USING (
    CASE
      WHEN geolocation IS NULL OR btrim(geolocation::text) = '' THEN NULL
      ELSE geography(ST_GeomFromEWKT(geolocation::text))
    END
  );
