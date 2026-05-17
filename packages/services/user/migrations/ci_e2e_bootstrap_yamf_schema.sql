-- Minimal bootstrap for single-user dev/CI Postgres (e.g. GitHub Actions service:
-- POSTGRES_USER and POSTGRES_DB both `yamf`). Ensures schema `yamf` exists so
-- @yamf/services-user `createOrValidateUserTable()` and qualified `yamf.*` queries work.
--
-- Not a substitute for migrations/000_init_schema_and_user.sql (split admin/app).

CREATE SCHEMA IF NOT EXISTS yamf;
