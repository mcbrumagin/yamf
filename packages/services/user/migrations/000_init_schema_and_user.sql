-- Bootstrap: roles + database + yamf schema and grants.
--
-- How to run (psql):
--   1) Replace passwords and database name below (never commit real secrets).
--   2) Connect as a superuser to the maintenance DB, e.g.:
--        psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f 000_init_schema_and_user.sql
--   3) The \connect line below is a psql meta-command: it switches to the new
--      database before CREATE SCHEMA. Non-psql clients must run phase 1 and phase
--      2 as separate scripts or connections.
--
-- Service note: createOrValidateUserTable() issues CREATE TABLE / ALTER TABLE.
-- Use yamf_admin (or superuser) in the app connection string for migrations and
-- first-time DDL; use yamf_app for least-privilege runtime if you split URLs.

-- === Phase 1: maintenance database (e.g. postgres) ===

CREATE USER yamf_admin WITH ENCRYPTED PASSWORD 'REPLACE_WITH_STRONG_ADMIN_PASSWORD';
CREATE USER yamf_app WITH ENCRYPTED PASSWORD 'REPLACE_WITH_STRONG_APP_PASSWORD';

CREATE DATABASE example_database OWNER yamf_admin;

GRANT CONNECT ON DATABASE example_database TO yamf_admin;
GRANT CONNECT ON DATABASE example_database TO yamf_app;

-- === Phase 2: application database ===
\connect example_database

CREATE SCHEMA yamf AUTHORIZATION yamf_admin;

GRANT CREATE ON DATABASE example_database TO yamf_admin;

GRANT USAGE ON SCHEMA yamf TO yamf_admin;
GRANT CREATE ON SCHEMA yamf TO yamf_admin;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA yamf TO yamf_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA yamf TO yamf_admin;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA yamf TO yamf_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE yamf_admin IN SCHEMA yamf GRANT ALL PRIVILEGES ON TABLES TO yamf_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE yamf_admin IN SCHEMA yamf GRANT ALL PRIVILEGES ON SEQUENCES TO yamf_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE yamf_admin IN SCHEMA yamf GRANT ALL PRIVILEGES ON FUNCTIONS TO yamf_admin;


-- === Phase 3: application user ===
GRANT USAGE ON SCHEMA yamf TO yamf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA yamf TO yamf_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA yamf TO yamf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE yamf_admin IN SCHEMA yamf
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yamf_app;
ALTER DEFAULT PRIVILEGES FOR ROLE yamf_admin IN SCHEMA yamf
  GRANT USAGE, SELECT ON SEQUENCES TO yamf_app;
